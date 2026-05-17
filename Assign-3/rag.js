/**
 * RAG pipeline for Mini-NotebookLM.
 *
 * The reference app uses Next.js, LangChain, and Pinecone. This version keeps
 * the assignment stack: Express, Qdrant, OpenRouter, and a static frontend.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { pipeline, env } from "@xenova/transformers";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, ".model-cache");

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "mini_notebooklm_chunks";
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const ANSWER_MODEL = process.env.MODEL_NAME || "nvidia/nemotron-3-super-120b-a12b:free";
const UTILITY_MODEL = process.env.UTILITY_MODEL || "minimax/minimax-m2.5";
const OPENAI_BASE_URL = process.env.BASE_URL || "https://openrouter.ai/api/v1";

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  baseURL: OPENAI_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": "Mini-NotebookLM",
  },
});

let embedder = null;
let collectionReady = false;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embedder;
}

async function embedText(text) {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function embedBatch(texts, onProgress) {
  const extractor = await getEmbedder();
  const embeddings = [];
  const batchSize = 32;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await extractor(batch, { pooling: "mean", normalize: true });

    for (let j = 0; j < batch.length; j += 1) {
      const start = j * EMBEDDING_DIM;
      embeddings.push(Array.from(output.data.slice(start, start + EMBEDDING_DIM)));
    }

    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return embeddings;
}

async function ensureCollection() {
  if (collectionReady) return;

  const existsResult = await qdrant.collectionExists(COLLECTION_NAME).catch(() => ({ exists: false }));
  const exists = typeof existsResult === "boolean" ? existsResult : Boolean(existsResult.exists);
  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
    });
  }

  await qdrant
    .createPayloadIndex(COLLECTION_NAME, {
      wait: true,
      field_name: "sessionId",
      field_schema: "keyword",
    })
    .catch((error) => {
      const message = String(error?.message || error?.data?.status?.error || "");
      if (!message.toLowerCase().includes("already exists")) {
        console.warn(`Could not create sessionId payload index: ${message}`);
      }
    });

  collectionReady = true;
}

function sessionFilter(sessionId) {
  return {
    must: [
      {
        key: "sessionId",
        match: { value: sessionId },
      },
    ],
  };
}

async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    return cleanText(data.text || "");
  }

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value || "");
  }

  if (ext === ".txt" || ext === ".csv" || ext === ".md") {
    return cleanText(fs.readFileSync(filePath, "utf-8"));
  }

  throw new Error("Unsupported file type. Use PDF, DOCX, CSV, TXT, or MD.");
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

class RecursiveCharacterTextSplitter {
  constructor({ chunkSize = 1000, chunkOverlap = 100 } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = ["\n\n", "\n", ". ", " ", ""];
  }

  splitText(text) {
    return this.split(text, this.separators).filter(Boolean);
  }

  split(text, separators) {
    if (!text || text.length <= this.chunkSize) return text ? [text.trim()] : [];

    const separator = separators.find((item) => item === "" || text.includes(item));
    if (separator === undefined) return [text.trim()];

    const parts = separator === "" ? [...text] : text.split(separator);
    const chunks = [];
    let current = "";

    for (const part of parts) {
      const combined = current ? `${current}${separator}${part}` : part;

      if (combined.length > this.chunkSize && current) {
        chunks.push(current.trim());
        const overlap = current.slice(Math.max(0, current.length - this.chunkOverlap));
        current = overlap ? `${overlap}${separator}${part}` : part;
      } else {
        current = combined;
      }
    }

    if (current.trim()) chunks.push(current.trim());

    const nextSeparators = separators.slice(separators.indexOf(separator) + 1);
    if (!nextSeparators.length) return chunks;

    return chunks.flatMap((chunk) =>
      chunk.length > this.chunkSize ? this.split(chunk, nextSeparators) : [chunk]
    );
  }
}

async function indexDocumentText({ text, fileName, sessionId, onProgress }) {
  if (!sessionId) throw new Error("sessionId is required");
  const normalizedText = cleanText(text);
  if (!normalizedText) throw new Error("No text content found in the document");

  await ensureCollection();

  onProgress?.("chunking", "Splitting document into chunks");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 100,
  });
  const chunks = splitter.splitText(normalizedText);
  if (!chunks.length) throw new Error("No chunks generated from document");

  onProgress?.("embedding", `Embedding 0/${chunks.length}`);
  const embeddings = await embedBatch(chunks, (done, total) => {
    onProgress?.("embedding", `Embedding ${done}/${total}`);
  });

  onProgress?.("storing", "Storing vectors in Qdrant");
  const uploadedAt = new Date().toISOString();
  const points = chunks.map((chunk, index) => ({
    id: randomUUID(),
    vector: embeddings[index],
    payload: {
      text: chunk,
      source: fileName || "Untitled document",
      sessionId,
      chunkIndex: index,
      uploadedAt,
    },
  }));

  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: points.slice(i, i + batchSize),
    });
  }

  return {
    sessionId,
    fileName: fileName || "Untitled document",
    chunks: chunks.length,
    characters: normalizedText.length,
  };
}

async function indexDocumentFile({ filePath, fileName, sessionId, onProgress }) {
  onProgress?.("parsing", "Extracting text from document");
  const text = await extractTextFromFile(filePath, fileName);
  return indexDocumentText({ text, fileName, sessionId, onProgress });
}

async function expandQuery(query) {
  return utilityCompletion({
    fallback: query,
    maxTokens: 180,
    messages: [
      { role: "system", content: "You expand user questions for semantic document retrieval. Return only the expanded query." },
      {
        role: "user",
        content: `Given the user's question about uploaded documents, expand it with relevant keywords and context that would help find the most relevant information.\n\nUser question: ${query}\n\nExpanded query:`,
      },
    ],
  });
}

async function reformulateQuery(query) {
  return utilityCompletion({
    fallback: query,
    maxTokens: 120,
    messages: [
      { role: "system", content: "You reformulate user queries for document retrieval. Keep the original meaning intact." },
      {
        role: "user",
        content: `The user asked: "${query}"\n\nInitial retrieval was weak. Rephrase the query to better match wording that might exist in uploaded PDF, DOCX, CSV, TXT, or Markdown documents. Return only the rephrased query.`,
      },
    ],
  });
}

async function utilityCompletion({ messages, fallback, maxTokens }) {
  try {
    const response = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content?.trim() || fallback;
  } catch (error) {
    console.error("Utility model call failed:", error.message);
    return fallback;
  }
}

async function retrieveAndRerank(query, sessionId, topK = 15) {
  await ensureCollection();

  const queryVector = await embedText(query);
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: queryVector,
    limit: topK,
    with_payload: true,
    with_vector: true,
    filter: sessionFilter(sessionId),
  });

  if (!results.length) {
    return { chunks: [], scores: [], maxScore: 0, avgScore: 0 };
  }

  const scored = results
    .map((result) => ({
      text: result.payload?.text || "",
      source: result.payload?.source || "unknown",
      chunkIndex: result.payload?.chunkIndex ?? 0,
      retrievalScore: result.score || 0,
      rerankScore: cosineSimilarity(queryVector, result.vector || []),
    }))
    .filter((chunk) => chunk.text);

  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  const filtered = scored.slice(0, 5).filter((chunk) => chunk.rerankScore >= 0.01);
  const scores = filtered.map((chunk) => chunk.rerankScore);

  return {
    chunks: filtered,
    scores,
    maxScore: scored[0]?.rerankScore || 0,
    avgScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
  };
}

function cosineSimilarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function evaluateRetrieval(query, chunks) {
  if (!chunks.length) return { sufficient: false, rawResponse: "NO_CHUNKS" };

  const chunkText = chunks
    .map((chunk, index) => `[${index + 1}] Source: "${chunk.source}"\n${chunk.text}`)
    .join("\n\n---\n\n");

  const raw = await utilityCompletion({
    fallback: "SUFFICIENT",
    maxTokens: 10,
    messages: [
      {
        role: "system",
        content: "You strictly evaluate retrieved chunks for a RAG system. Reply with only SUFFICIENT or INSUFFICIENT.",
      },
      {
        role: "user",
        content: `User Query: ${query}\n\nRetrieved Chunks:\n${chunkText}\n\nDo the chunks contain enough specific information to answer?`,
      },
    ],
  });

  const normalized = raw.toUpperCase();
  return {
    sufficient: normalized.includes("SUFFICIENT") && !normalized.includes("INSUFFICIENT"),
    rawResponse: normalized,
  };
}

async function prepareAnswerContext(query, sessionId) {
  const expandedQuery = await expandQuery(query);
  let result = await retrieveAndRerank(expandedQuery, sessionId);
  let usedReformulation = false;

  if (!result.chunks.length || result.maxScore < 0.2) {
    const reformulated = await reformulateQuery(query);
    const expandedReformulated = await expandQuery(reformulated);
    const retry = await retrieveAndRerank(expandedReformulated, sessionId);

    if (retry.maxScore >= result.maxScore) {
      result = retry;
      usedReformulation = true;
    }
  }

  const evaluation = await evaluateRetrieval(query, result.chunks);

  return {
    ...result,
    expandedQuery,
    usedReformulation,
    evaluation,
  };
}

async function createChatStream({ query, sessionId, history = [] }) {
  if (!query) throw new Error("query is required");
  if (!sessionId) throw new Error("sessionId is required");

  const context = await prepareAnswerContext(query, sessionId);

  if (!context.chunks.length) {
    return textToAsyncIterable(
      "I couldn't find relevant information in your uploaded documents. Try rephrasing your question or uploading a different document."
    );
  }

  const contextParts = context.chunks.map((chunk, index) => {
    return `[Chunk ${index + 1} from "${chunk.source}" | Relevance: ${(chunk.rerankScore * 100).toFixed(1)}%]\n${chunk.text}`;
  });

  const lowConfidence =
    !context.evaluation.sufficient || context.maxScore < 0.2
      ? "\nThe retrieved context may be incomplete or only partially relevant. Use what is present, but do not invent missing facts."
      : "";

  const previousConversation = Array.isArray(history) && history.length
    ? history
        .slice(-8)
        .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
        .join("\n")
    : "";

  const messages = [
    {
      role: "system",
      content: `You are an intelligent AI research assistant for Mini-NotebookLM.

Use only the retrieved document context below. If the answer is not supported by the context, say you could not find sufficient information in the uploaded documents.

Always cite the source document name when referencing facts. Use concise Markdown.

Retrieved context:
${contextParts.join("\n\n---\n\n")}${lowConfidence}`,
    },
  ];

  if (previousConversation) {
    messages.push({
      role: "user",
      content: `Previous conversation:\n${previousConversation}`,
    });
  }

  messages.push({ role: "user", content: query });

  const stream = await openai.chat.completions.create({
    model: ANSWER_MODEL,
    messages,
    temperature: 0.2,
    stream: true,
  });

  return streamText(stream);
}

async function* streamText(stream) {
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) yield content;
  }
}

async function* textToAsyncIterable(text) {
  yield text;
}

async function deleteSession(sessionId) {
  if (!sessionId) throw new Error("sessionId is required");
  await ensureCollection();
  await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    filter: sessionFilter(sessionId),
  });
}

async function healthCheck() {
  const qdrantHealth = await qdrant.getCollections().then(() => "ok").catch((error) => error.message);
  return {
    ok: qdrantHealth === "ok",
    qdrant: qdrantHealth,
    collection: COLLECTION_NAME,
    embeddingModel: EMBEDDING_MODEL,
    answerModel: ANSWER_MODEL,
    utilityModel: UTILITY_MODEL,
  };
}

export {
  createChatStream,
  deleteSession,
  extractTextFromFile,
  healthCheck,
  indexDocumentFile,
  indexDocumentText,
};
