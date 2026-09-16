// content.js — TubeWeave
//
// YouTube (youtube.com) es una SPA construida con Polymer/Web Components:
// al navegar entre home/video/búsqueda NO hay recarga de página, así que un
// content script "normal" que corre una sola vez no alcanza. Esto se resuelve
// combinando tres mecanismos:
//
//   1) Carga inicial en document_idle (ver manifest.json) + llamada explícita
//      a applyAll() al arrancar.
//   2) El evento "yt-navigate-finish", que YouTube dispara en `window` cada
//      vez que termina una navegación interna (home -> video, video -> video,
//      etc). Es el punto de reaplicación más confiable.
//   3) Un MutationObserver sobre <html>, porque YouTube también re-renderiza
//      secciones sin disparar navigate-finish (scroll infinito, carga diferida
//      de comentarios/chips/etc).
//
// Para que el CSS no dependa de selectores frágiles repetidos en el JS, cada
// feature "simple" (pura cuestión de visibilidad/estilo) se resuelve poniendo
// una clase en <html>; las reglas reales viven en styles.css. Así, si YouTube
// cambia un selector interno, alcanza con tocar un solo archivo.
//
// La única feature que necesita JS de verdad es el modo teatro forzado,
// porque el <video> interno necesita que el propio código de YouTube
// recalcule tamaños al activarlo (no alcanza con estirarlo por CSS).

