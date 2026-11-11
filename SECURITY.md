# Security

`mcp-cdp` lets an AI agent drive a browser (an Electron app or Chrome/Chromium) over the Chrome
DevTools Protocol. A DevTools debugging port is a powerful capability — anything that can reach it
can read and control the browser — so treat this like any privileged automation and grant it the
least it needs.

## Principles

- **Start read-only.** Leave `CDP_MODE=read-only` until you need to interact. In read-only mode only
  the inspect tools are registered — click/type/navigate/evaluate aren't exposed to the model.
- **The debugging port is the boundary.** Anything with access to the port controls the browser. Keep
  it **loopback** (`127.0.0.1`, the default); `CDP_ALLOW_REMOTE=true` exposes it to the network and is
  for deliberate, trusted setups only. Use one port per agent so agents can't touch each other's app.
- **Scope to your app.** `CDP_TARGET_ALLOWLIST` confines interactions to targets whose URL matches
  your patterns, so an agent can't wander into a logged-in tab you left open. `CDP_PROTECTED_TARGETS`
  marks targets that may be inspected but never interacted with — sign-in pages and browser internals
  (`chrome://`, `devtools://`, extensions, `accounts.google.com`, `login.microsoftonline.com`, …) are
  protected by default.
- **`evaluate` is code execution.** Running arbitrary JavaScript in the page is effectively RCE in the
  renderer. It requires `admin` mode **and** `CDP_ALLOW_EVAL=true`, is refused for protected targets,
  and prompts a human to confirm via MCP elicitation. Keep it off unless you need it.
- **Require a human for `evaluate` and `navigate`.** Set `CDP_REQUIRE_HUMAN_APPROVAL=true` so they are
  refused when the client cannot show an approval prompt. Each approval is bound to the exact tool and
  arguments (the full expression / destination URL, with a fingerprint) and to the target page's identity
  (CDP target id + URL): if the page was replaced or navigated while the human was deciding, the action
  is refused. In-page changes that keep the same URL are not detected. Approval receipts are written to
  the audit log (`"audit":"approval"`, with `approvedBy` = `human` or `flag-only`). `click`, `type_text`
  and `press_key` do not prompt.
- **Preview with dry-run.** `CDP_DRY_RUN=true` makes interactions log their intent and return without
  dispatching anything to the browser.
- **Secrets are not returned.** Request/response **headers are never captured** (they carry cookies
  and auth), and sensitive-looking URL query values are redacted from the network log and console
  entries. Do not `type_text` passwords, tokens or other secrets into the page.

## Limitations

- Target allowlist/protection is enforced on the target URL a call names; `navigate` is checked
  against its **destination** URL.
- `evaluate` runs whatever expression you pass, as the page. There is no content filtering beyond the
  human-confirmation prompt, the protected-target check and dry-run.
- This is not a general browser-automation framework — there is no multi-frame coordination, file
  upload, or download handling in this version. It favours safe reads and deliberate interactions.
- It only drives Chromium-based targets (Electron / Chrome / Chromium). Native (non-Chromium) windows
  need a GUI-automation server instead.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
