/**
 * scripts/download-model.js
 *
 * Pre-downloads the Xenova/all-MiniLM-L6-v2 model into .model-cache/
 * at build/install time so it is ready before the server starts.
 *
 * Run automatically via the "postinstall" npm script.
 */

import { pipeline, env } from "@xenova/transformers";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
env.cacheDir = path.join(__dirname, "..", ".model-cache");

console.log("⏳  Downloading embedding model (Xenova/all-MiniLM-L6-v2)…");
console.log(`    Cache dir: ${env.cacheDir}`);

try {
  await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("✅  Embedding model ready!\n");
} catch (err) {
  // Don't fail the install — the server will retry at startup.
  console.warn("⚠️  Model pre-download failed (will retry at startup):", err.message);
}
