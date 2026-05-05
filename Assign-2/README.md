# Assignment 02 - AI Agent CLI Tool (Live Website Clone)

A conversational CLI agent that clones websites from live scraped evidence instead of hardcoded templates. It can clone the Scaler website by default using `https://www.scaler.com/`.

## How It Works

1. The user asks the agent to clone a website.
2. The agent calls `fetchWebContent(url)` to scrape the real page structure, headings, links, image URLs, colors, and a body HTML snippet.
3. The model uses that evidence to write custom `index.html`, `styles.css`, and `script.js` files.
4. The agent calls `reviewClone(...)` to check the generated files.
5. If required elements are missing, the model patches the files and reviews again.
6. All generated files are stored in `output/`.
7. The agent opens `output/index.html` in the browser.

## Tech Stack

- Runtime: Node.js with ES Modules
- LLM: OpenRouter/OpenAI-compatible chat completions with tool calling
- Website extraction: Node `fetch` plus HTML/CSS extraction helpers
- Output: static HTML, CSS, and JavaScript

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up your API key:

   ```bash
   cp .env.example .env
   # Add OPENROUTER_API_KEY, or API_KEY/BASE_URL/MODEL_NAME if using another compatible provider
   ```

3. Run the agent:

   ```bash
   npm start
   ```

4. Try one of these prompts:

   ```text
   Clone the Scaler website
   Clone https://www.scaler.com/
   Clone https://example.com/
   ```

## Tools Available

| Tool | Description |
|------|-------------|
| `fetchWebContent(url)` | Scrapes live HTML context, images, links, headings, colors, and SVG/logo snippets |
| `writeFile(filePath, content)` | Writes generated files inside `output/` |
| `readFile(filePath)` | Reads generated files from `output/` |
| `reviewClone(target)` | Reviews generated files and reports missing required clone elements |
| `openInBrowser(filePath)` | Opens an output HTML file in the browser |

## Project Structure

```text
Assign-2/
├── index.js          # Main CLI agent and OpenAI tool-calling loop
├── tools.js          # Scraper and file/browser tools
├── package.json
├── .env              # API key, not committed
├── .env.example
├── .gitignore
├── README.md
└── output/           # Generated clone files
```

## Notes

This project does not use a prebuilt Scaler template. The clone is generated from live page evidence returned by the scraper.
