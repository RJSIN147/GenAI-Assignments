/**
 * rag.js — Complete RAG Pipeline
 *
 * Handles the full Retrieval-Augmented Generation flow:
 *   1. Document Loading (PDF / TXT)
 *   2. Chunking (RecursiveCharacterTextSplitter)
 *   3. Embedding (local, via @xenova/transformers)
 *   4. Indexing (Qdrant vector store)
 *   5. Retrieval (semantic similarity search)
 *   6. Generation (LLM via OpenRouter)
 */

import fs from "fs";
import path from "path";
import pdf from "pdf-parse";
import { pipeline } from "@xenova/transformers";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai";

// ── Configuration ──────────────────────────────────────────────────────────────

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;
const LLM_MODEL = process.env.MODEL_NAME || 'nvidia/nemotron-3-super-120b-a12b:free';

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY, // Added for Qdrant Cloud support
});

const openai = new OpenAI({
  baseURL: process.env.BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// ── Embedding (Local — no API key needed) ──────────────────────────────────────

let embedder = null;

/**
 * Lazily initialize and return the local embedding pipeline.
 * First call downloads the model (~80 MB); subsequent calls reuse it.
 */
async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return embedder;
}

/** Embed a single string and return a flat Float32 array. */
async function embedText(text) {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/** Embed an array of strings with an optional progress callback. */
async function embedBatch(texts, onProgress) {
  const extractor = await getEmbedder();
  const embeddings = [];

  for (let i = 0; i < texts.length; i++) {
    const output = await extractor(texts[i], {
      pooling: "mean",
      normalize: true,
    });
    embeddings.push(Array.from(output.data));
    if (onProgress) onProgress(i + 1, texts.length);
  }

  return embeddings;
}

// ── Document Loading ───────────────────────────────────────────────────────────

/**
 * Load a document and return an array of { pageNumber, text } objects.
 * Supports .pdf and .txt files.
 */
async function loadDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") return loadPDF(filePath);
  if (ext === ".txt") return loadText(filePath);
  throw new Error(`Unsupported file type: ${ext}. Use .pdf or .txt`);
}

async function loadPDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pages = [];
  let pageNum = 0;

  await pdf(buffer, {
    pagerender: async (pageData) => {
      pageNum++;
      const textContent = await pageData.getTextContent();
      const text = textContent.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push({ pageNumber: pageNum, text });
      return text;
    },
  });

  return pages;
}

async function loadText(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  return [{ pageNumber: 1, text }];
}

// ── Chunking ───────────────────────────────────────────────────────────────────
//
//  Strategy: Recursive Character Text Splitting
//
//  How it works:
//    1. Try to split by the largest separator first (\n\n → \n → ". " → " " → "")
//    2. Merge parts until chunkSize is exceeded, then start a new chunk
//    3. Keep chunkOverlap characters from the end of the previous chunk for continuity
//    4. If any chunk is still too large, recursively split with the next separator
//
//  Why this strategy:
//    - Respects natural paragraph boundaries (unlike naive fixed-size splitting)
//    - Overlap prevents losing context at chunk edges
//    - Recursive fallback ensures no chunk exceeds the size limit
//
//  Parameters:
//    chunkSize   = 1000 chars — balances granularity vs context
//    chunkOverlap =  200 chars — keeps boundary sentences intact

class RecursiveCharacterTextSplitter {
  constructor({ chunkSize = 1000, chunkOverlap = 200 } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = ["\n\n", "\n", ". ", " ", ""];
  }

  /** Split pages into chunks with metadata. */
  splitDocuments(pages) {
    const allChunks = [];
    let globalIndex = 0;

    for (const page of pages) {
      const textChunks = this.splitText(page.text);
      for (const text of textChunks) {
        allChunks.push({
          text,
          metadata: {
            pageNumber: page.pageNumber,
            chunkIndex: globalIndex++,
          },
        });
      }
    }

    return allChunks;
  }

  /** Split a single string into chunks. */
  splitText(text) {
    return this._split(text, this.separators);
  }

