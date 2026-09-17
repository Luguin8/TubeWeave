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

  // ---------- Contexto de extensión invalidado ----------
  //
  // Cuando recargás la extensión en chrome://extensions, las pestañas de
  // YouTube que ya estaban abiertas NO reciben el content.js nuevo: siguen
  // corriendo esta misma copia, pero con un chrome.runtime/chrome.storage
  // que Chrome ya destruyó. Cualquier llamada a chrome.storage.* en ese
  // estado tira "Extension context invalidated" como excepción no atrapada.
  //
  // No hay forma de "revivir" esta copia vieja del script desde acá: la
  // única solución real es recargar la pestaña de YouTube. Lo que sí
  // podemos hacer es detectarlo, cortar el observer/listeners para no
  // seguir intentando cosas, y avisar en consola en vez de dejar que
  // explote sin contexto.
  let contextInvalidated = false;

  function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (err) {
      return false;
    }
  }

  function handleInvalidatedContext() {
    if (contextInvalidated) return;
    contextInvalidated = true;
    console.warn(
      '[TubeWeave] La extensión se actualizó o se recargó desde chrome://extensions. ' +
        'Esta pestaña quedó con una copia vieja del script: recargá la página (F5) para que TubeWeave vuelva a aplicarse.'
    );
    observer.disconnect();
    window.removeEventListener('yt-navigate-finish', applyAll);
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
  // Comportamiento: bidireccional. Si hay que estar en teatro (wideTheaterMode
  // o focusMode) y no lo está, lo activa; si NO hay que estar en teatro y
  // sigue en teatro (por ejemplo, al salir del modo foco), lo desactiva. Así
  // "forzar modo teatro" realmente fuerza en los dos sentidos, y salir del
  // modo foco vuelve todo a la normalidad en vez de dejar el teatro prendido.
  function applyTheaterMode(shouldBeTheater) {
    const flexy = safeQuery('ytd-watch-flexy');
    if (!flexy) return; // no estamos en una página de video

    const isTheaterAlready = flexy.hasAttribute('theater');
    if (shouldBeTheater === isTheaterAlready) return;

    const sizeButton = safeQuery('.ytp-size-button');
    sizeButton?.click();
  }

  // ---------- Feature 1: botón de "modo foco" inyectado en la página ----------
  //
  // Un botón que oculta la lista de recomendados y agranda el player casi a
  // pantalla completa, pero SIN usar la Fullscreen API real (hay que poder
  // seguir cambiando de pestaña o de URL).
  //
  // El botón cambia de posición según el estado, en vez de vivir siempre en
  // el mismo lugar:
  //   - Sidebar visible (focusMode apagado): se inserta como PRIMER HIJO de
  //     #secondary, en el flujo normal, para que empuje hacia abajo las
  //     tabs/chips propias de YouTube en vez de taparlas (antes vivía
  //     siempre en document.body con position:fixed y quedaba flotando
  //     encima de esas tabs).
  //   - Sidebar oculta (focusMode prendido): #secondary entero se oculta con
  //     display:none, así que un botón adentro dejaría de ser clickeable
  //     para revertir. Se reubica como un ícono más dentro de
  //     .ytp-right-controls-right, el grupo de controles nativo del
  //     reproductor (junto a teatro/pantalla completa) para que quede chico
  //     e integrado en vez de un pill gigante flotando encima del video.
  function ensureFocusButton() {
    const flexy = safeQuery('ytd-watch-flexy');
    const existingBtn = document.getElementById(FOCUS_BUTTON_ID);

    if (!flexy) {
      // No estamos en una página de video: no tiene sentido mostrar el botón.
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
        if (!isExtensionContextValid()) {
          handleInvalidatedContext();
          return;
        }
        try {
          chrome.storage.sync.set({ focusMode: !currentSettings.focusMode });
        } catch (err) {
          handleInvalidatedContext();
        }
      });
    }

    if (currentSettings.focusMode) {
      btn.classList.remove('ytx-focus-btn--inline');
      btn.classList.add('ytx-focus-btn--floating');
      const rightControls = safeQuery('.ytp-right-controls-right') || safeQuery('.ytp-right-controls');
      if (rightControls) {
        if (btn.parentElement !== rightControls) {
          rightControls.prepend(btn);
        }
      } else if (btn.parentElement !== document.body) {
        // El reproductor todavía no renderizó sus controles: dejamos el
        // botón flotante momentáneamente para no perderlo.
        document.body.appendChild(btn);
      }
    } else {
      const secondary = safeQuery('#secondary', flexy);
      btn.classList.remove('ytx-focus-btn--floating');
      btn.classList.add('ytx-focus-btn--inline');
      if (secondary) {
        // YouTube re-renderiza #secondary-inner seguido; si eso desplaza
        // nuestro botón, lo volvemos a poner como primer hijo acá.
        if (secondary.firstElementChild !== btn) {
          secondary.prepend(btn);
        }
      } else if (btn.parentElement !== document.body) {
        // La sidebar todavía no renderizó: dejamos el botón flotante
        // momentáneamente para no perderlo.
        document.body.appendChild(btn);
      }
    }

    btn.textContent = currentSettings.focusMode ? 'Mostrar recomendados' : 'Ocultar recomendados';
    btn.classList.toggle('is-active', currentSettings.focusMode);
  }

  // ---------- Orquestación ----------

  function applyAll() {
    applyClassToggles(currentSettings);
    // El modo foco también fuerza teatro (para el efecto "fullscreen dentro
    // de la pestaña"), independientemente del toggle de teatro del popup. Si
    // ninguno de los dos pide teatro, applyTheaterMode lo desactiva.
    applyTheaterMode(currentSettings.wideTheaterMode || currentSettings.focusMode);
    ensureFocusButton();
  }

  // ---------- Storage ----------

  function loadSettingsAndApply() {
    if (!isExtensionContextValid()) {
      handleInvalidatedContext();
      return;
    }
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        if (chrome.runtime.lastError) {
          handleInvalidatedContext();
          return;
        }
        currentSettings = { ...DEFAULT_SETTINGS, ...stored };
        applyAll();
      });
    } catch (err) {
      handleInvalidatedContext();
    }
  }

  // Cambios desde el popup (o desde storage.sync en otro dispositivo) llegan
  // acá y se reaplican al instante, sin recargar la pestaña.
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (!isExtensionContextValid()) {
        handleInvalidatedContext();
        return;
      }
      let changed = false;
      for (const key of Object.keys(changes)) {
        if (key in currentSettings) {
          currentSettings[key] = changes[key].newValue;
          changed = true;
        }
      }
      if (changed) applyAll();
    });
  } catch (err) {
    handleInvalidatedContext();
  }

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
