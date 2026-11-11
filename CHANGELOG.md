# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-11

### Security
- **Approval prompts are fully reviewable.** Arguments are shown in full up to 16 000 characters (previously cut at 1500, so a padded prefix could hide the tail of a long statement); a longer action is refused instead of approved blind. Secret redaction in prompts matches whole words (`bypass`/`tokenizer` are no longer shown as `[redacted]`).
- **Approval no longer fails open on timeout.** The human-approval prompt used the MCP SDK's default
  60 s request timeout, and a timeout fell through to "approved" (the mode / `CDP_ALLOW_EVAL` gates had
  already passed). A prompt nobody answered therefore auto-approved `evaluate` / `navigate`. A timeout is
  now a refusal, and the wait defaults to 5 minutes.

### Added
- **Approvals are bound to the exact action.** The prompt shows the tool, the full (secret-redacted)
  arguments (the whole `expression` / destination `url`) and a fingerprint; every approval and refusal is
  written to the audit log as `"audit":"approval"` with the fingerprint, resource version and
  `approvedBy` (`human` / `flag-only`).
- **Approvals are bound to the target page.** `evaluate` and `navigate` read a version token (a hash of the
  CDP target id + URL) before the prompt and again after the human answers, and refuse if it changed — the
  page was replaced, or the app navigated elsewhere. `evaluate` additionally refuses if the pinned page is
  not the page the allowlist / protected-target checks ran against. Title and other volatile state are not
  part of the token.
- `CDP_REQUIRE_HUMAN_APPROVAL=true` — refuse `evaluate` / `navigate` when the client cannot elicit.

Tracking issue: https://github.com/dockndevai/mcp-core/issues/1

## [0.2.5] - 2026-11-09

### Changed
- Routine dependency/security maintenance. `npm audit --audit-level=high` reported 0
  high/critical advisories; no `npm audit fix` was needed.
- Took safe in-range patch bumps: `undici` ^8.12.2 8.12.3 → 8.12.4, `vitest` ^5.0.5
  5.0.5 → 5.1.0.
- No direct dependency crossed a major version boundary; `npm run typecheck`, `npm run build`,
  and `npm test` all pass; final `npm audit` is clean.

## [0.2.4] - 2026-11-02

### Changed
- Routine dependency/security maintenance. `npm audit --audit-level=high` reported 0
  high/critical advisories; a moderate `@hono/node-server` advisory (transitive via
  `@modelcontextprotocol/sdk`) was cleared via `npm audit fix` (2.1.1 → 2.1.5, no direct
  dependency change). Final `npm audit` is clean (0 vulnerabilities).
- Took a safe in-range patch bump: `@types/node` ^26.5.0 26.6.5 → 26.6.6.
- No direct dependency crossed a major version boundary; `npm run typecheck`, `npm run build`,
  and `npm test` all pass.

## [0.2.3] - 2026-10-26

### Security
- `npm audit fix` cleared a high-severity `body-parser` DoS advisory ([GHSA-27r3-jxmh-p828], 2.3.0 → 2.4.0) and moderate advisories in `fast-uri` ([GHSA-w74x-v6f9-j3xg] and related, 3.1.8 → 3.1.9), `hono` ([GHSA-5r4p-p66f-jhc7], 4.13.8 → 4.13.14), and `ip-address` ([GHSA-rxp7-6hxx-x8q5], 10.7.2 → 10.7.5). `npm audit` now reports 0 vulnerabilities.

### Changed
- Routine in-range patch bumps: `@modelcontextprotocol/sdk` (1.32.1 → 1.32.2), `undici` (8.12.2 → 8.12.3). No behavior change.

[GHSA-27r3-jxmh-p828]: https://github.com/advisories/GHSA-27r3-jxmh-p828
[GHSA-w74x-v6f9-j3xg]: https://github.com/advisories/GHSA-w74x-v6f9-j3xg
[GHSA-5r4p-p66f-jhc7]: https://github.com/advisories/GHSA-5r4p-p66f-jhc7
[GHSA-rxp7-6hxx-x8q5]: https://github.com/advisories/GHSA-rxp7-6hxx-x8q5

## [0.2.2] - 2026-10-19

### Changed
- Routine dependency maintenance: `npm audit --audit-level=high` reported 0 advisories; in-range patch bumps for `undici` (8.11.2 → 8.12.2), `vitest` (5.0.3 → 5.0.5), and `zod` (4.6.6 → 4.6.7). `npm audit` reports 0 vulnerabilities. No behavior change.

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