  _split(text, separators) {
    if (!text || text.length <= this.chunkSize) return text ? [text] : [];

    // Find the first separator that exists in the text
    const sep = separators.find((s) => s === "" || text.includes(s));
    if (sep === undefined) return [text];

    const parts = sep === "" ? [...text] : text.split(sep);
    const chunks = [];
    let current = "";

    for (const part of parts) {
      const combined = current ? current + sep + part : part;

      if (combined.length > this.chunkSize && current) {
        chunks.push(current.trim());
        // Carry over the tail for overlap
        const overlap = current.slice(
          Math.max(0, current.length - this.chunkOverlap)
        );
        current = overlap ? overlap + sep + part : part;
      } else {
        current = combined;
      }
    }

    if (current.trim()) chunks.push(current.trim());

    // Recursively split any chunks that are still too large
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

/**
 * Full ingestion: load → chunk → embed → store in Qdrant.
 * Returns { collectionName, fileName, totalChunks, totalPages }.
 */
async function indexDocument(filePath, fileName, onProgress) {
  const collectionName = `doc_${Date.now()}`;

  // 1 — Load
  if (onProgress) onProgress("loading", "Loading document…");
  const pages = await loadDocument(filePath);
  if (!pages.length) throw new Error("No text content found in the document");

  // 2 — Chunk
  if (onProgress) onProgress("chunking", "Chunking document…");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const chunks = splitter.splitDocuments(pages);
  if (!chunks.length) throw new Error("No chunks generated from document");

  // 3 — Embed
  if (onProgress)
    onProgress("embedding", `Embedding ${chunks.length} chunks…`);
  const embeddings = await embedBatch(
    chunks.map((c) => c.text),
    (done, total) => {
      if (onProgress) onProgress("embedding", `Embedding ${done}/${total}`);
    }
  );

  // 4 — Create Qdrant collection
  if (onProgress) onProgress("storing", "Storing vectors in Qdrant…");
  await qdrant.createCollection(collectionName, {
    vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
  });

  // 5 — Upsert in batches of 100
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

  if (onProgress) onProgress("done", "Document indexed successfully!");

  return {
    collectionName,
    fileName,
    totalChunks: chunks.length,
    totalPages: pages.length,
  };
}

// ── Retrieval + Generation ─────────────────────────────────────────────────────

/**
 * Answer a user question grounded in the given Qdrant collection.
 * Returns { answer, sources }.
 */
async function chat(question, collectionName) {
  // 1 — Embed the question
  const queryVector = await embedText(question);

  // 2 — Retrieve top-5 similar chunks
  const results = await qdrant.search(collectionName, {
    vector: queryVector,
    limit: 5,
    with_payload: true,
  });

  const contextChunks = results.map((r) => ({
    text: r.payload.text,
    pageNumber: r.payload.pageNumber,
    score: r.score,
  }));

  // 3 — Build context string
  const contextStr = contextChunks
    .map(
      (c, i) =>
        `[Chunk ${i + 1} | Page ${c.pageNumber} | Relevance: ${(c.score * 100).toFixed(1)}%]\n${c.text}`
    )
    .join("\n\n---\n\n");

  // 4 — Call LLM with grounding prompt
  const systemPrompt = `You are a document Q&A assistant. Answer ONLY based on the provided context chunks from the uploaded document.

Rules:
1. If the answer is found in the context, provide it with specific details.
2. If the answer is NOT in the context, say "I couldn't find this information in the uploaded document."
3. NEVER use your general knowledge — only the document content.
4. Always cite the page number(s) where you found the information, like [Page X].
5. If the context is ambiguous, say so and quote the relevant passages.
6. Keep answers concise but thorough.
7. Use markdown formatting for better readability.

Context from document:
${contextStr}`;

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  return {
    answer: response.choices[0].message.content,
    sources: contextChunks.map((c) => ({
      pageNumber: c.pageNumber,
      preview: c.text.slice(0, 150) + (c.text.length > 150 ? "…" : ""),
      relevance: c.score,
    })),
  };
}

// ── Collection Management ──────────────────────────────────────────────────────

async function listCollections() {
  const res = await qdrant.getCollections();
  return res.collections;
}

async function deleteCollection(name) {
  await qdrant.deleteCollection(name);
}

// ── Exports ────────────────────────────────────────────────────────────────────

export {
  indexDocument,
  chat,
  listCollections,
  deleteCollection,
  getEmbedder,
};
