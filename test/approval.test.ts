import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CdpClient, type CdpTarget } from "../src/cdp/client.js";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

const config = (requireHumanApproval = false): AppConfig => ({
  connection: { host: "127.0.0.1", port: 9222, allowRemote: false, timeoutMs: 1000, maxResults: 100, maxBuffer: 100 },
  security: {
    mode: "admin",
    targetAllowlist: [],
    protectedTargets: ["chrome://*", "https://accounts.google.com*"],
    allowEval: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

/** The targets the (mocked) DevTools endpoint currently reports; tests mutate it to simulate the app moving. */
let targets: CdpTarget[] = [];
const page = (url: string, title = "App", id = "T1"): CdpTarget => ({ id, type: "page", title, url });

/** Connect an in-memory MCP client (optionally able to answer elicitation) to a freshly built server. */
async function connect(opts: { requireHuman?: boolean; elicits?: boolean; answer?: (message: string) => Answer | Promise<Answer> } = {}) {
  const { server } = buildServer(config(opts.requireHuman));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

function mockBackend() {
  vi.spyOn(CdpClient.prototype, "listTargets").mockImplementation(async () => targets);
  return {
    evaluate: vi.spyOn(CdpClient.prototype, "evaluate").mockResolvedValue("evaluated"),
    navigate: vi.spyOn(CdpClient.prototype, "navigate").mockResolvedValue(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  targets = [];
});

describe("evaluate approval (end to end)", () => {
  it("shows the tool, the exact expression, the page version and a fingerprint, then evaluates", async () => {
    targets = [page("https://app.local/home")];
    const { evaluate } = mockBackend();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "document.cookie.length" } });
    expect(text(res)).toContain("evaluated");
    expect(evaluate).toHaveBeenCalledWith("T1", "document.cookie.length", false);
    expect(prompts[0]).toContain("tool: evaluate");
    expect(prompts[0]).toContain('"expression":"document.cookie.length"');
    expect(prompts[0]).toContain('"target_id":"T1"');
    expect(prompts[0]).toMatch(/resource version: [0-9a-f]{12}/);
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT evaluate when the app navigated the page elsewhere while the human was deciding", async () => {
    targets = [page("https://app.local/home")];
    const { evaluate } = mockBackend();
    const { client } = await connect({
      answer: () => {
        targets = [page("https://app.local/admin/billing")];
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "doIt()" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("does NOT evaluate when the target id now refers to a different page (tab replaced)", async () => {
    targets = [page("https://app.local/home", "App", "T1")];
    const { evaluate } = mockBackend();
    const { client } = await connect({
      answer: () => {
        targets = [page("https://app.local/home", "App", "T2")];
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "doIt()" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("does NOT evaluate when the page moved after the policy check but before the approval was pinned", async () => {
    // 1st listTargets = the handler's policy check (an allowed page); every later read = the page now on a
    // protected URL, which would otherwise be pinned consistently by the before/after probes.
    let reads = 0;
    vi.spyOn(CdpClient.prototype, "listTargets").mockImplementation(async () => [
      page(++reads === 1 ? "https://app.local/home" : "https://accounts.google.com/signin"),
    ]);
    const evaluate = vi.spyOn(CdpClient.prototype, "evaluate").mockResolvedValue("evaluated");
    const { client } = await connect();
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "doIt()" } });
    expect(text(res)).toContain("changed after the target policy check");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("still evaluates when only volatile state (the title) changed", async () => {
    targets = [page("https://app.local/home", "Inbox (1)")];
    const { evaluate } = mockBackend();
    const { client } = await connect({
      answer: () => {
        targets = [page("https://app.local/home", "Inbox (2)")];
        return { action: "accept", content: { confirm: true } };
      },
    });
    await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "1+1" } });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("does NOT evaluate when the human declines", async () => {
    targets = [page("https://app.local/home")];
    const { evaluate } = mockBackend();
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "1+1" } });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("keeps the protected-target rule: no prompt, no evaluation", async () => {
    targets = [page("https://accounts.google.com/signin")];
    const { evaluate } = mockBackend();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "1+1" } });
    expect(text(res)).toContain("protected");
    expect(prompts).toHaveLength(0);
    expect(evaluate).not.toHaveBeenCalled();
  });
});

describe("navigate approval (end to end)", () => {
  it("shows the exact destination URL and the page it moves from, then navigates", async () => {
    targets = [page("https://app.local/home")];
    const { navigate } = mockBackend();
    const { client, prompts } = await connect();
    await client.callTool({ name: "navigate", arguments: { target_id: "T1", url: "https://app.local/settings" } });
    expect(navigate).toHaveBeenCalledWith("T1", "https://app.local/settings");
    expect(prompts[0]).toContain("tool: navigate");
    expect(prompts[0]).toContain('"url":"https://app.local/settings"');
    expect(prompts[0]).toContain("from: https://app.local/home");
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT navigate when the page moved while the human was deciding", async () => {
    targets = [page("https://app.local/home")];
    const { navigate } = mockBackend();
    const { client } = await connect({
      answer: () => {
        targets = [page("https://app.local/elsewhere")];
        return { action: "accept", content: { confirm: true } };
      },
    });
    const res = await client.callTool({ name: "navigate", arguments: { target_id: "T1", url: "https://app.local/settings" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the destination policy: a protected destination is refused with no prompt", async () => {
    targets = [page("https://app.local/home")];
    const { navigate } = mockBackend();
    const { client, prompts } = await connect();
    const res = await client.callTool({ name: "navigate", arguments: { target_id: "T1", url: "https://accounts.google.com/signin" } });
    expect(text(res)).toContain("protected");
    expect(prompts).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("CDP_REQUIRE_HUMAN_APPROVAL", () => {
  it("falls back to the flags when the client cannot elicit (default)", async () => {
    targets = [page("https://app.local/home")];
    const { evaluate } = mockBackend();
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "1+1" } });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("refuses evaluate when the client cannot elicit and human approval is required", async () => {
    targets = [page("https://app.local/home")];
    const { evaluate } = mockBackend();
    const { client } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "evaluate", arguments: { target_id: "T1", expression: "1+1" } });
    expect(text(res)).toContain("no human approval channel");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("refuses navigate when the client cannot elicit and human approval is required", async () => {
    targets = [page("https://app.local/home")];
    const { navigate } = mockBackend();
    const { client } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "navigate", arguments: { target_id: "T1", url: "https://app.local/x" } });
    expect(text(res)).toContain("no human approval channel");
    expect(navigate).not.toHaveBeenCalled();
  });
});
