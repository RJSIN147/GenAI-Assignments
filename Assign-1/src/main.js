// ──────────────────────────────────────────
//  Main — App init, persona switching, events
// ──────────────────────────────────────────
import { personas } from './personas.js';
import {
  callAPI, getHistory, pushHistory, clearHistory,
  createMessageEl, createErrorEl,
} from './chat.js';

// ── DOM refs ──
const cardButtons       = document.querySelectorAll('.persona-card');
const messagesContainer = document.getElementById('messages-container');
const typingIndicator   = document.getElementById('typing-indicator');
const typingAvatar      = document.getElementById('typing-avatar');
const chipsContainer    = document.getElementById('suggestion-chips');
const userInput         = document.getElementById('user-input');
const sendBtn           = document.getElementById('send-btn');
const chatArea          = document.getElementById('chat-area');
const chatContent       = document.getElementById('chat-content');
const newChatBtn        = document.getElementById('new-chat-btn');

// ── State ──
let activePersonaId = 'anshuman';
let isLoading = false;

// ── Initialise ──
function init() {
  switchPersona('anshuman', false);
  wireEvents();
}

// ── Event wiring ──
function wireEvents() {
  cardButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.persona;
      if (id !== activePersonaId && !isLoading) switchPersona(id, true);
    });
  });

  sendBtn.addEventListener('click', handleSend);

  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = userInput.value.trim() === '';
  });

  newChatBtn.addEventListener('click', () => {
    if (!isLoading) switchPersona(activePersonaId, true);
  });
}

// ── Switch persona with optional animation ──
function switchPersona(personaId, animate = true) {
  const persona = personas[personaId];

  if (animate) {
    // Fade out → update → fade in
    chatContent.classList.add('fade-out');
    chatContent.classList.remove('visible');
    setTimeout(() => {
      applyPersona(personaId, persona);
      chatContent.classList.remove('fade-out');
      chatContent.classList.add('visible');
    }, 250);
  } else {
    applyPersona(personaId, persona);
  }
}

function applyPersona(personaId, persona) {
  activePersonaId = personaId;

  // Update card states
  cardButtons.forEach((btn) => {
    const isActive = btn.dataset.persona === personaId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
    // Move online dot to active card
    const dot = btn.querySelector('.online-dot');
    if (dot) dot.remove();
    if (isActive) {
      const avatarEl = btn.querySelector('.card-avatar');
      const dotEl = document.createElement('span');
      dotEl.className = 'online-dot';
      avatarEl.appendChild(dotEl);
    }
  });

  // Update typing avatar
  typingAvatar.textContent = persona.avatar;

  // Update CSS accent colors
  const root = document.documentElement;
  root.style.setProperty('--accent', persona.accentColor);
  root.style.setProperty('--accent-glow', persona.accentColor + '40');
  root.style.setProperty('--accent-soft', persona.accentColor + '1F');
  root.style.setProperty('--accent-gradient', persona.accentGradient);

  // Reset chat
  clearHistory();
  messagesContainer.innerHTML = '';
  typingIndicator.classList.add('hidden');

  // Show welcome hero
  showWelcomeHero(persona);

  // Show suggestion chips
  renderChips(persona);

  // Reset input
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
}

// ── Welcome Hero ──
function showWelcomeHero(persona) {
  const hero = document.createElement('div');
  hero.className = 'welcome-hero';
  hero.innerHTML = `
    <div class="hero-avatar-ring">
      <div class="hero-avatar-inner">${persona.avatar}</div>
    </div>
    <span class="hero-emoji">${persona.emoji}</span>
    <h2 class="hero-name">${persona.name}</h2>
    <p class="hero-tagline">${persona.tagline}</p>
    <p class="hero-description">${persona.description}</p>
  `;
  messagesContainer.appendChild(hero);
}

// ── Suggestion chips (2×2 grid with icons) ──
function renderChips(persona) {
  chipsContainer.innerHTML = '';
  persona.suggestionChips.forEach((chip) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.innerHTML = `
      <span class="chip-icon">${chip.icon}</span>
      <span class="chip-text">${chip.text}</span>
    `;
    btn.addEventListener('click', () => {
      if (!isLoading) {
        userInput.value = chip.text;
        sendBtn.disabled = false;
        handleSend();
      }
    });
    chipsContainer.appendChild(btn);
  });
}

// ── Handle send ──
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isLoading) return;

  isLoading = true;
  const persona = personas[activePersonaId];

  // Hide chips + welcome on first message
  chipsContainer.innerHTML = '';
  const welcomeHero = messagesContainer.querySelector('.welcome-hero');
  if (welcomeHero) {
    welcomeHero.style.opacity = '0';
    welcomeHero.style.transform = 'translateY(-10px)';
    welcomeHero.style.transition = 'all 0.3s ease';
    setTimeout(() => welcomeHero.remove(), 300);
  }

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
    typingIndicator.classList.add('hidden');

    const botMsg = createMessageEl('bot', reply, persona.avatar);
    messagesContainer.appendChild(botMsg);
    pushHistory('assistant', reply);
  } catch (err) {
    typingIndicator.classList.add('hidden');
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
