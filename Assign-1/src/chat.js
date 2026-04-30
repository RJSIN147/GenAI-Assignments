// ──────────────────────────────────────────
//  Chat logic — API calls, markdown, messages
// ──────────────────────────────────────────

/** @type {{ role: string, content: string }[]} */
let conversationHistory = [];

/**
 * Call the /api/chat serverless function.
 */
export async function callAPI(systemPrompt, messages) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error (${res.status})`);
  }
  const data = await res.json();
  return data.reply;
}

export function getHistory() { return conversationHistory; }
export function pushHistory(role, content) { conversationHistory.push({ role, content }); }
export function clearHistory() { conversationHistory = []; }

/**
 * Lightweight Markdown → HTML parser.
 * Handles bold, italic, inline code, and line breaks.
 * Sanitizes HTML to prevent XSS.
 */
export function parseMarkdown(text) {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

/**
 * Get current time string for timestamps.
 */
function getTimeString() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Create a message DOM element with markdown support and timestamp.
 */
export function createMessageEl(role, text, avatar) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const avatarEl = document.createElement('div');
  avatarEl.className = 'message-avatar';
  avatarEl.textContent = role === 'user' ? 'You' : avatar;

  const body = document.createElement('div');
  body.className = 'message-body';

  const content = document.createElement('div');
  content.className = 'message-content';
  if (role === 'bot') {
    content.innerHTML = parseMarkdown(text);
  } else {
    content.textContent = text;
  }

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = getTimeString();

  body.appendChild(content);
  body.appendChild(time);

  msg.appendChild(avatarEl);
  msg.appendChild(body);
  return msg;
}

/**
 * Create an error message DOM element.
 */
export function createErrorEl(text) {
  const msg = document.createElement('div');
  msg.className = 'error-message';

  const icon = document.createElement('div');
  icon.className = 'message-avatar';
  icon.textContent = '⚠';
  icon.style.background = 'rgba(214,48,49,0.15)';
  icon.style.color = '#ff7675';
  icon.style.fontSize = '1rem';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  msg.appendChild(icon);
  msg.appendChild(content);
  return msg;
}
