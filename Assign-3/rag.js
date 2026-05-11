/**
 * rag.js — Advanced RAG Pipeline
 *
 * Upgraded to handle large (300+ page) PDFs by:
 *   1. Using Remote Embeddings (OpenAI/OpenRouter)
 *   2. Implementing Query Expansion
 *   3. Implementing Reranking
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pdf from "pdf-parse";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────────────────────

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536; // Dimensions for text-embedding-3-small
const LLM_MODEL = process.env.MODEL_NAME || 'nvidia/nemotron-3-super-120b-a12b:free';

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const openai = new OpenAI({
  baseURL: process.env.BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/google-gemini/gemini-cli", // Required for OpenRouter
    "X-Title": "NotebookLM-Clone",
  },
});

// ── Remote Embedding ───────────────────────────────────────────────────────────

/**
 * Embed text using a remote API.
 * This is significantly faster for large documents than local processing.
 */
async function embedText(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Embed multiple strings in a single batch call.
 * This is the "secret sauce" for 300+ page PDFs.
 */
async function embedBatch(texts, onProgress) {
  const BATCH_SIZE = 100; // Large batches are fine for remote APIs
  const embeddings = [];

  if (onProgress) onProgress(0, texts.length);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const subBatch = texts.slice(i, i + BATCH_SIZE);
    
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: subBatch,
    });

    embeddings.push(...response.data.map(d => d.embedding));

    if (onProgress) onProgress(embeddings.length, texts.length);
  }

  return embeddings;
}

// ── Advanced Retrieval Logic ───────────────────────────────────────────────────

/**
 * Expand a user query to include more relevant keywords.
 */
async function expandQuery(query) {
  try {
    const response = await openai.chat.completions.create({
      model: "google/gemini-flash-1.5-8b", // Fast, cheap model for expansion
      messages: [
        { 
          role: "system", 
          content: "Expand the user's question into a more descriptive search query that will help find relevant information in a document. Return ONLY the expanded query text." 
        },
        { role: "user", content: query }
      ],
      temperature: 0.1,
    });
    return response.choices[0].message.content.trim();
  } catch (e) {
    console.error("Query expansion failed:", e);
    return query; // Fallback to original
  }
}

/**
 * Simple Cosine Similarity for Reranking
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

/**
 * Rerank retrieved chunks based on original query relevance.
 */
async function rerankChunks(originalQuery, retrievedChunks, topK = 5) {
  const queryVec = await embedText(originalQuery);
  
  const scored = retrievedChunks.map(chunk => {
    const score = cosineSimilarity(queryVec, chunk.vector);
    return { ...chunk, rerankScore: score };
  });

  return scored
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK);
}

// ── Document Loading ───────────────────────────────────────────────────────────

async function loadDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return loadPDF(filePath);
  if (ext === ".txt") return loadText(filePath);
  throw new Error(`Unsupported file type: ${ext}`);
}

async function loadPDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  if (!data.text || !data.text.trim()) return [];

  const rawPages = data.text.split(/\f/);
  return rawPages
    .map((text, i) => ({ pageNumber: i + 1, text: text.replace(/\s+/g, " ").trim() }))
    .filter((p) => p.text.length > 0);
}

async function loadText(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return [{ pageNumber: 1, text }];
}

// ── Chunking ───────────────────────────────────────────────────────────────────

class RecursiveCharacterTextSplitter {
  constructor({ chunkSize = 1000, chunkOverlap = 200 } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = ["\n\n", "\n", ". ", " ", ""];
  }

  splitDocuments(pages) {
    const allChunks = [];
    let globalIndex = 0;
    for (const page of pages) {
      const textChunks = this.splitText(page.text);
      for (const text of textChunks) {
        allChunks.push({ text, metadata: { pageNumber: page.pageNumber, chunkIndex: globalIndex++ } });
      }
    }
    return allChunks;
  }

  splitText(text) {
    return this._split(text, this.separators);
  }

