# Installing `mcp-cdp` in your MCP client

`mcp-cdp` is a **stdio** MCP server. Any MCP-compatible agent can run it.

- **From npm (recommended):** `npx -y @dockndevai/mcp-cdp`
- **From source:** `node /ABSOLUTE/PATH/TO/mcp-cdp/dist/index.js` after `npm install && npm run build`.

> First expose a debugging port on the app you want to drive, e.g.
> `your-electron-app --remote-debugging-port=9222` (or
> `chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/p1 <url>`), then set
> `CDP_PORT`. **Start in `read-only` mode.** See [`.env.example`](../.env.example) for every variable.

## Claude Code (CLI)

```bash
claude mcp add cdp \
  -e CDP_PORT="9222" \
  -e CDP_MODE="read-only" \
  -- npx -y @dockndevai/mcp-cdp
```

Add `-e CDP_MODE=read-write` to allow click/type/navigate, and `-e CDP_MODE=admin -e CDP_ALLOW_EVAL=true`
to allow `evaluate`. Scope with `-e CDP_TARGET_ALLOWLIST=https://app.local*`. List with
`claude mcp list`, remove with `claude mcp remove cdp`.

## Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cdp": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-cdp"],
      "env": { "CDP_PORT": "9222", "CDP_MODE": "read-only" }
    }
  }
}
```

## Cursor

`.cursor/mcp.json` (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cdp": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-cdp"],
      "env": { "CDP_PORT": "9222", "CDP_MODE": "read-only" }
    }
  }
}
```

## OpenAI Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.cdp]
command = "npx"
args = ["-y", "@dockndevai/mcp-cdp"]
env = { CDP_PORT = "9222", CDP_MODE = "read-only" }
```

## VS Code (Copilot / Agent mode)

`.vscode/mcp.json` (top-level key is `servers`):

```json
{
  "servers": {
    "cdp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-cdp"],
      "env": { "CDP_PORT": "9222", "CDP_MODE": "read-only" }
    }
  }
}
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json` with the same `mcpServers` block as Cursor, then **Refresh**.

## Parallel agents (one per worktree)

Give each agent its own port and profile, and its own server entry (`cdp-1` → `CDP_PORT=9222`,
`cdp-2` → `CDP_PORT=9223`, …). Each server only ever talks to its own port, so the agents can't
disturb one another.

## Verify

On startup the server logs to **stderr**:

```
cdp-mcp connected [endpoint=http://127.0.0.1:9222, mode=read-only, tools=6: list_targets, dom_snapshot, …]
```

Ask your agent to *"list the CDP targets"* to confirm.
