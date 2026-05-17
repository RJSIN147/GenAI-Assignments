# Assignment 03 - Mini-NotebookLM RAG

A lightweight NotebookLM-style app for uploading documents and chatting with them. This version keeps the assignment stack: Node.js, Express, Qdrant, OpenRouter, and a plain HTML/CSS/JavaScript frontend.

## Features

- Session-based chats stored in browser `localStorage`
- Upload PDF, DOCX, CSV, TXT, or Markdown documents
- Recursive character chunking with overlap
- Local embeddings with `Xenova/all-MiniLM-L6-v2`
- Qdrant vector search filtered by chat session
- Corrective RAG flow: query expansion, retrieval, reranking, optional reformulation, retrieval evaluation, and grounded answer generation
- Streaming assistant responses
- Dark/light theme toggle

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from the example and fill in your keys:

```bash
cp .env.example .env
```

Run the app:

```bash
npm start
```

Open `http://localhost:3000`.

The first document upload downloads the local embedding model into `.model-cache/`.

## Environment

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
QDRANT_URL=https://your-cluster-id.region.cloud.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key_here
BASE_URL=https://openrouter.ai/api/v1
MODEL_NAME=nvidia/nemotron-3-super-120b-a12b:free
UTILITY_MODEL=minimax/minimax-m2.5
QDRANT_COLLECTION=mini_notebooklm_chunks
PORT=3000
```

`QDRANT_API_KEY` is optional if you run Qdrant locally.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Check server and Qdrant connectivity |
| `POST` | `/api/upload` | Multipart upload with `document` and `sessionId`; also accepts JSON `{ text, fileName, sessionId }` |
| `POST` | `/api/chat` | Streams an answer for `{ query, sessionId, history }` |
| `DELETE` | `/api/session` | Deletes all Qdrant vectors for `{ sessionId }` |

## Project Structure

```text
Assign-3/
├── server.js
├── rag.js
├── package.json
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── favicon.svg
├── uploads/
└── .model-cache/
```
