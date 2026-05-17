import "dotenv/config";
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createChatStream,
  deleteSession,
  healthCheck,
  indexDocumentFile,
  indexDocumentText,
} from "./rag.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".pdf", ".docx", ".csv", ".txt", ".md"].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error("Unsupported file type. Use PDF, DOCX, CSV, TXT, or MD."));
  },
});

app.get("/api/health", async (_req, res) => {
  res.json(await healthCheck());
});

app.post("/api/upload", upload.single("document"), async (req, res, next) => {
  const tempPath = req.file?.path;

  try {
    const sessionId = req.body.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const onProgress = (stage, message) => {
      console.log(`[upload:${sessionId}] ${stage}: ${message}`);
    };

    let result;
    if (req.file) {
      result = await indexDocumentFile({
        filePath: req.file.path,
        fileName: req.file.originalname,
        sessionId,
        onProgress,
      });
    } else if (req.body.text) {
      result = await indexDocumentText({
        text: req.body.text,
        fileName: req.body.fileName || "Untitled document",
        sessionId,
        onProgress,
      });
    } else {
      res.status(400).json({ error: "Upload a document file or provide text" });
      return;
    }

    res.json({
      message: "Indexing completed",
      ...result,
    });
  } catch (error) {
    next(error);
  } finally {
    if (tempPath) {
      fs.promises.unlink(tempPath).catch(() => {});
    }
  }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const { query, sessionId, history } = req.body;
    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await createChatStream({ query, sessionId, history });
    for await (const chunk of stream) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`\n\nError: ${error.message}`);
      res.end();
      return;
    }
    next(error);
  }
});

app.delete("/api/session", async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    await deleteSession(sessionId);
    res.json({ message: "Session deleted" });
  } catch (error) {
    next(error);
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || error.statusCode || 500;
  res.status(status).json({ error: error.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Mini-NotebookLM running at http://localhost:${PORT}`);
});
