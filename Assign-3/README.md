# Assignment 03 - Mini-NotebookLM RAG

A lightweight NotebookLM-style application for uploading documents and chatting with them. Built using Node.js, Express, Qdrant, OpenRouter, and a clean Vanilla HTML/CSS/JS frontend.

## Features

- **Session-based Chats**: Create multiple chat sessions, each with its own set of documents.
- **Multi-format Uploads**: Support for PDF, DOCX, CSV, TXT, and Markdown files.
- **Robust RAG Pipeline**:
  - Recursive character chunking with overlap for context preservation.
  - Local embeddings using `Xenova/all-MiniLM-L6-v2`.
  - Qdrant vector search filtered by chat session.
- **Corrective RAG (CRAG)**:
  - Query expansion and reformulation for better retrieval.
  - Retrieval evaluation to ensure context sufficiency.
  - Reranking of retrieved chunks for higher accuracy.
- **Interactive UI**:
  - Real-time streaming assistant responses.
  - Mobile-responsive design with a side-panel for sessions.
  - Dark and light theme support.

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
   Fill in your API keys (OpenRouter and Qdrant).

3. **Run the application**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

> **Note**: The first document upload will download the local embedding model into the `.model-cache/` directory.

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Your OpenRouter API key | (Required) |
| `QDRANT_URL` | Qdrant cluster URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | Qdrant API key | (Optional for local) |
| `BASE_URL` | LLM API base URL | `https://openrouter.ai/api/v1` |
| `MODEL_NAME` | Main LLM model for answers | `nvidia/nemotron-3-super-120b-a12b:free` |
| `UTILITY_MODEL` | Smaller model for RAG utility tasks | `minimax/minimax-m2.5` |
| `QDRANT_COLLECTION` | Qdrant collection name | `mini_notebooklm_chunks` |
| `APP_URL` | Public URL for metadata | `http://localhost:3000` |
| `PORT` | Server port | `3000` |

## API Endpoints

- `GET /api/health`: Check server and vector database connectivity.
- `POST /api/upload`: Upload a document (multipart/form-data) or raw text (JSON).
- `POST /api/chat`: Stream a response for a query within a session.
- `DELETE /api/session`: Remove all vectors associated with a specific session.

## Deployment

The project includes a `railway.json` configuration for easy deployment to Railway. Ensure you set the required environment variables in your deployment dashboard.

## Project Structure

```text
Assign-3/
├── public/             # Static frontend assets
│   ├── app.js          # Main frontend logic
│   ├── index.html      # App entry point
│   ├── styles.css      # App styling (Dark/Light themes)
│   └── favicon.svg     # App icon
├── server.js           # Express server entry point
├── rag.js              # Core RAG pipeline logic
├── railway.json        # Railway deployment configuration
├── .env.example        # Template for environment variables
└── package.json        # Node.js dependencies and scripts
```
