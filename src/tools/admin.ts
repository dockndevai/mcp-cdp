import { z } from "zod";
import type { ToolDef } from "./types.js";
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
    handler: async (args, { client, policy, confirm }) => {
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
      const ok = await confirm.confirm({ action: "evaluate JavaScript", target: t.url, details: { expression: preview } });
      if (!ok.approved) return textResult(`Evaluation cancelled — ${ok.reason}.`);
      const value = await client.evaluate(id, expression, awaitPromise);
      return jsonResult({ value });
    },
  },
];
