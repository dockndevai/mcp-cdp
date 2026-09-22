/**
 * Security policy engine.
 *
 * Flags decide which tools are registered (capability vs. access mode) and whether each call is
 * allowed at runtime (target scoping, protected targets, eval gating, dry-run). Pure logic — fully
 * unit-testable, no I/O. Defence in depth: the browser process itself is the real boundary, this
 * keeps an agent inside the targets and actions you intend.
 */

export type Capability = "read" | "write" | "admin";
export type AccessMode = "read-only" | "read-write" | "admin";

const MODE_RANK: Record<AccessMode, number> = { "read-only": 0, "read-write": 1, admin: 2 };
const CAPABILITY_RANK: Record<Capability, number> = { read: 0, write: 1, admin: 2 };

export interface SecurityConfig {
  mode: AccessMode;
  /** If set, only targets whose URL matches one of these patterns may be used. Empty = all. */
  targetAllowlist: string[];
  /** Targets that may be inspected but never interacted with (sign-in pages, browser internals). */
  protectedTargets: string[];
  /** Running arbitrary JavaScript (`evaluate`) requires this, on top of admin mode. */
  allowEval: boolean;
  /** Perform interactions in dry-run: log the intent, never dispatch it to the browser. */
  dryRun: boolean;
  auditLog: boolean;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface GuardContext {
  tool: string;
  capability: Capability;
  /** URL of the target a call acts on, when it names one. */
  target?: string;
  /** Marks a call that runs arbitrary JavaScript (gated by CDP_ALLOW_EVAL). */
  requiresEval?: boolean;
  /** High-impact interaction (used for annotations / human confirmation, not a separate flag). */
  destructive?: boolean;
}

/** Case-insensitive match: leading/trailing `*` is a wildcard, otherwise substring. */
export function matchesPattern(url: string, pattern: string): boolean {
  const u = url.toLowerCase();
  const p = pattern.toLowerCase();
  const starts = p.startsWith("*");
  const ends = p.endsWith("*");
  const core = p.replace(/^\*/, "").replace(/\*$/, "");
  if (core === "") return true;
  if (starts && ends) return u.includes(core);
  if (ends) return u.startsWith(core);
  if (starts) return u.endsWith(core);
  return u.includes(core);
}

export class SecurityPolicy {
  constructor(private readonly config: SecurityConfig) {}

  get mode(): AccessMode {
    return this.config.mode;
  }

  isCapabilityEnabled(capability: Capability): boolean {
    return CAPABILITY_RANK[capability] <= MODE_RANK[this.config.mode];
  }

  isTargetAllowed(url: string): boolean {
    if (this.config.targetAllowlist.length === 0) return true;
    return this.config.targetAllowlist.some((p) => matchesPattern(url, p));
  }
  isTargetProtected(url: string): boolean {
    return this.config.protectedTargets.some((p) => matchesPattern(url, p));
  }

  guard(ctx: GuardContext): { dryRun: boolean } {
    if (!this.isCapabilityEnabled(ctx.capability)) {
      this.audit(ctx, "DENY", `capability '${ctx.capability}' exceeds mode '${this.config.mode}'`);
      throw new PolicyError(
        `Operation '${ctx.tool}' requires '${ctx.capability}' access but the server runs in '${this.config.mode}' mode. Set CDP_MODE to grant it.`,
      );
    }

    // Target scoping applies to interactions (writes/eval), not to read-only inspection.
    if (ctx.target !== undefined && ctx.target !== "" && ctx.capability !== "read") {
      if (!this.isTargetAllowed(ctx.target)) {
        this.audit(ctx, "DENY", `target '${ctx.target}' not in allowlist`);
        throw new PolicyError(
          `Target '${ctx.target}' is not in the configured allowlist (CDP_TARGET_ALLOWLIST).`,
        );
      }
      if (this.isTargetProtected(ctx.target)) {
        this.audit(ctx, "DENY", `target '${ctx.target}' is protected`);
        throw new PolicyError(
          `Target '${ctx.target}' is protected (CDP_PROTECTED_TARGETS) — it can be inspected but not interacted with. ` +
            `Sign-in pages and browser-internal surfaces are protected by default.`,
        );
      }
    }

    if (ctx.requiresEval && !this.config.allowEval) {
      this.audit(ctx, "DENY", "eval not enabled");
      throw new PolicyError(
        `Operation '${ctx.tool}' runs arbitrary JavaScript in the page and is disabled. Set CDP_ALLOW_EVAL=true to enable it.`,
      );
    }

    const dryRun = ctx.capability !== "read" && this.config.dryRun;
    this.audit(ctx, dryRun ? "DRY_RUN" : "ALLOW");
    return { dryRun };
  }

  private audit(ctx: GuardContext, decision: string, reason?: string): void {
    if (!this.config.auditLog) return;
    const line = {
      ts: new Date().toISOString(),
      audit: "cdp-mcp",
      decision,
      tool: ctx.tool,
      capability: ctx.capability,
      target: ctx.target ?? null,
      requiresEval: ctx.requiresEval ?? false,
      destructive: ctx.destructive ?? false,
      ...(reason ? { reason } : {}),
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  }
}
