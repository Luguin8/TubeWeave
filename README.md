# TubeWeave

TubeWeave is a Manifest V3 browser extension that gives you fine-grained control over YouTube's layout. Toggle features on or off from a popup panel and see them applied instantly on `youtube.com`, no page reload required.

## Features

- **Focus mode** — a button injected directly on the video page (top area) that hides the recommended videos sidebar and forces theater mode, giving the player a near-fullscreen feel without leaving the tab or using the real Fullscreen API.
- **Hide Shorts** — removes Shorts shelves from the home feed and search results.
- **Hide comments** — hides the comments section under videos.
- **Force theater mode** — automatically switches every video to the wide theater layout.
- **Hide category chips** — removes the row of category chips above the home feed.
- **Compact grid** — replaces the large home feed cards with a compact list layout.
- **Hide like count** — keeps the Like/Dislike buttons but hides the numeric counts.
- **Search-only mode** — hides the entire home feed, leaving just the search bar.

All preferences are stored in `chrome.storage.sync`, so they persist across sessions and sync across devices signed into the same browser profile.

## How it works

YouTube is a single-page application (Polymer/Web Components), so a content script that runs only once isn't enough. TubeWeave reapplies its settings through three mechanisms:

1. Initial load at `document_idle`.
2. The `yt-navigate-finish` event, fired by YouTube on every internal navigation (home → video, video → video, etc.).
3. A debounced `MutationObserver` on `<html>` that catches re-renders YouTube performs without a full navigation (infinite scroll, lazily loaded comments/chips, etc).

Simple visibility/style features are implemented by toggling CSS classes on `<html>`, with the actual rules living in `styles.css` — this keeps the JS resilient to YouTube changing its internal markup. Forced theater mode is the one feature that needs real JS: it clicks YouTube's own theater-mode button so the internal `<video>` element is properly resized by YouTube's own code.

Settings changes made in the popup are written to `chrome.storage.sync` and picked up by the content script via `chrome.storage.onChanged`, so changes apply instantly across every open YouTube tab.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration (permissions, content scripts, popup, icons). |
| `background.js` | Service worker; seeds default settings in `chrome.storage.sync` on install. |
| `content.js` | Injected into `youtube.com`; applies all features and keeps them in sync with storage and SPA navigation. |
| `styles.css` | CSS rules driven by the classes toggled in `content.js`. |
| `popup.html` / `popup.js` / `popup.css` | Extension popup UI for toggling each feature. |
| `icons/` | Extension icons. |

## Installation (development)

1. Clone this repository.
2. Open `chrome://extensions` (or the equivalent page in a Chromium-based browser).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder.
5. Open [youtube.com](https://www.youtube.com) and use the TubeWeave icon in the toolbar to toggle features.

## Permissions

- `storage` — to persist user preferences.
- Host permission on `*://www.youtube.com/*` — to inject the content script and stylesheet.

## License

No license specified yet.
