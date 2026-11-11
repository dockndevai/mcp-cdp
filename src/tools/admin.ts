import { z } from "zod";
import type { ToolDef } from "./types.js";
import { redactUrl, targetVersionOf } from "../cdp/client.js";
import { jsonResult, textResult } from "./types.js";

/**
 * Admin tools. `evaluate` runs arbitrary JavaScript in the page — effectively code execution in the
 * renderer — so it is registered only in `admin` mode, gated behind CDP_ALLOW_EVAL=true, refused for
 * protected targets, and prompts for human confirmation. Deliberately hard to reach.
 */
export const adminTools: ToolDef[] = [
  {
    name: "evaluate",
    capability: "admin",
    requiresEval: true,
    destructive: true,
    config: {
      title: "Evaluate JavaScript",
      description:
        "Run a JavaScript expression in the target's page context and return its value (JSON where possible). " +
        "This is arbitrary code execution in the renderer — requires admin mode and CDP_ALLOW_EVAL=true, is refused " +
        "for protected targets, and prompts for human confirmation. Honours CDP_DRY_RUN.",
      inputSchema: {
        target_id: z.string().describe("Target id from list_targets."),
        expression: z.string().describe("JavaScript expression to evaluate, e.g. 'document.title' or 'location.href'."),
        await_promise: z.boolean().optional().describe("Await the expression if it evaluates to a Promise (default false)."),
      },
    },
    handler: async (args, { client, policy, confirm, guard }) => {
      const id = args.target_id as string;
      const expression = args.expression as string;
      const awaitPromise = (args.await_promise as boolean | undefined) ?? false;
      const t = await client.findTarget(id);
      const { dryRun } = policy.guard({
        tool: "evaluate",
        capability: "admin",
        target: t.url,
        requiresEval: true,
        destructive: true,
      });
      const preview = expression.length > 120 ? `${expression.slice(0, 120)}…` : expression;
      if (dryRun) return textResult(`[dry-run] Would evaluate in ${t.url}: ${preview}`);
      await guard.enforce({ tool: "evaluate", command: `evaluate JavaScript: ${expression}`, context: t.url }, confirm);
      // The prompt shows the exact expression (in the bound arguments) and its fingerprint. The probe pins the
      // page it runs against (CDP target id + URL): if the app navigated or replaced the page while the human
      // was deciding, the approval is void rather than executing against a page nobody approved.
      const ok = await confirm.confirm({
        action: "evaluate JavaScript",
        target: redactUrl(t.url),
        details: { target_id: id },
        probe: () => client.targetVersion(id),
      });
      if (!ok.approved) return textResult(`Evaluation cancelled — ${ok.reason}.`);
      // The allowlist / protected-target checks above ran against `t.url`. The version pinned for the prompt must be
      // that same page, otherwise it moved (e.g. while laya-guard or the human was deciding) after those checks.
      if (ok.receipt.version !== targetVersionOf(t)) {
        return textResult("Evaluation cancelled — the page changed after the target policy check; call list_targets and retry.");
      }
      const value = await client.evaluate(id, expression, awaitPromise);
      return jsonResult({ value });
    },
  },
];
