# Vaultwarden Offline

A fully offline password vault browser extension. **No accounts, no sync, no network requests.**

Data comes from Bitwarden / Vaultwarden export files. After import it is stored locally in the browser
using Bitwarden's cipher format, and can be exported back to Vaultwarden at any time —
your data is never locked into this extension.

> English · [中文](README.md)

---

## Features

- **Fully offline** — no accounts, no sync, no telemetry; data lives only on your device
  (the one exception: site favicon fetching, see [Offline Guarantee](#offline-guarantee))
- **100% compatible with Bitwarden / Vaultwarden** — cipher format and export files can be imported back
- **Local encryption** — AES-256-CBC + HMAC-SHA256 (same as Bitwarden), unlock with master password or PIN
- **Full autofill pipeline** — form collection (incl. Shadow DOM / iframes), field matching, fill execution,
  context menu, `Ctrl+Shift+L` shortcut, save/update notification bar, site-match sorting
- **Generator & TOTP** — password / passphrase / username generators; TOTP codes
  (verified against RFC 6238 official vectors, incl. Steam codes)
- **Complete item management** — 8 item types, folders, trash, search & filters, favorites,
  password history, item-level re-prompt
- **Real site favicons** — silently fetched and cached, falling back to a local initial-letter block

## Building

```bash
npm install
npm run build          # Chrome / Edge / Opera (MV3) → dist/
npm run build:firefox  # Firefox (MV3 event page) → dist/
```

## Loading into a Browser

**Chrome / Edge**
1. Open `chrome://extensions` (`edge://extensions` for Edge)
2. Enable "Developer mode" in the top-right corner
3. Click "Load unpacked" and select the `dist/` directory

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on" and select `dist/manifest.json`

## Other Commands

| Command | Purpose |
|---|---|
| `npm run dev` | HMR dev server for the popup UI only (no extension runtime) |
| `npm run check` | TypeScript type checking |
| `npm run check:svelte` | Svelte component type checking |
| `npm test` | Unit tests |
| `npm run icons` | Regenerate icon PNGs |
| `npm run verify:offline` | Run the offline check against `dist/` alone |

## Autofill Test Pages

`test/pages/` contains a set of self-hosted pages covering common form layouts
(standard labels, placeholder-only, table layouts, Shadow DOM, iframes, dynamic insertion,
hidden traps, checkout forms).

```bash
npx serve test/pages     # or any static server
```

Open a page and use the extension's **Settings → Autofill → Detect fields on current page**
to inspect the collection results. `test/pages/index.html` lists the expected results per page.

Opening via `file://` also works, but iframe and Shadow DOM pages are restricted in some browsers —
a local server is recommended.

---

## Offline Guarantee

Not a verbal promise but three enforced mechanisms:

1. **Runtime lockdown** — the manifest CSP hard-codes `connect-src 'none'` (with favicon-exception
   domains only); any fetch/XHR/WebSocket from the extension page or service worker is blocked
   by the browser itself.
2. **Build-time verification** — `scripts/check-no-network.mjs` scans the **bundled output**
   (not the source); any `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `importScripts`
   fails the build. Scanning the bundle means network calls smuggled in by third-party dependencies
   are caught too.
3. **No remote resources** — wordlists and WASM are bundled; nothing is downloaded at runtime.

Content scripts run under the host page's CSP and are not covered by #1 — that is exactly what #2 is for.

### The One Network Exception: Site Favicons

Fetching real site icons is an exception **explicitly exempted by the user**, and is not
treated as a violation:

- **Site first** — the content script fetches same-origin (no CORS needed),
  preferring the `<link rel="icon">` address, falling back to `/favicon.ico`
- **Fallback** — Google s2 favicon service (`www.google.com/s2/favicons`),
  CORS-enabled, nearly 100% available; the trade-off is that domains are sent to Google
- **Second fallback** — DuckDuckGo icons (`icons.duckduckgo.com/ip3/{domain}.ico`,
  better reachability in mainland China, no redirects)
- **Failure cooldown** — after the whole chain fails, no retry for 6 hours
  (avoid hammering unreachable networks); a success clears the cooldown
- Timing: when adding an item or when a site match appears (silent, cached)
- Cache: `storage.local` under `vwo:favicons:{domain}`; display checks the cache first,
  falling back to a local initial-letter block

The CSP and build-time checker allow exactly those icon-service domains: `www.google.com` (s2),
`*.gstatic.com` (Google's favicon redirect targets — the redirect can land on any `tN` subdomain),
and `icons.duckduckgo.com`.

---

## Architecture

```
src/
├── background/     background service worker (MV3, can be killed anytime)
├── content/        scripts injected into pages, built as self-contained IIFEs
├── popup/          Svelte 5 extension pages
├── platform/       browser API abstraction + message bus + logging
└── core/           browser-agnostic domain logic
    ├── crypto/     encryption
    ├── state/      storage keys & state definitions
    ├── vault/      item models & repository
    ├── autofill/   autofill (collect / qualify / fill)
    ├── generator/  generators
    ├── totp/       TOTP codes
    └── import-export/  import & export
```

### Three Hard Rules

1. **Business code must never call `chrome.*` / `browser.*` directly** — always go through
   `src/platform/browser-api.ts`. The one exception is content scripts, which need minimal
   injection size and don't pull in the platform layer.
2. **Listeners must be registered via `addListener()` and removed on teardown**.
   Safari does not clean up popup-context listeners; not removing them is a memory leak.
3. **The background page must not hold long-lived state in module scope.** An MV3 service
   worker can be killed at any time; anything that must survive across events goes into
   `storage.session`.

### Key Hierarchy (Same as Bitwarden)

```
Master password ──KDF(PBKDF2-600k or Argon2id)──▶ MasterKey(32B)
                                                       │
                                               HKDF-Expand(enc/mac)
                                                       ▼
                                                StretchedKey(64B)
                                                       │
                                               unwraps the wrapped key
                                                       ▼
                                                  UserKey(64B = 32B enc ‖ 32B mac)
                                                       │
                                       AES-256-CBC + HMAC-SHA256 per-field encryption
                                                       ▼
                                                  Plaintext items
```

An item may carry its own `key` (per-cipher key); when present, its fields are encrypted with
that key instead of the UserKey. PIN unlock wraps the same UserKey with a PIN-derived key —
the encryption strength of the data is unchanged.

---
