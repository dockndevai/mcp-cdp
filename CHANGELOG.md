# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-12

### Security
- Bumped `@modelcontextprotocol/sdk` (1.30.0 → 1.32.1) to fix a high-severity advisory where the
  OAuth client could send credentials to an authorization server chosen by the MCP server
  ([GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)), and picked up a
  transitive `source-map-js` fix for a high-severity event-loop DoS advisory
  ([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)). `npm audit` is clean
  (0 vulnerabilities).

### Changed
- Routine patch bumps: `@types/node`, `undici`, `vitest`, `zod` to latest in-range patch releases.

## [0.2.0] - 2026-09-27

### Added
- **Optional AI risk guard (laya-guard).** The `evaluate` tool (arbitrary JS in the page) can consult
  a local [laya-guard](https://github.com/dockndevai/laya-guard) daemon that classifies the expression
  allow / confirm / block before it runs. Runs *after* the eval gate and can only *tighten*, never
  grant; fails closed. Off by default (`CDP_GUARD_MODE=monitor|enforce`, `CDP_GUARD_URL`,
  `CDP_GUARD_TIMEOUT_MS`, `CDP_GUARD_FAIL_CLOSED`).

## [0.1.0] - 2026-09-22

### Added
- Initial release: a safe-by-default MCP server that drives an Electron / Chrome app over the Chrome
  DevTools Protocol (CDP). 11 tools across read/read-write/admin: `list_targets`, `dom_snapshot`,
  `query_dom`, `console_logs`, `network_requests`, `screenshot`; `click`, `type_text`, `press_key`,
  `navigate`; and `evaluate`.
- Attaches to a `--remote-debugging-port` over HTTP discovery + a per-target WebSocket; console and
  network events accumulate in bounded ring buffers that the read tools drain. Works identically
  across operating systems and lets parallel agents each own a distinct port.
- Security model: access modes (read-only/read-write/admin), a **target allowlist** and **protected
  targets** (sign-in pages and browser internals are inspect-only by default), an **eval gate**
  (`CDP_ALLOW_EVAL`) for arbitrary JavaScript, dry-run, JSON audit logging, and a **loopback-only**
  endpoint (`CDP_ALLOW_REMOTE` to override).
- Secret hygiene: request/response headers are never captured; sensitive URL query values are
  redacted from the network log and console entries.
- **Human-in-the-loop confirmation** via MCP elicitation on `evaluate` and `navigate`.
- Bundled skill `cdp-safe-operations` documenting how to expose a port, read the DOM/console/network
  instead of screenshots, the safety rules, and the triage workflow.
- MCP tool annotations derived from each tool's capability, with a test keeping them consistent.
