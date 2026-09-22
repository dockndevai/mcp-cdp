#!/usr/bin/env node
/**
 * MCP server for the Chrome DevTools Protocol (CDP).
 *
 * Attaches to a `--remote-debugging-port` exposed by an Electron app or a Chrome/Chromium instance
 * and drives the page over CDP instead of pixel-level GUI automation. The agent gets the DOM,
 * console, network requests and (gated) JavaScript evaluation; it works identically across
 * operating systems; and parallel agents each own a distinct port instead of fighting over one
 * desktop.
 *
 * Safe by default: starts read-only, so only the inspect tools are registered. Interactions (click,
 * type, navigate) need CDP_MODE=read-write; running arbitrary JavaScript (evaluate) needs admin mode
 * plus CDP_ALLOW_EVAL. Sign-in pages and browser-internal targets are protected, the endpoint is
 * loopback unless CDP_ALLOW_REMOTE=true, and headers/secrets are never returned (src/security.ts).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { endpointUrl, loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const { server, client, enabled } = buildServer(config);

// Best-effort reachability check — a clear hint beats a cryptic first-call failure.
try {
  const v = (await client.version()) as { Browser?: string };
  process.stderr.write(`cdp-mcp: connected to ${endpointUrl(config.connection)} (${v.Browser ?? "unknown build"}).\n`);
} catch {
  process.stderr.write(
    `cdp-mcp: no DevTools endpoint at ${endpointUrl(config.connection)} yet — start your app with ` +
      `--remote-debugging-port=${config.connection.port}. The server will keep trying on each call.\n`,
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout carries the protocol; diagnostics go to stderr.
process.stderr.write(
  `cdp-mcp connected [endpoint=${endpointUrl(config.connection)}, mode=${config.security.mode}, ` +
    `tools=${enabled.length}: ${enabled.join(", ")}]\n`,
);

const shutdown = () => {
  client.closeAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
