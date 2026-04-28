// ──────────────────────────────────────────
//  Local development API server
//  Run this alongside `npm run dev` for local testing
//  Usage: node local-server.js
// ──────────────────────────────────────────
import 'dotenv/config';
import http from 'http';

// Dynamically import the serverless handler
const { default: handler } = await import('./api/chat.js');

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Only handle /api/chat
  if (req.url === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        req.body = JSON.parse(body);
      } catch {
        req.body = {};
      }

      // Mimic Vercel's res.status().json() API
      const mockRes = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        },
      };

      await handler(req, mockRes);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`✅ Local API server running at http://localhost:${PORT}/api/chat`);
});
