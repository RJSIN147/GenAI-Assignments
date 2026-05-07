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
| Vector DB | Qdrant (Docker) via `@qdrant/js-client-rest` |
| LLM | `xiaomi/mimo-v2-flash` via OpenRouter |
| Frontend | Vanilla HTML + CSS + JS |

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
2. **Docker** — to run Qdrant
3. **OpenRouter API Key** — for the LLM (embeddings are local, no extra key needed)

## Setup

1. Start Qdrant:

   ```bash
   docker run -d -p 6333:6333 -p 6334:6334 qdrant/qdrant
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure your API key:

   ```bash
   cp .env.example .env
   # Edit .env and add your OPENROUTER_API_KEY
   ```

4. Run the server:

   ```bash
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

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
├── .env               # OPENROUTER_API_KEY (not committed)
├── .env.example
├── .gitignore
├── README.md
├── uploads/           # Temporary uploaded files (auto-cleaned)
├── data/              # Persistent collection metadata
└── public/            # Frontend
    ├── index.html
    ├── styles.css
    └── script.js
```
