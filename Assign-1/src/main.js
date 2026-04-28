// ──────────────────────────────────────────
//  Main — App initialisation & event wiring
// ──────────────────────────────────────────
import { personas } from './personas.js';
import {
  callAPI,
  getHistory,
  pushHistory,
  clearHistory,
  createMessageEl,
  createErrorEl,
} from './chat.js';

// ── DOM refs ──
const tabButtons     = document.querySelectorAll('.persona-tab');
const bannerAvatar   = document.getElementById('banner-avatar');
const bannerName     = document.getElementById('banner-name');
const bannerTitle    = document.getElementById('banner-title');
const messagesContainer = document.getElementById('messages-container');
const typingIndicator   = document.getElementById('typing-indicator');
const typingAvatar      = document.getElementById('typing-avatar');
const chipsContainer    = document.getElementById('suggestion-chips');
const userInput      = document.getElementById('user-input');
const sendBtn        = document.getElementById('send-btn');
const chatArea       = document.getElementById('chat-area');

// ── State ──
let activePersonaId = 'anshuman';
let isLoading = false;

// ── Initialise ──
function init() {
  switchPersona('anshuman');
  wireEvents();
}

// ── Event wiring ──
function wireEvents() {
  // Persona tab clicks
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.persona;
      if (id !== activePersonaId && !isLoading) {
        switchPersona(id);
      }
    });
  });

  // Send button
  sendBtn.addEventListener('click', handleSend);

  // Enter key (shift+enter for newline)
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = userInput.value.trim() === '';
  });
}

// ── Switch persona ──
function switchPersona(personaId) {
  activePersonaId = personaId;
  const persona = personas[personaId];

  // Update tabs
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.persona === personaId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  // Update banner
  bannerAvatar.textContent = persona.avatar;
  bannerName.textContent = persona.name;
  bannerTitle.textContent = persona.title;

  // Update typing avatar
  typingAvatar.textContent = persona.avatar;

  // Update CSS accent colors
  const root = document.documentElement;
  root.style.setProperty('--accent', persona.accentColor);
  root.style.setProperty('--accent-glow', persona.accentColor + '40');
  root.style.setProperty('--accent-soft', persona.accentColor + '1F');

  // Reset chat
  clearHistory();
  messagesContainer.innerHTML = '';
  typingIndicator.classList.add('hidden');

  // Show welcome
  showWelcome(persona);

  // Show chips
  renderChips(persona);

  // Reset input
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
}

// ── Welcome message ──
function showWelcome(persona) {
  const welcome = document.createElement('div');
  welcome.className = 'welcome-message';
  welcome.innerHTML = `
    <span class="welcome-emoji">👋</span>
    <h3>Chat with ${persona.name}</h3>
    <p>${persona.title}. Ask anything about tech, career, learning, or their journey.</p>
  `;
  messagesContainer.appendChild(welcome);
}

// ── Suggestion chips ──
function renderChips(persona) {
  chipsContainer.innerHTML = '';
  persona.suggestionChips.forEach((text) => {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      if (!isLoading) {
        userInput.value = text;
        sendBtn.disabled = false;
        handleSend();
      }
    });
    chipsContainer.appendChild(chip);
  });
}

// ── Handle send ──
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;

  isLoading = true;
  const persona = personas[activePersonaId];

  // Hide chips after first message
  chipsContainer.innerHTML = '';

  // Show user message
  const userMsg = createMessageEl('user', text, 'You');
  messagesContainer.appendChild(userMsg);
  pushHistory('user', text);

  // Clear input
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Show typing indicator
  typingIndicator.classList.remove('hidden');
  scrollToBottom();

  try {
    const reply = await callAPI(persona.systemPrompt, getHistory());

    // Hide typing
    typingIndicator.classList.add('hidden');

    // Show bot reply
    const botMsg = createMessageEl('bot', reply, persona.avatar);
    messagesContainer.appendChild(botMsg);
    pushHistory('assistant', reply);
  } catch (err) {
    // Hide typing
    typingIndicator.classList.add('hidden');

    // Show error
    const errMsg = createErrorEl(
      `Oops! Something went wrong: ${err.message}. Please try again.`
    );
    messagesContainer.appendChild(errMsg);
  }

  isLoading = false;
  scrollToBottom();
}

// ── Scroll helper ──
function scrollToBottom() {
  requestAnimationFrame(() => {
    chatArea.scrollTop = chatArea.scrollHeight;
  });
}

// ── Boot ──
init();
