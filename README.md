# mcp-cdp

[![npm](https://img.shields.io/npm/v/@dockndevai/mcp-cdp)](https://www.npmjs.com/package/@dockndevai/mcp-cdp)
[![CI](https://github.com/dockndevai/mcp-cdp/actions/workflows/ci.yml/badge.svg)](https://github.com/dockndevai/mcp-cdp/actions/workflows/ci.yml)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

A **safe-by-default** [Model Context Protocol](https://modelcontextprotocol.io) server that drives an **Electron or Chrome/Chromium app over the Chrome DevTools Protocol (CDP)** — instead of pixel-level GUI automation. Point it at the app's `--remote-debugging-port` and an agent gets the **DOM, console, network requests**, real input (click / type / navigate), and — gated — JavaScript evaluation.

Why this beats computer-use for a desktop/web app:

- **The DOM, not a screenshot.** The agent reads exact rendered HTML and can query any element — far more information, and it sees things that aren't on screen.
- **Console + network.** When a test fails, the uncaught exception or the failed request is right there — no guessing from an image.
- **No collisions.** Each agent attaches to its own debugging port, so parallel agents (e.g. one per git worktree) never fight over one desktop.
- **Cross-OS.** CDP works identically on macOS, Linux and Windows — the same flow runs on a headless VPS.

Part of the [dockndevai MCP server suite](https://dockndevai.github.io/) — one governance model across all of them.

## What it gives an agent

Starts **read-only** (see [Safe by default](#safe-by-default)); higher-capability tools are only registered when you raise the mode.

| Tool | For | Needs mode |
|---|---|---|
| `list_targets` | list pages / webviews / Electron windows (id, type, title, url) | read-only |
| `dom_snapshot` | rendered HTML of the page or a selector's subtree | read-only |
| `query_dom` | outer HTML of every element matching a CSS selector | read-only |
| `console_logs` | recent console output + uncaught exceptions | read-only |
| `network_requests` | recent requests (method, url, status, mime; headers never captured) | read-only |
| `screenshot` | a PNG of the viewport | read-only |
| `click` | click the first element matching a selector | read-write |
| `type_text` | type into the page (focus a selector first) | read-write |
| `press_key` | Enter / Tab / Escape / Backspace / Delete / Arrows | read-write |
| `navigate` | navigate a target to a URL (confirmed) | read-write |
| `evaluate` | run a JavaScript expression in the page | admin + `CDP_ALLOW_EVAL` |

## Install

```bash
npx -y @dockndevai/mcp-cdp
```

## Expose a debugging port

Start your app (or a worktree's dev build) with an explicit port — one per agent:

- **Electron app:** `your-app --remote-debugging-port=9222`, or in main-process code
  `app.commandLine.appendSwitch('remote-debugging-port', '9222')` before `app.whenReady()`.
- **Plain Chrome/Chromium:** `chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p1 <url>`.

Check it's up: `curl http://127.0.0.1:9222/json/version`.

## Configure

```json
{
  "mcpServers": {
    "cdp": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-cdp"],
      "env": {
        "CDP_PORT": "9222",
        "CDP_MODE": "read-only"
      }
    }
  }
}
```

See [docs/CLIENTS.md](docs/CLIENTS.md) for Claude Code / Cursor / Codex / VS Code / Windsurf, and [.env.example](.env.example) for every variable.

## Safe by default

Enforced by [`src/security.ts`](src/security.ts). The browser process is the real boundary — this keeps an agent inside the targets and actions you intend:

- **`CDP_MODE`** — `read-only` (default) → `read-write` → `admin`. Tools above the mode aren't registered, so in read-only the agent cannot click, type or navigate at all.
- **`CDP_TARGET_ALLOWLIST`** — confine interactions to targets whose URL matches your patterns (empty = all). Reads (inspection) are always allowed.
- **`CDP_PROTECTED_TARGETS`** — targets that can be **inspected but never interacted with**. Defaults protect sign-in pages (`accounts.google.com`, `login.microsoftonline.com`, …) and browser internals (`chrome://`, `devtools://`, extensions).
- **`CDP_ALLOW_EVAL`** — `evaluate` is arbitrary code execution in the renderer: admin mode **plus** this flag, refused on protected targets, with a human confirmation.
- **`CDP_DRY_RUN`** — interactions log their intent and return without dispatching.
- **Secrets** — request/response **headers are never captured** (cookies/auth), and sensitive URL query values are redacted. `evaluate` and `navigate` also prompt a human via MCP elicitation.
- **Loopback only** — the endpoint must be `127.0.0.1` unless `CDP_ALLOW_REMOTE=true`.

**Optional AI risk guard.** Set `CDP_GUARD_MODE=monitor|enforce` to have the `evaluate` tool consult a local [laya-guard](https://github.com/dockndevai/laya-guard) daemon (`pipx install laya-guard && laya-guard`) that classifies the JS expression allow/confirm/block before it runs. It runs *after* the eval gate and can only tighten, never grant; fails closed.

There is a bundled skill, [`cdp-safe-operations`](.claude/skills/cdp-safe-operations/SKILL.md), that teaches an agent how to expose a port, read the DOM/console/network instead of screenshots, the safety rules, and the "why did this fail?" workflow. See also [SECURITY.md](SECURITY.md).

## Developing

```bash
npm install
npm run build
# list the tools:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | CDP_PORT=9222 node dist/index.js
npm test
```

## Licence

MIT
