/**
 * A thin Chrome DevTools Protocol (CDP) client.
 *
 * Targets (pages / webviews / Electron windows) are discovered over the HTTP endpoint
 * (`/json/list`); each is driven over its own WebSocket. A `Session` stays attached so console and
 * network events accumulate in bounded ring buffers that the read tools drain.
 *
 * Secret hygiene: request/response **headers are never stored** (they carry cookies and auth), and
 * sensitive-looking URL query values are redacted before anything reaches the model.
 */
import { WebSocket } from "undici";
import type { Connection } from "../config.js";
import { endpointUrl } from "../config.js";

export class CdpError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "CdpError";
  }
}

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface ConsoleEntry {
  ts: string;
  level: string;
  text: string;
  source?: string;
  url?: string;
}

export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  ts: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const SENSITIVE_QS = /(token|key|secret|password|passwd|pwd|auth|code|session|sig|signature|credential)/i;

/** Redact values of sensitive-looking query parameters, leaving the rest of the URL readable. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_QS.test(k)) u.searchParams.set(k, "<redacted>");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

function truncate(s: string, max = 2000): string {
  return s.length > max ? `${s.slice(0, max)}… <truncated ${s.length - max} chars>` : s;
}

/** Best-effort rendering of a Runtime.RemoteObject to a short string. */
function renderArg(arg: Record<string, unknown>): string {
  if (arg == null) return "null";
  if ("value" in arg && arg.value !== undefined) {
    const v = arg.value;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  if (typeof arg.description === "string") return arg.description;
  if (typeof arg.unserializableValue === "string") return arg.unserializableValue;
  return String(arg.type ?? "");
}

class Session {
  private ws!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  readonly console: ConsoleEntry[] = [];
  readonly network: NetworkEntry[] = [];
  private readonly netIndex = new Map<string, NetworkEntry>();

  constructor(
    readonly target: CdpTarget,
    private readonly timeoutMs: number,
    private readonly maxBuffer: number,
  ) {}

  connect(): Promise<void> {
    if (!this.target.webSocketDebuggerUrl) {
      return Promise.reject(new CdpError(`Target ${this.target.id} has no webSocketDebuggerUrl (already attached elsewhere?).`));
    }
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl);
    this.ws.addEventListener("message", (ev) => this.onMessage(String((ev as MessageEvent).data)));
    this.ws.addEventListener("close", () => this.onClose());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CdpError("Timed out opening CDP WebSocket.")), this.timeoutMs);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError("Failed to open CDP WebSocket."));
      });
    });
  }

  /** Enable the domains whose events we buffer. */
  async enableDomains(): Promise<void> {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Network.enable");
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(`CDP call '${method}' timed out.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws.send(payload);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CdpError(`Failed to send CDP call '${method}'.`, e));
      }
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private onClose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new CdpError("CDP WebSocket closed."));
    }
    this.pending.clear();
  }

  private push<T>(buf: T[], item: T): void {
    buf.push(item);
    if (buf.length > this.maxBuffer) buf.shift();
  }

  private onMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = msg.error as { message?: string };
        p.reject(new CdpError(`CDP error: ${err.message ?? "unknown"}`, msg.error));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    this.onEvent(msg.method as string, (msg.params ?? {}) as Record<string, unknown>);
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "Runtime.consoleAPICalled": {
        const args = (params.args as Array<Record<string, unknown>>) ?? [];
        this.push(this.console, {
          ts: new Date().toISOString(),
          level: String(params.type ?? "log"),
          text: truncate(args.map(renderArg).join(" ")),
          source: "console-api",
        });
        break;
      }
      case "Runtime.exceptionThrown": {
        const det = (params.exceptionDetails as Record<string, unknown>) ?? {};
        const ex = (det.exception as Record<string, unknown>) ?? {};
        this.push(this.console, {
          ts: new Date().toISOString(),
          level: "error",
          text: truncate(String(det.text ?? "") + " " + renderArg(ex)).trim(),
          source: "exception",
        });
        break;
      }
      case "Log.entryAdded": {
        const e = (params.entry as Record<string, unknown>) ?? {};
        this.push(this.console, {
          ts: new Date().toISOString(),
          level: String(e.level ?? "info"),
          text: truncate(String(e.text ?? "")),
          source: String(e.source ?? "log"),
          url: e.url ? redactUrl(String(e.url)) : undefined,
        });
        break;
      }
      case "Network.requestWillBeSent": {
        const req = (params.request as Record<string, unknown>) ?? {};
        const entry: NetworkEntry = {
          requestId: String(params.requestId),
          method: String(req.method ?? "GET"),
          url: redactUrl(String(req.url ?? "")),
          ts: new Date().toISOString(),
        };
        this.netIndex.set(entry.requestId, entry);
        this.push(this.network, entry);
        break;
      }
      case "Network.responseReceived": {
        const res = (params.response as Record<string, unknown>) ?? {};
        const entry = this.netIndex.get(String(params.requestId));
        if (entry) {
          entry.status = Number(res.status ?? 0);
          entry.mimeType = String(res.mimeType ?? "");
        }
        break;
      }
      case "Network.loadingFailed": {
        const entry = this.netIndex.get(String(params.requestId));
        if (entry) {
          entry.failed = true;
          entry.errorText = String(params.errorText ?? "failed");
        }
        break;
      }
    }
  }
}

export class CdpClient {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly conn: Connection) {}

  get maxResults(): number {
    return this.conn.maxResults;
  }

  private async http<T>(path: string): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.conn.timeoutMs);
    try {
      const res = await fetch(`${endpointUrl(this.conn)}${path}`, { signal: ctrl.signal });
      if (!res.ok) throw new CdpError(`DevTools endpoint ${path} returned ${res.status}.`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof CdpError) throw e;
      throw new CdpError(
        `Cannot reach the DevTools endpoint at ${endpointUrl(this.conn)}. Is the app running with ` +
          `--remote-debugging-port=${this.conn.port}?`,
        e,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  version(): Promise<Record<string, unknown>> {
    return this.http<Record<string, unknown>>("/json/version");
  }

  async listTargets(): Promise<CdpTarget[]> {
    const raw = await this.http<CdpTarget[]>("/json/list");
    return raw.filter((t) => t.type === "page" || t.type === "webview" || t.type === "app" || t.type === "iframe");
  }

  /** Resolve a target id to its current record (URL used for policy checks). */
  async findTarget(targetId: string): Promise<CdpTarget> {
    const t = (await this.listTargets()).find((x) => x.id === targetId);
    if (!t) throw new CdpError(`No target with id '${targetId}'. Call list_targets to see current ids.`);
    return t;
  }

  /** Attach (or reuse an attachment) to a target; the session buffers console/network from now on. */
  async attach(targetId: string): Promise<Session> {
    const existing = this.sessions.get(targetId);
    if (existing && existing.open) return existing;
    const target = await this.findTarget(targetId);
    const session = new Session(target, this.conn.timeoutMs, this.conn.maxBuffer);
    await session.connect();
    await session.enableDomains();
    this.sessions.set(targetId, session);
    return session;
  }

  /** The DOM document root nodeId for a target (invalidated per call, so fetched fresh). */
  private async rootNodeId(session: Session): Promise<number> {
    const doc = await session.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
    return doc.root.nodeId;
  }

  async outerHtml(targetId: string, selector?: string): Promise<string> {
    const s = await this.attach(targetId);
    const root = await this.rootNodeId(s);
    let nodeId = root;
    if (selector) {
      const found = await s.send<{ nodeId: number }>("DOM.querySelector", { nodeId: root, selector });
      if (!found.nodeId) throw new CdpError(`No element matches selector '${selector}'.`);
      nodeId = found.nodeId;
    }
    const { outerHTML } = await s.send<{ outerHTML: string }>("DOM.getOuterHTML", { nodeId });
    return outerHTML;
  }

  async queryAll(targetId: string, selector: string, limit: number): Promise<string[]> {
    const s = await this.attach(targetId);
    const root = await this.rootNodeId(s);
    const { nodeIds } = await s.send<{ nodeIds: number[] }>("DOM.querySelectorAll", { nodeId: root, selector });
    const out: string[] = [];
    for (const nodeId of nodeIds.slice(0, limit)) {
      const { outerHTML } = await s.send<{ outerHTML: string }>("DOM.getOuterHTML", { nodeId });
      out.push(outerHTML);
    }
    return out;
  }

  /** Compute the click point (content-box centre) of the first element matching `selector`. */
  private async centerOf(session: Session, selector: string): Promise<{ x: number; y: number }> {
    const root = await this.rootNodeId(session);
    const found = await session.send<{ nodeId: number }>("DOM.querySelector", { nodeId: root, selector });
    if (!found.nodeId) throw new CdpError(`No element matches selector '${selector}'.`);
    const { model } = await session.send<{ model: { content: number[] } }>("DOM.getBoxModel", { nodeId: found.nodeId });
    const c = model.content;
    return { x: (c[0] + c[2] + c[4] + c[6]) / 4, y: (c[1] + c[3] + c[5] + c[7]) / 4 };
  }

  async click(targetId: string, selector: string): Promise<{ x: number; y: number }> {
    const s = await this.attach(targetId);
    const pt = await this.centerOf(s, selector);
    const base = { x: pt.x, y: pt.y, button: "left", clickCount: 1 };
    await s.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    return pt;
  }

  async typeText(targetId: string, text: string, selector?: string): Promise<void> {
    const s = await this.attach(targetId);
    if (selector) {
      const pt = await this.centerOf(s, selector);
      const base = { x: pt.x, y: pt.y, button: "left", clickCount: 1 };
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    }
    await s.send("Input.insertText", { text });
  }

  async pressKey(targetId: string, key: string): Promise<void> {
    const s = await this.attach(targetId);
    const map: Record<string, { key: string; code: string; windowsVirtualKeyCode?: number; text?: string }> = {
      Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
      Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
      Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
      Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
      Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
      ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
      ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
      ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
      ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    };
    const k = map[key];
    if (!k) throw new CdpError(`Unsupported key '${key}'. Supported: ${Object.keys(map).join(", ")}.`);
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  }

  async navigate(targetId: string, url: string): Promise<void> {
    const s = await this.attach(targetId);
    const res = await s.send<{ errorText?: string }>("Page.navigate", { url });
    if (res.errorText) throw new CdpError(`Navigation failed: ${res.errorText}`);
  }

  async screenshot(targetId: string): Promise<string> {
    const s = await this.attach(targetId);
    const { data } = await s.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return data;
  }

  async evaluate(targetId: string, expression: string, awaitPromise: boolean): Promise<unknown> {
    const s = await this.attach(targetId);
    const res = await s.send<{ result?: Record<string, unknown>; exceptionDetails?: Record<string, unknown> }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise, userGesture: true },
    );
    if (res.exceptionDetails) {
      const det = res.exceptionDetails;
      const ex = (det.exception as Record<string, unknown>) ?? {};
      throw new CdpError(`Evaluation threw: ${det.text ?? ""} ${renderArg(ex)}`.trim(), det);
    }
    return res.result?.value ?? res.result?.description ?? null;
  }

  consoleLogs(targetId: string, limit: number): ConsoleEntry[] {
    const s = this.sessions.get(targetId);
    if (!s) return [];
    return s.console.slice(-limit);
  }

  networkRequests(targetId: string, limit: number, urlFilter?: string): NetworkEntry[] {
    const s = this.sessions.get(targetId);
    if (!s) return [];
    let items = s.network;
    if (urlFilter) items = items.filter((e) => e.url.toLowerCase().includes(urlFilter.toLowerCase()));
    return items.slice(-limit);
  }

  closeAll(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
