/**
 * server.js — Express backend for the NotebookLM RAG application.
 *
 * Routes:
 *   POST   /api/upload          Upload & index a document
 *   POST   /api/chat            Ask a question against a collection
 *   GET    /api/collections     List indexed documents
 *   DELETE /api/collection/:name Delete a collection
 */

import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  indexDocument,
  chat,
  listCollections,
  deleteCollection,
  getEmbedder,
} from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure directories ────────────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, "uploads");
const dataDir = path.join(__dirname, "data");
[uploadsDir, dataDir].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Collections metadata (maps Qdrant collection → file info) ─────────────────

const collectionsFile = path.join(dataDir, "collections.json");
let collectionsMap = {};

if (fs.existsSync(collectionsFile)) {
  try {
    collectionsMap = JSON.parse(fs.readFileSync(collectionsFile, "utf-8"));
  } catch {
    collectionsMap = {};
  }
}

function saveCollections() {
  fs.writeFileSync(collectionsFile, JSON.stringify(collectionsMap, null, 2));
}

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Multer config ─────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".txt"].includes(ext)) return cb(null, true);
    cb(new Error("Only PDF and TXT files are supported"));
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Upload & index a document
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const onProgress = (stage, message) => {
      console.log(`  [${stage.toUpperCase()}] ${message}`);
    };

    const result = await indexDocument(req.file.path, req.file.originalname, onProgress);

    // Persist metadata
    collectionsMap[result.collectionName] = {
      fileName: result.fileName,
      totalChunks: result.totalChunks,
      totalPages: result.totalPages,
      uploadedAt: new Date().toISOString(),
    };
    saveCollections();

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }

    res.json({ success: true, ...result, message: "Document indexed successfully" });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Chat with a document
app.post("/api/chat", async (req, res) => {
  try {
    const { question, collectionName } = req.body;
    if (!question || !collectionName) {
      return res.status(400).json({ error: "question and collectionName are required" });
    }

    const result = await chat(question, collectionName);
    res.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message });
  }
});

// List indexed collections
app.get("/api/collections", async (req, res) => {
  try {
    const qdrantCollections = await listCollections();
    const collections = qdrantCollections
      .filter((c) => collectionsMap[c.name])
      .map((c) => ({ name: c.name, ...collectionsMap[c.name] }));

    res.json({ collections });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a collection
app.delete("/api/collection/:name", async (req, res) => {
  try {
    await deleteCollection(req.params.name);
    delete collectionsMap[req.params.name];
    saveCollections();
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Multer error handler ──────────────────────────────────────────────────────
// Must be defined AFTER routes with 4 arguments (err, req, res, next).
// Without this, multer errors (file size, wrong type, disk write) are swallowed
// by Express's default HTML error handler and the client gets no JSON back.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Express error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🚀  NotebookLM RAG Server → http://localhost:${PORT}`);
  console.log(`📄  Upload documents and start chatting!\n`);

  console.log("⏳  Verifying embedding model…");
  try {
    await getEmbedder();
    console.log("✅  Embedding model ready!\n");
  } catch (err) {
    console.error("⚠️  Embedding model failed to load:", err.message);
    console.error("    Uploads will fail until the model is available.");
  }
});
