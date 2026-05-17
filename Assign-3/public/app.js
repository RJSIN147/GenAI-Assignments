const SESSIONS_KEY = "mini_notebooklm_sessions";
const ACTIVE_SESSION_KEY = "mini_notebooklm_active_session";
const THEME_KEY = "mini_notebooklm_theme";

const state = {
  sessions: loadSessions(),
  activeSessionId: localStorage.getItem(ACTIVE_SESSION_KEY),
  uploading: false,
  loading: false,
};

const elements = {
  sidebar: document.getElementById("sidebar"),
  sessionsList: document.getElementById("sessionsList"),
  activeSessionName: document.getElementById("activeSessionName"),
  documentCount: document.getElementById("documentCount"),
  emptyState: document.getElementById("emptyState"),
  chatPanel: document.getElementById("chatPanel"),
  messages: document.getElementById("messages"),
  chatForm: document.getElementById("chatForm"),
  queryInput: document.getElementById("queryInput"),
  sendButton: document.getElementById("sendButton"),
  fileInput: document.getElementById("fileInput"),
  uploadLabel: document.getElementById("uploadLabel"),
  uploadLabelText: document.getElementById("uploadLabelText"),
  uploadStatus: document.getElementById("uploadStatus"),
  themeIcon: document.getElementById("themeIcon"),
};

document.getElementById("newChatButton").addEventListener("click", createNewSession);
document.getElementById("firstChatButton").addEventListener("click", createNewSession);
document.getElementById("openSidebar").addEventListener("click", () => {
  elements.sidebar.classList.add("open");
});
document.getElementById("closeSidebar").addEventListener("click", () => {
  elements.sidebar.classList.remove("open");
});
document.getElementById("themeToggle").addEventListener("click", toggleTheme);
elements.fileInput.addEventListener("change", handleUpload);
elements.chatForm.addEventListener("submit", handleChat);

initializeTheme();
normalizeActiveSession();
render();

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(state.sessions));
  if (state.activeSessionId) {
    localStorage.setItem(ACTIVE_SESSION_KEY, state.activeSessionId);
  } else {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

function normalizeActiveSession() {
  if (state.activeSessionId && state.sessions.some((session) => session.id === state.activeSessionId)) {
    return;
  }
  state.activeSessionId = state.sessions[0]?.id || null;
  saveSessions();
}

function getActiveSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

function createNewSession() {
  const session = {
    id: crypto.randomUUID(),
    name: `Chat ${state.sessions.length + 1}`,
    createdAt: Date.now(),
    messages: [],
    documents: [],
  };

  state.sessions = [session, ...state.sessions];
  state.activeSessionId = session.id;
  saveSessions();
  render();
  elements.sidebar.classList.remove("open");
}

async function deleteSession(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;

  const shouldDelete = confirm(`Delete "${session.name}" and its indexed documents?`);
  if (!shouldDelete) return;

  try {
    await fetch("/api/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch (error) {
    console.error("Failed to delete vectors:", error);
  }

  state.sessions = state.sessions.filter((item) => item.id !== sessionId);
  if (state.activeSessionId === sessionId) {
    state.activeSessionId = state.sessions[0]?.id || null;
  }
  saveSessions();
  render();
}

function selectSession(sessionId) {
  state.activeSessionId = sessionId;
  saveSessions();
  render();
  elements.sidebar.classList.remove("open");
}

async function handleUpload(event) {
  const file = event.target.files?.[0];
  const activeSession = getActiveSession();

  if (!file || !activeSession || state.uploading) {
    elements.fileInput.value = "";
    return;
  }

  state.uploading = true;
  setUploadStatus("Processing document...", "");
  renderControls();

  const formData = new FormData();
  formData.append("document", file);
  formData.append("sessionId", activeSession.id);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed");

    updateSession(activeSession.id, (session) => {
      const documents = session.documents.includes(file.name)
        ? session.documents
        : [...session.documents, file.name];
      const defaultName = /^Chat \d+$/.test(session.name);
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      return {
        ...session,
        documents,
        name: defaultName ? truncate(baseName, 34) : session.name,
      };
    });

    setUploadStatus(`Indexed "${file.name}" (${data.chunks} chunks)`, "success");
  } catch (error) {
    setUploadStatus(error.message, "error");
  } finally {
    state.uploading = false;
    elements.fileInput.value = "";
    render();
  }
}

async function handleChat(event) {
  event.preventDefault();
  const activeSession = getActiveSession();
  const query = elements.queryInput.value.trim();

  if (!activeSession || !query || state.loading || activeSession.documents.length === 0) return;

  const userMessage = { role: "user", content: query };
  const assistantMessage = { role: "assistant", content: "" };
  const history = activeSession.messages.slice(-10);

  updateSession(activeSession.id, (session) => ({
    ...session,
    messages: [...session.messages, userMessage, assistantMessage],
  }));

  state.loading = true;
  elements.queryInput.value = "";
  render();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        sessionId: activeSession.id,
        history,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Chat request failed");
    }

    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullResponse += decoder.decode(value, { stream: true });
      updateLastAssistantMessage(activeSession.id, fullResponse);
      renderMessages();
    }
  } catch (error) {
    updateLastAssistantMessage(activeSession.id, `Error: ${error.message}`);
  } finally {
    state.loading = false;
    render();
  }
}