(() => {
  'use strict';

  // Debe coincidir con los DEFAULT_SETTINGS de popup.js y background.js.
  const DEFAULT_SETTINGS = {
    focusMode: false, // 1. Botón en la página: oculta recomendados + player "fullscreen"
    hideShorts: false, // 2. Ocultar Shorts en home/búsqueda
    hideComments: false, // 3. Ocultar comentarios
    wideTheaterMode: false, // 4. Forzar modo teatro (reproductor ancho)
    hideChipsBar: false, // 5. Ocultar barra de chips/categorías
    compactGrid: false, // 6. Grid del home en modo lista compacta
    hideLikeCount: false, // 7. Ocultar solo el número de Me gusta/No me gusta
    searchOnlyMode: false, // 8. Modo solo búsqueda (oculta el home)
  };

  // Mapeo feature -> clase CSS en <html>. Las reglas están en styles.css.
  const BODY_CLASS_MAP = {
    focusMode: 'ytx-focus-mode',
    hideShorts: 'ytx-hide-shorts',
    hideComments: 'ytx-hide-comments',
    hideChipsBar: 'ytx-hide-chips',
    compactGrid: 'ytx-compact-grid',
    hideLikeCount: 'ytx-hide-like-count',
    searchOnlyMode: 'ytx-search-only',
  };

  const FOCUS_BUTTON_ID = 'ytx-focus-toggle-btn';

  let currentSettings = { ...DEFAULT_SETTINGS };

  // ---------- Helpers defensivos ----------
  // Ningún selector debería poder tirar abajo el resto del script: YouTube
  // cambia marcado seguido y un selector roto no debe romper las demás
  // features.

  function safeQuery(selector, root = document) {
    try {
      return root.querySelector(selector);
    } catch (err) {
      console.warn('[TubeWeave] selector inválido:', selector, err);
      return null;
    }
  }

  // ---------- Features basadas en clases (puro CSS) ----------

  function applyClassToggles(settings) {
    const root = document.documentElement;
    for (const [key, className] of Object.entries(BODY_CLASS_MAP)) {
      try {
        root.classList.toggle(className, Boolean(settings[key]));
      } catch (err) {
        console.warn('[TubeWeave] no se pudo togglear', className, err);
      }
    }
  }

  // ---------- Feature 4: modo teatro forzado ----------
  //
  // No se puede lograr solo con CSS: si solo agrandamos el contenedor por
  // fuera, el <video> interno de YouTube no se recalcula y quedan barras
  // negras o un layout roto. Lo correcto es clickear el botón real de
  // "Theater mode" para que el propio reproductor de YouTube haga el resize.
  //
  // Comportamiento: solo FORZAMOS que se active. Si además el usuario lo
  // desactiva a mano estando el toggle prendido, lo volvemos a activar en la
  // próxima pasada del observer (eso es justamente "forzar modo teatro
  // siempre", como pide la spec).
  function applyTheaterMode(enabled) {
    if (!enabled) return;

    const flexy = safeQuery('ytd-watch-flexy');
    if (!flexy) return; // no estamos en una página de video

    const isTheaterAlready = flexy.hasAttribute('theater');
    if (isTheaterAlready) return;

    const sizeButton = safeQuery('.ytp-size-button');
    sizeButton?.click();
  }

  // ---------- Feature 1: botón de "modo foco" inyectado en la página ----------
  //
  // Según el wireframe: un botón fijo como primera fila de la columna de
  // recomendados (arriba de la lista/chips), que oculta el resto de esa
  // columna y agranda el player casi a pantalla completa, pero SIN usar la
  // Fullscreen API real (hay que poder seguir cambiando de pestaña o de URL).
  //
  // Se inserta como PRIMER HIJO de #secondary (no de #secondary-inner, que es
  // lo que YouTube reemplaza en sus re-renders) para que:
  //   1) quede en el flujo normal del layout, empujando hacia abajo las
  //      tabs/chips propias de YouTube en vez de tapizarlas (antes vivía en
  //      document.body con position:fixed y quedaba flotando encima de esas
  //      tabs, ver captura del bug).
  //   2) al activar el modo foco, styles.css puede ocultar el resto de
  //      #secondary (">*:not(#btn)") sin ocultar el botón, así se puede
  //      seguir clickeando para revertir.
  function ensureFocusButton() {
    const flexy = safeQuery('ytd-watch-flexy');
    const existingBtn = document.getElementById(FOCUS_BUTTON_ID);

    const secondary = flexy && safeQuery('#secondary', flexy);
    if (!flexy || !secondary) {
      // No estamos en una página de video, o la sidebar todavía no renderizó.
      existingBtn?.remove();
      return;
    }

    let btn = existingBtn;
    if (!btn) {
      btn = document.createElement('button');
      btn.id = FOCUS_BUTTON_ID;
      btn.type = 'button';
      btn.className = 'ytx-focus-btn';
      btn.addEventListener('click', () => {
        chrome.storage.sync.set({ focusMode: !currentSettings.focusMode });
      });
    }

    // YouTube re-renderiza #secondary-inner seguido; si eso desplaza nuestro
    // botón, lo volvemos a poner como primer hijo en la próxima pasada.
    if (secondary.firstElementChild !== btn) {
      secondary.prepend(btn);
    }

    btn.textContent = currentSettings.focusMode ? 'Mostrar recomendados' : 'Ocultar recomendados';
    btn.classList.toggle('is-active', currentSettings.focusMode);
  }

  // ---------- Orquestación ----------

  function applyAll() {
    applyClassToggles(currentSettings);
    // El modo foco también fuerza teatro (para el efecto "fullscreen dentro
    // de la pestaña"), independientemente del toggle de teatro del popup.
    if (currentSettings.wideTheaterMode || currentSettings.focusMode) {
      applyTheaterMode(true);
    }
    ensureFocusButton();
  }

  // ---------- Storage ----------

  function loadSettingsAndApply() {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...stored };
      applyAll();
    });
  }

  // Cambios desde el popup (o desde storage.sync en otro dispositivo) llegan
  // acá y se reaplican al instante, sin recargar la pestaña.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    let changed = false;
    for (const key of Object.keys(changes)) {
      if (key in currentSettings) {
        currentSettings[key] = changes[key].newValue;
        changed = true;
      }
    }
    if (changed) applyAll();
  });

  // ---------- Reaplicación en SPA ----------

  // Punto de reaplicación principal: se dispara cuando Polymer terminó de
  // renderizar la nueva "página" interna.
  window.addEventListener('yt-navigate-finish', applyAll);

  // Red de seguridad: YouTube también re-renderiza secciones sin navegar
  // (scroll infinito, chips, comentarios que cargan tarde, etc). Se debouncea
  // para no reaplicar en cada micro-mutación del DOM.
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      applyAll();
    }, 250);
  });

  function startObserving() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ---------- Init ----------

  function init() {
    loadSettingsAndApply();
    startObserving();
  }

  init();
})();
