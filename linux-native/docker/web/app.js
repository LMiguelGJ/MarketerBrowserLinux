// Shows the remote display full-viewport. The only UI is the token form.
import RFB from '/novnc/core/rfb.js';

const form = document.getElementById('form');
const tokenInput = document.getElementById('token');
const connectButton = document.getElementById('connect');
const message = document.getElementById('message');
const login = document.getElementById('login');
const screen = document.getElementById('screen');

// Exposed so end-to-end tests can wait on a state instead of sleeping.
window.__mblState = 'idle';

let rfb = null;

function setState(state) {
  window.__mblState = state;
  document.documentElement.dataset.state = state;
}

function showLogin(text) {
  screen.hidden = true;
  login.hidden = false;
  connectButton.disabled = false;
  message.textContent = text ?? '';
  setState('login');
  tokenInput.focus();
}

function connect(token) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/websockify?token=${encodeURIComponent(token)}`;

  connectButton.disabled = true;
  message.textContent = '';
  setState('connecting');

  screen.replaceChildren();
  rfb = new RFB(screen, url);
  rfb.scaleViewport = true; // fit the viewport, keeping the aspect ratio
  rfb.resizeSession = false; // the display size is fixed by the server
  rfb.background = '#000';
  rfb.viewOnly = false;
  rfb.focusOnClick = true;

  rfb.addEventListener('connect', () => {
    login.hidden = true;
    screen.hidden = false;
    rfb.focus();
    setState('connected');
  });

  rfb.addEventListener('disconnect', () => {
    const wasConnected = window.__mblState === 'connected';
    rfb = null;
    sessionStorage.removeItem('mbl-token');
    showLogin(
      wasConnected
        ? 'The connection was closed.'
        : 'Could not connect: wrong token or the service is not available.',
    );
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return;
  sessionStorage.setItem('mbl-token', token);
  connect(token);
});

// A page refresh keeps the session usable within the same tab.
const saved = sessionStorage.getItem('mbl-token');
if (saved) {
  tokenInput.value = saved;
  connect(saved);
} else {
  setState('login');
  tokenInput.focus();
}
