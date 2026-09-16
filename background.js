// background.js — service worker de Manifest V3.
//
// Único trabajo: al instalar la extensión, asegurar que chrome.storage.sync
// tenga todas las preferencias con su valor por defecto (false). No hace
// falta pasaje de mensajes entre popup y content script: se comunican de
// forma indirecta a través de chrome.storage.onChanged.

// Debe coincidir con los DEFAULT_SETTINGS de content.js y popup.js.
const DEFAULT_SETTINGS = {
  focusMode: false,
  hideShorts: false,
  hideComments: false,
  wideTheaterMode: false,
  hideChipsBar: false,
  compactGrid: false,
  hideLikeCount: false,
  searchOnlyMode: false,
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;

  const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in existing)) toSet[key] = value;
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }
});
