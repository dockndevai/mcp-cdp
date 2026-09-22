---
name: cdp-safe-operations
description: >-
  How to attach to and safely drive an Electron/Chrome app through mcp-cdp over the Chrome DevTools
  Protocol — starting the app with a remote debugging port, discovering targets, reading the DOM /
  console / network instead of screenshots, and the safe-by-default access model (modes, target
  allowlist, protected targets, the eval gate, dry-run). Use whenever connecting mcp-cdp, testing a
  desktop/web app's changes, or triaging why something failed in the renderer.
---

# Driving an Electron / Chrome app safely with mcp-cdp

`mcp-cdp` attaches to a Chrome DevTools Protocol (CDP) endpoint — the `--remote-debugging-port` an
Electron app or a Chrome/Chromium instance exposes — and drives the page **over the protocol**
instead of pixel-level GUI automation. Compared to computer-use this gives the agent the real DOM
(not a screenshot), the console and uncaught exceptions, and the network log; it works the same on
macOS, Linux and Windows (and on a headless VPS); and each agent attaches to its **own** port, so
parallel agents never fight over one desktop.

It cannot control native (non-Chromium) windows — use a GUI-automation server for those.

## 1. Expose a debugging port

Start the app (or a worktree's dev build) with an explicit port. Give each parallel agent a distinct
port and a distinct profile dir.

- **Electron app:** pass the Chromium switch through, e.g. `your-app --remote-debugging-port=9222`,
  or in code `app.commandLine.appendSwitch('remote-debugging-port', '9222')` before `app.whenReady()`.
- **Electron via a dev script:** many apps forward extra args, e.g. `npm run dev -- --remote-debugging-port=9222`.
- **Plain Chrome/Chromium:** `chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p1 <url>`.

Confirm it's up: `curl http://127.0.0.1:9222/json/version` returns the browser build. Then point the
server at it with `CDP_PORT` (and `CDP_HOST` only if not localhost — see safety).

## 2. The core loop: read the DOM, not screenshots

1. `list_targets` → pick the target id (a page / webview / Electron window). The result flags each
   target `allowed` and `protected` so you know up front what you can interact with.
2. `dom_snapshot { target_id, selector? }` → the rendered HTML. This is what to read to understand
   the page; it's exact and carries far more than an image.
3. `query_dom { target_id, selector }` → the outer HTML of every match, to pin down the exact
   element to act on.
4. `console_logs` / `network_requests` → **why** something failed: uncaught exceptions and failed
   requests that never appear on screen. This is the biggest win over screenshots — when a test
   fails, the reason is usually right here.
5. `screenshot` only when you need to judge visual layout / rendering.

Then interact (needs `read-write`): `click { selector }`, `type_text { text, selector? }`,
`press_key { key }`, `navigate { url }`.

## 3. Safe by default — the access model

Enforced by `src/security.ts`. The browser process is the real boundary; these keep an agent inside
the targets and actions you intend.

- **`CDP_MODE`** — `read-only` (default) → `read-write` → `admin`. Only tools at or below the mode
  are registered: in read-only the agent literally cannot click, type or navigate.
- **`CDP_TARGET_ALLOWLIST`** — comma-separated URL patterns; interactions are confined to matching
  targets. Empty = all. A pattern is a case-insensitive substring, or use a leading/trailing `*`.
- **`CDP_PROTECTED_TARGETS`** — targets that can be **inspected but never interacted with**. Defaults
  cover sign-in pages (`accounts.google.com`, `login.microsoftonline.com`, …) and browser internals
  (`chrome://`, `devtools://`, extensions). So an agent can read a login page but cannot type into it.
- **`CDP_ALLOW_EVAL`** — `evaluate` runs arbitrary JavaScript in the page (code execution in the
  renderer). It is registered only in `admin` mode **and** with this flag true, is refused on
  protected targets, and prompts a human to confirm. Keep it off unless you truly need it — most
  inspection and interaction never requires eval.
- **`CDP_DRY_RUN`** — interactions log their intent and return without dispatching. Preview first.
- **Secrets** — request/response **headers are never captured** (they carry cookies and auth), and
  sensitive-looking URL query values are redacted. Don't `type_text` passwords or tokens.
- **Loopback only** — the endpoint must be `127.0.0.1` unless you set `CDP_ALLOW_REMOTE=true`. A
  remote debugging port lets anything that reaches it drive the browser; keep it local.

## 4. Recommended posture

- Start in `read-only`, read the DOM/console/network, and only raise to `read-write` for the specific
  interaction you need — then lower it again.
- Set `CDP_TARGET_ALLOWLIST` to your app's own origin(s) so the agent can never wander into a logged-in
  tab you left open.
- Leave `evaluate` off. Reach for it only to script something the read/interact tools can't express,
  in `admin` mode, on a non-protected target.
- One port per agent; never point two agents at the same port.

## 5. Typical workflow — "the change didn't work, why?"

1. `list_targets` → the app window's target id.
2. `dom_snapshot`/`query_dom` on the area you changed → is the new markup actually there?
3. `console_logs` → any uncaught error or failed assertion from the render?
4. `network_requests { url_filter }` → did the expected API call fire, and what status came back?
5. Reproduce the interaction with `click`/`type_text`/`press_key`, then re-read console/network to
   confirm the fix. No screenshots required unless the problem is visual.
