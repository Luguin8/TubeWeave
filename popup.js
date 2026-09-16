// popup.js — lee/escribe chrome.storage.sync y refleja el estado en los checkboxes.
//
// No hace falta mandar mensajes al content script: éste escucha
// chrome.storage.onChanged y se reaplica solo apenas cambia una preferencia,
// incluso si hay varias pestañas de YouTube abiertas al mismo tiempo.

// Debe coincidir con los DEFAULT_SETTINGS de content.js y background.js.
const DEFAULT_SETTINGS = {
  focusMode: false, // sin checkbox propio: se controla con el botón inyectado en la página
  hideShorts: false,
  hideComments: false,
  wideTheaterMode: false,
  hideChipsBar: false,
  compactGrid: false,
  hideLikeCount: false,
  searchOnlyMode: false,
};

const checkboxes = document.querySelectorAll('input[type="checkbox"][data-key]');
const statusEl = document.getElementById('status');
let statusTimer = null;

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    checkboxes.forEach((checkbox) => {
      const key = checkbox.dataset.key;
      checkbox.checked = Boolean(settings[key]);
    });
  });
}

function showStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 1500);
}

checkboxes.forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const key = checkbox.dataset.key;
    chrome.storage.sync.set({ [key]: checkbox.checked }, () => {
      showStatus('Guardado');
    });
  });
});

loadSettings();
