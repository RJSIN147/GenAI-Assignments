# Assignment 03 — Google NotebookLM RAG Clone

A RAG-powered web application where you can upload any PDF or plain-text document and have a conversation with it. Answers are **grounded in the document's actual content** — not AI imagination.

## How It Works

1. **Upload** a PDF or TXT file via the web UI (drag-and-drop supported)
2. The system **extracts text** (page-by-page for PDFs)
3. Text is **chunked** using Recursive Character Text Splitting (see below)
4. Chunks are **embedded** locally using `all-MiniLM-L6-v2` (no API key needed)
5. Embeddings are **stored** in a Qdrant vector database
6. When you ask a question, it is embedded and the **top-5 most similar chunks** are retrieved
7. The LLM receives those chunks as context and **generates a grounded answer** with page citations

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ES Modules) |
| Backend | Express.js |
| PDF Parsing | `pdf-parse` |
| Chunking | Custom RecursiveCharacterTextSplitter |
| Embeddings | `@xenova/transformers` (all-MiniLM-L6-v2) — local, free |
| Vector DB | Qdrant Cloud via `@qdrant/js-client-rest` |
| LLM | `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter |
| Frontend | React + Vite (built to `public/`) |

## Chunking Strategy — Recursive Character Text Splitting

### What it is

A text splitting algorithm that **respects natural text boundaries** by trying a hierarchy of separators before falling back to smaller ones.

### How it works

1. Try to split by `\n\n` (paragraph breaks) first
2. If a chunk is still too large, fall back to `\n` (line breaks)
3. Then `. ` (sentence ends)
4. Then ` ` (word boundaries)
5. Finally, character-by-character as a last resort

### Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `chunkSize` | 1000 chars | Balances granularity (good for retrieval) vs. context (keeps coherent paragraphs) |
| `chunkOverlap` | 200 chars | Prevents losing context at chunk boundaries; sentences spanning two chunks are preserved in both |

### Why this over page-based chunking?

- PDF page breaks are **arbitrary** — they split paragraphs mid-sentence
- Recursive splitting **keeps paragraphs together** whenever possible
- Overlap means a question about content near a boundary still retrieves the right chunk
- Well-proven for RAG pipelines in production systems

## Prerequisites

1. **Node.js** ≥ 18
2. **Qdrant Cloud** account — free tier at [cloud.qdrant.io](https://cloud.qdrant.io/) (or run locally via Docker: `docker run -d -p 6333:6333 qdrant/qdrant`)
3. **OpenRouter API Key** — for the LLM at [openrouter.ai](https://openrouter.ai/) (embeddings are local, no extra key needed)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables:

   ```bash
   cp .env.example .env
   # Fill in OPENROUTER_API_KEY, QDRANT_URL, and QDRANT_API_KEY
   ```

3. Run the server:

   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

> **First run:** The embedding model (~80 MB) will be downloaded automatically. Subsequent runs use the cached model.

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/upload` | Upload & index a document (multipart/form-data, field: `document`) |
| `POST` | `/api/chat` | `{ question, collectionName }` → grounded answer with sources |
| `GET` | `/api/collections` | List all indexed documents |
| `DELETE` | `/api/collection/:name` | Delete an indexed document |

## Project Structure

```text
Assign-3/
├── server.js          # Express backend — API routes
├── rag.js             # RAG pipeline — load, chunk, embed, index, retrieve, generate
├── package.json
├── .env               # Your secrets (not committed)
├── .env.example       # Template with all required variables
├── .gitignore
├── README.md
├── uploads/           # Temporary uploaded files (auto-cleaned after indexing)
├── data/              # Persistent Qdrant collection metadata (collections.json)
├── public/            # Pre-built frontend (output of `npm run build:frontend`)
│   ├── index.html
│   ├── favicon.svg
│   └── assets/        # Vite-bundled JS + CSS
└── frontend/          # React + Vite source
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── App.css
    │   └── index.css
    ├── index.html
    ├── vite.config.js
    └── package.json
```

> **Rebuild the frontend** after editing `frontend/src/`: run `npm run build:frontend` from the project root.
