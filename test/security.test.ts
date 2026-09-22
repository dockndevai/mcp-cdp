import { describe, expect, it } from "vitest";
import { matchesPattern, PolicyError, SecurityPolicy, type SecurityConfig } from "../src/security.js";

function makePolicy(overrides: Partial<SecurityConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    targetAllowlist: [],
    protectedTargets: ["chrome://*", "devtools://*", "https://accounts.google.com*"],
    allowEval: false,
    dryRun: false,
    auditLog: false,
    ...overrides,
  });
}

describe("matchesPattern", () => {
  it("does substring, prefix and suffix matching case-insensitively", () => {
    expect(matchesPattern("https://accounts.google.com/signin", "https://accounts.google.com*")).toBe(true);
    expect(matchesPattern("CHROME://settings", "chrome://*")).toBe(true);
    expect(matchesPattern("https://app.local/dash", "*app.local*")).toBe(true);
    expect(matchesPattern("https://example.com", "chrome://*")).toBe(false);
  });
});

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("read-write enables read and write but not admin", () => {
    const p = makePolicy({ mode: "read-write" });
    expect(p.isCapabilityEnabled("write")).toBe(true);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
});

describe("mode vs capability at guard time", () => {
  it("rejects a write in read-only mode", () => {
    const p = makePolicy();
    expect(() => p.guard({ tool: "click", capability: "write" })).toThrow(PolicyError);
  });
  it("rejects admin in read-write mode", () => {
    const p = makePolicy({ mode: "read-write" });
    expect(() => p.guard({ tool: "evaluate", capability: "admin", requiresEval: true })).toThrow(/admin/);
  });
});

describe("target allowlist + protection", () => {
  it("blocks interactions with targets outside a non-empty allowlist", () => {
    const p = makePolicy({ mode: "read-write", targetAllowlist: ["https://app.local*"] });
    expect(() => p.guard({ tool: "click", capability: "write", target: "https://evil.example/" })).toThrow(/allowlist/);
    expect(() => p.guard({ tool: "click", capability: "write", target: "https://app.local/x" })).not.toThrow();
  });
  it("allows inspecting a protected target but not interacting with it", () => {
    const p = makePolicy({ mode: "read-write" });
    expect(() => p.guard({ tool: "dom_snapshot", capability: "read", target: "https://accounts.google.com/x" })).not.toThrow();
    expect(() => p.guard({ tool: "type_text", capability: "write", target: "https://accounts.google.com/x" })).toThrow(/protected/);
  });
  it("protects wildcard target patterns (chrome://*)", () => {
    const p = makePolicy({ mode: "read-write" });
    expect(() => p.guard({ tool: "click", capability: "write", target: "chrome://settings" })).toThrow(/protected/);
  });
  it("does not scope reads by allowlist (inspection is always permitted)", () => {
    const p = makePolicy({ mode: "read-only", targetAllowlist: ["https://app.local*"] });
    expect(() => p.guard({ tool: "dom_snapshot", capability: "read", target: "https://other.example/" })).not.toThrow();
  });
});

describe("eval gating", () => {
  it("blocks evaluate without allowEval even in admin mode", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() => p.guard({ tool: "evaluate", capability: "admin", requiresEval: true })).toThrow(/ALLOW_EVAL/);
  });
  it("permits evaluate with allowEval", () => {
    const p = makePolicy({ mode: "admin", allowEval: true });
    expect(() => p.guard({ tool: "evaluate", capability: "admin", requiresEval: true })).not.toThrow();
  });
});

describe("dry run", () => {
  it("flags interactions but not reads", () => {
    const p = makePolicy({ mode: "read-write", dryRun: true });
    expect(p.guard({ tool: "dom_snapshot", capability: "read" }).dryRun).toBe(false);
    expect(p.guard({ tool: "click", capability: "write" }).dryRun).toBe(true);
  });
});
