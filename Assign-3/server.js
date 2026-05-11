/**
 * server.js — Express backend for the NotebookLM RAG application.
 *
 * Routes:
 *   POST   /api/upload          Upload & index a document (Async)
 *   GET    /api/status/:jobId   Check indexing status
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

// ── In-memory Job Tracking ─────────────────────────────────────────────────────

const jobs = new Map();

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
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".txt"].includes(ext)) return cb(null, true);
    cb(new Error("Only PDF and TXT files are supported"));
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Upload & index a document (Asynchronous)
app.post("/api/upload", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const jobId = `job_${Date.now()}`;
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // Initialize job status
    jobs.set(jobId, {
      id: jobId,
      status: "pending",
      stage: "loading",
      message: "Starting indexing...",
      progress: 0,
      total: 0,
    });

    // Start indexing in the background (DO NOT AWAIT)
    (async () => {
      try {
        const onProgress = (stage, message) => {
          const job = jobs.get(jobId);
          if (job) {
            job.stage = stage;
            job.message = message;
            
            // Try to extract progress if message contains it (e.g. "Embedding 10/100")
            const progressMatch = message.match(/(\d+)\/(\d+)/);
            if (progressMatch) {
              job.progress = parseInt(progressMatch[1], 10);
              job.total = parseInt(progressMatch[2], 10);
            }
          }
          console.log(`  [${jobId}] [${stage.toUpperCase()}] ${message}`);
        };

        const result = await indexDocument(filePath, fileName, onProgress);

        // Update collections metadata
        collectionsMap[result.collectionName] = {
          fileName: result.fileName,
          totalChunks: result.totalChunks,
          totalPages: result.totalPages,
          uploadedAt: new Date().toISOString(),
        };
        saveCollections();

        // Mark job as done
        jobs.set(jobId, {
          ...jobs.get(jobId),
          status: "completed",
          result: {
            collectionName: result.collectionName,
            fileName: result.fileName,
            totalChunks: result.totalChunks,
            totalPages: result.totalPages,
          },
        });

      } catch (err) {
        console.error(`Indexing error for ${jobId}:`, err);
        jobs.set(jobId, { ...jobs.get(jobId), status: "failed", error: err.message });
      } finally {
        // Clean up temp file
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    })();

    // Respond immediately with the jobId
    res.json({ success: true, jobId, message: "Indexing started in background" });

  } catch (err) {
    console.error("Upload route error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Check indexing status
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
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
app.use((err, req, res, next) => {
  console.error("Express error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`\n🚀  NotebookLM RAG Server → http://localhost:${PORT}`);
  console.log(`📄  Upload documents and start chatting!\n`);
  console.log(`✅  Ready for large documents with Remote Embeddings!\n`);
});
