# ScalerChat — Persona-Based AI Chatbot

> Talk to Scaler/InterviewBit personalities — Anshuman Singh, Abhimanyu Saxena, and Kshitij Mishra — powered by AI.

🔗 **Live Demo**: [Coming Soon — will be deployed on Vercel]

---

## ✨ Features

- **Three distinct AI personas** with deeply researched system prompts
- **Persona switcher** — switch between personalities with a single click; conversation resets automatically
- **Suggestion chips** — quick-start questions tailored to each persona
- **Typing indicator** — animated dots while the AI is generating a response
- **Dark glassmorphism UI** — premium look with gradient accents per persona
- **Mobile responsive** — works seamlessly on all screen sizes
- **Secure API proxy** — API key stored server-side via Vercel serverless function; never exposed to the browser
- **Graceful error handling** — user-friendly messages on API failures

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS + CSS (Vite build) |
| LLM | Groq API (Llama 3.3 70B) |
| Backend | Vercel Serverless Functions |
| Deployment | Vercel |

---

## 📁 Project Structure

```
Assign-1/
├── api/
│   └── chat.js              # Serverless API proxy (Groq)
├── src/
│   ├── index.html            # Main HTML
│   ├── style.css             # Dark theme, glassmorphism, responsive
│   ├── main.js               # App init, event wiring, persona switching
│   ├── chat.js               # Chat logic, API calls, message rendering
│   └── personas.js           # System prompts + suggestion chips
├── prompts.md                # Annotated system prompts (grading doc)
├── reflection.md             # 300-500 word reflection
├── README.md                 # This file
├── .env.example              # Environment variable template
├── .gitignore
├── package.json
├── vite.config.js
└── vercel.json
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- A [Groq API key](https://console.groq.com/) (free tier available)

### Steps

1. **Clone the repo**
   ```bash
   git clone https://github.com/YOUR_USERNAME/GenAI-Assignments.git
   cd GenAI-Assignments/Assign-1
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Groq API key:
   ```
   GROQ_API_KEY=gsk_your_actual_key_here
   ```

4. **Start the dev server**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173`

> **Note**: For local development, you'll also need a local API proxy. See [Local API Proxy](#local-api-proxy) below.

### Local API Proxy

During local development, the Vite dev server proxies `/api` requests. You can run a simple Express server:

```bash
# In a separate terminal, from the Assign-1 directory:
node local-server.js
```

Or deploy to Vercel (even for development) where the serverless functions work out of the box.

---

## 🌐 Deployment (Vercel)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and import your repo
3. Set the **Root Directory** to `Assign-1`
4. Add the environment variable: `GROQ_API_KEY` = your key
5. Deploy!

---

## 📝 Documentation

- [`prompts.md`](./prompts.md) — All three system prompts with inline annotations explaining design decisions
- [`reflection.md`](./reflection.md) — 300-500 word reflection on prompt engineering, GIGO, and improvements

---

## 📸 Screenshots

*Coming soon after deployment*

---

## License

This project was built as Assignment 1 for the Prompt Engineering module at Scaler Academy (GenAI program).