  _split(text, separators) {
    if (!text || text.length <= this.chunkSize) return text ? [text] : [];
    const sep = separators.find((s) => s === "" || text.includes(s));
    if (sep === undefined) return [text];

    const parts = sep === "" ? [...text] : text.split(sep);
    const chunks = [];
    let current = "";

    for (const part of parts) {
      const combined = current ? current + sep + part : part;
      if (combined.length > this.chunkSize && current) {
        chunks.push(current.trim());
        const overlap = current.slice(Math.max(0, current.length - this.chunkOverlap));
        current = overlap ? overlap + sep + part : part;
      } else {
        current = combined;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    const nextSeps = separators.slice(separators.indexOf(sep) + 1);
    if (nextSeps.length > 0) {
      const result = [];
      for (const chunk of chunks) {
        if (chunk.length > this.chunkSize) {
          result.push(...this._split(chunk, nextSeps));
        } else {
          result.push(chunk);
        }
      }
      return result;
    }
    return chunks;
  }
}

// ── Indexing (Ingestion Pipeline) ──────────────────────────────────────────────

async function indexDocument(filePath, fileName, onProgress) {
  const collectionName = `doc_${Date.now()}`;

  if (onProgress) onProgress("loading", "Loading document…");
  const pages = await loadDocument(filePath);
  
  if (onProgress) onProgress("chunking", "Chunking document…");
  const splitter = new RecursiveCharacterTextSplitter();
  const chunks = splitter.splitDocuments(pages);

  if (onProgress) onProgress("embedding", `Embedding ${chunks.length} chunks remotely…`);
  const embeddings = await embedBatch(
    chunks.map((c) => c.text),
    (done, total) => { if (onProgress) onProgress("embedding", `Embedded ${done}/${total}`); }
  );

  if (onProgress) onProgress("storing", "Storing in Qdrant…");
  await qdrant.createCollection(collectionName, {
    vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
  });

  const BATCH = 100;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const vecs = embeddings.slice(i, i + BATCH);

    await qdrant.upsert(collectionName, {
      points: slice.map((chunk, j) => ({
        id: i + j,
        vector: vecs[j],
        payload: {
          text: chunk.text,
          pageNumber: chunk.metadata.pageNumber,
          chunkIndex: chunk.metadata.chunkIndex,
          source: fileName,
        },
      })),
    });
  }

  return { collectionName, fileName, totalChunks: chunks.length, totalPages: pages.length };
}

// ── Retrieval + Generation ─────────────────────────────────────────────────────

async function chat(question, collectionName) {
  // 1 — Expand Query for better coverage
  const expandedQuery = await expandQuery(question);

  // 2 — Retrieve more candidates for reranking
  const queryVector = await embedText(expandedQuery);
  const results = await qdrant.search(collectionName, {
    vector: queryVector,
    limit: 15, // Retrieve more for reranking
    with_payload: true,
    with_vector: true,
  });

  // 3 — Rerank based on original question
  const reranked = await rerankChunks(question, results.map(r => ({
    text: r.payload.text,
    pageNumber: r.payload.pageNumber,
    vector: r.vector,
    score: r.score
  })), 5);

  const contextStr = reranked
    .map((c, i) => `[Chunk ${i + 1} | Page ${c.pageNumber}]\n${c.text}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are an intelligent AI research assistant. Your job is to help users understand and analyze the documents they have uploaded.

## Context Information:
Below are snippets (chunks) retrieved from the uploaded documents.

${contextStr}

## Instructions:
1. **Core Rule:** Base your response **exclusively** on the provided context.
2. **Summary Requests:** If the user asks for a summary, synthesize what IS there while explaining that these represent the most relevant parts found.
3. **No Information:** If the context is truly irrelevant, say "I couldn't find sufficient information in the uploaded documents."
4. **Citations:** Always cite the page number(s) where you found the information, like [Page X].
5. **Formatting:** Use clear Markdown.
6. **Tone:** Professional and analytical.`;

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    temperature: 0.2,
  });

  return {
    answer: response.choices[0].message.content,
    sources: reranked.map((c) => ({
      pageNumber: c.pageNumber,
      preview: c.text.slice(0, 150) + "...",
      relevance: c.rerankScore,
    })),
  };
}

async function listCollections() {
  const res = await qdrant.getCollections();
  return res.collections;
}

async function deleteCollection(name) {
  await qdrant.deleteCollection(name);
}

export { indexDocument, chat, listCollections, deleteCollection };
