/**
 * Configuration from environment variables.
 *
 * mcp-cdp attaches to a Chrome DevTools Protocol (CDP) endpoint — the `--remote-debugging-port` an
 * Electron app or a Chrome/Chromium instance exposes — and drives the page over CDP instead of
 * pixel-level GUI automation. That gives an agent the DOM, console, network and (gated) JS
 * evaluation, works identically across operating systems, and lets parallel agents each own a
 * distinct port instead of fighting over one desktop.
 *
 * Safety: the endpoint is loopback by default (`127.0.0.1`). A remote-debugging port is a powerful
 * capability — anything that can reach it can drive the browser — so connecting to a non-loopback
 * host is refused unless CDP_ALLOW_REMOTE=true.
 */
import type { AccessMode, SecurityConfig } from "./security.js";

export interface Connection {
  /** Host serving the DevTools endpoint. Loopback unless CDP_ALLOW_REMOTE=true. */
  host: string;
  /** The `--remote-debugging-port`. */
  port: number;
  /** Permit a non-loopback host (dangerous: exposes the browser to the network). */
  allowRemote: boolean;
  timeoutMs: number;
  /** Max items returned by list/console/network tools. */
  maxResults: number;
  /** Ring-buffer size for console/network events captured per attached target. */
  maxBuffer: number;
}

export interface AppConfig {
  connection: Connection;
  security: SecurityConfig;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseMode(): AccessMode {
  const raw = (process.env.CDP_MODE ?? "read-only").toLowerCase();
  if (raw === "read-only" || raw === "read-write" || raw === "admin") return raw;
  throw new Error(`Invalid CDP_MODE '${raw}'. Expected one of: read-only, read-write, admin.`);
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Targets that may be inspected (DOM/console/network/screenshot) but never interacted with
 * (click/type/navigate/evaluate) — sign-in pages and browser-internal surfaces. URL patterns; a
 * trailing/leading `*` is a wildcard, otherwise it's a case-insensitive substring match.
 */
const DEFAULT_PROTECTED = [
  "chrome://*",
  "devtools://*",
  "chrome-extension://*",
  "about:*",
  "edge://*",
  "https://accounts.google.com*",
  "https://login.microsoftonline.com*",
  "https://login.live.com*",
  "https://appleid.apple.com*",
  "https://github.com/login*",
  "https://github.com/session*",
];

export function loadConfig(): AppConfig {
  const host = (process.env.CDP_HOST || "127.0.0.1").trim();
  const allowRemote = bool("CDP_ALLOW_REMOTE", false);
  if (!LOOPBACK.has(host) && !allowRemote) {
    throw new Error(
      `CDP_HOST '${host}' is not loopback. A remote debugging port lets anything that reaches it drive the browser; ` +
        `set CDP_ALLOW_REMOTE=true only if you understand that exposure.`,
    );
  }
  const protectedRaw = list("CDP_PROTECTED_TARGETS");
  return {
    connection: {
      host,
      port: Math.max(1, Math.min(65535, Number(process.env.CDP_PORT ?? 9222))),
      allowRemote,
      timeoutMs: Number(process.env.CDP_TIMEOUT_MS ?? 30000),
      maxResults: Math.max(1, Math.min(1000, Number(process.env.CDP_MAX_RESULTS ?? 100))),
      maxBuffer: Math.max(50, Math.min(5000, Number(process.env.CDP_MAX_BUFFER ?? 500))),
    },
    security: {
      mode: parseMode(),
      targetAllowlist: list("CDP_TARGET_ALLOWLIST").map((s) => s.toLowerCase()),
      protectedTargets: (protectedRaw.length ? protectedRaw : DEFAULT_PROTECTED).map((s) => s.toLowerCase()),
      allowEval: bool("CDP_ALLOW_EVAL", false),
      dryRun: bool("CDP_DRY_RUN", false),
      auditLog: bool("CDP_AUDIT_LOG", true),
    },
  };
}

export function endpointUrl(c: Connection): string {
  return `http://${c.host}:${c.port}`;
}
