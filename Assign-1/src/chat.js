// ──────────────────────────────────────────
//  Chat logic — API calls & message rendering
// ──────────────────────────────────────────

/** @type {{ role: string, content: string }[]} */
let conversationHistory = [];

/**
 * Call the /api/chat serverless function.
 * @param {string} systemPrompt  – the current persona's system prompt
 * @param {{ role: string, content: string }[]} messages – conversation history
 * @returns {Promise<string>} – the assistant's reply text
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

/**
 * Get the current conversation history.
 */
export function getHistory() {
  return conversationHistory;
}

/**
 * Add a message to history.
 */
export function pushHistory(role, content) {
  conversationHistory.push({ role, content });
}

/**
 * Clear conversation history.
 */
export function clearHistory() {
  conversationHistory = [];
}

/**
 * Create a message DOM element.
 * @param {'user' | 'bot'} role
 * @param {string} text
 * @param {string} avatar – avatar initials
 * @returns {HTMLElement}
 */
export function createMessageEl(role, text, avatar) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const avatarEl = document.createElement('div');
  avatarEl.className = 'message-avatar';
  avatarEl.textContent = role === 'user' ? 'You' : avatar;

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  msg.appendChild(avatarEl);
  msg.appendChild(content);
  return msg;
}

/**
 * Create an error message DOM element.
 * @param {string} text
 * @returns {HTMLElement}
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