function updateSession(sessionId, updater) {
  state.sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session;
    return updater(session);
  });
  saveSessions();
}

function updateLastAssistantMessage(sessionId, content) {
  updateSession(sessionId, (session) => {
    const messages = [...session.messages];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") {
        messages[i] = { ...messages[i], content };
        break;
      }
    }
    return { ...session, messages };
  });
}

function render() {
  renderSessions();
  renderMain();
  renderControls();
}

function renderSessions() {
  elements.sessionsList.innerHTML = "";

  if (state.sessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "welcome-note";
    empty.textContent = "No chats yet. Create one to get started.";
    elements.sessionsList.append(empty);
    return;
  }

  for (const session of state.sessions) {
    const row = document.createElement("button");
    row.className = `session-row${session.id === state.activeSessionId ? " active" : ""}`;
    row.type = "button";
    row.addEventListener("click", () => selectSession(session.id));

    const body = document.createElement("span");
    body.className = "session-row__body";
    body.innerHTML = `
      <span class="session-row__name">${escapeHtml(session.name)}</span>
      <span class="session-row__meta">${session.documents.length} document${session.documents.length === 1 ? "" : "s"}</span>
    `;

    const remove = document.createElement("span");
    remove.className = "delete-session";
    remove.textContent = "x";
    remove.setAttribute("role", "button");
    remove.setAttribute("aria-label", `Delete ${session.name}`);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSession(session.id);
    });

    row.append(body, remove);
    elements.sessionsList.append(row);
  }
}

function renderMain() {
  const activeSession = getActiveSession();

  elements.emptyState.hidden = Boolean(activeSession);
  elements.chatPanel.hidden = !activeSession;
  elements.activeSessionName.textContent = activeSession ? activeSession.name : "Create a new chat to begin";
  elements.documentCount.textContent = activeSession
    ? `${activeSession.documents.length} document${activeSession.documents.length === 1 ? "" : "s"}`
    : "";

  if (activeSession) renderMessages();
}

function renderMessages() {
  const activeSession = getActiveSession();
  if (!activeSession) return;

  elements.messages.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "messages__inner";

  if (activeSession.messages.length === 0) {
    const note = document.createElement("div");
    note.className = "welcome-note";
    note.textContent = activeSession.documents.length
      ? "Ask a question about your documents."
      : "Upload a document to get started.";

    if (activeSession.documents.length) {
      const docs = document.createElement("div");
      docs.className = "documents";
      for (const documentName of activeSession.documents) {
        const pill = document.createElement("span");
        pill.className = "document-pill";
        pill.textContent = documentName;
        docs.append(pill);
      }
      note.append(docs);
    }

    inner.append(note);
  }

  for (const message of activeSession.messages) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${message.role}`;

    const bubble = document.createElement("div");
    bubble.className = "message__bubble";
    bubble.innerHTML =
      message.role === "assistant"
        ? renderMarkdown(message.content || (state.loading ? "Thinking..." : ""))
        : escapeHtml(message.content);

    wrapper.append(bubble);
    inner.append(wrapper);
  }

  elements.messages.append(inner);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderControls() {
  const activeSession = getActiveSession();
  const hasDocs = Boolean(activeSession?.documents.length);

  elements.fileInput.disabled = !activeSession || state.uploading;
  elements.uploadLabel.classList.toggle("disabled", !activeSession || state.uploading);
  elements.uploadLabelText.textContent = state.uploading ? "Processing..." : "Upload Document";

  elements.queryInput.disabled = !activeSession || !hasDocs || state.loading;
  elements.queryInput.placeholder = !activeSession
    ? "Create a chat first..."
    : hasDocs
    ? "Ask about your documents..."
    : "Upload a document first...";
  elements.sendButton.disabled = !activeSession || !hasDocs || state.loading;
}

function setUploadStatus(message, variant) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.className = `upload-status ${variant || ""}`.trim();
}

function initializeTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.classList.toggle("dark", saved === "dark");
  elements.themeIcon.textContent = saved === "dark" ? "L" : "D";
}

function toggleTheme() {
  const next = document.documentElement.classList.contains("dark") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  initializeTheme();
}

function renderMarkdown(markdown) {
  const codeBlocks = [];
  const withBlocks = escapeHtml(markdown || "").replace(/```([\s\S]*?)```/g, (_match, code) => {
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return `\n${token}\n`;
  });

  const lines = withBlocks.split("\n");
  const html = [];
  let listOpen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }

    const codeMatch = line.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (codeMatch) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(codeBlocks[Number(codeMatch[1])] || "");
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${formatInline(listMatch[1])}</li>`);
      continue;
    }

    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }

    if (line.startsWith("### ")) {
      html.push(`<h3>${formatInline(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      html.push(`<h2>${formatInline(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      html.push(`<h2>${formatInline(line.slice(2))}</h2>`);
    } else {
      html.push(`<p>${formatInline(line)}</p>`);
    }
  }

  if (listOpen) html.push("</ul>");
  return html.join("");
}

function formatInline(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
