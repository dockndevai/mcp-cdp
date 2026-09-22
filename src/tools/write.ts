import { z } from "zod";
import type { ToolDef } from "./types.js";
import { textResult } from "./types.js";

const targetId = z.string().describe("Target id from list_targets.");

/**
 * Interaction tools. Registered in `read-write` mode and up. All honour the target allowlist and
 * protected targets (sign-in pages / browser internals are refused), and CDP_DRY_RUN. `navigate`
 * additionally asks a human to confirm, since it can carry the page somewhere it shouldn't go.
 */
export const writeTools: ToolDef[] = [
  {
    name: "click",
    capability: "write",
    config: {
      title: "Click an element",
      description:
        "Click the first element matching a CSS selector (dispatched at its centre point). Use query_dom first to " +
        "pin down the selector.",
      inputSchema: { target_id: targetId, selector: z.string().describe("CSS selector of the element to click.") },
    },
    handler: async (args, { client, policy }) => {
      const id = args.target_id as string;
      const selector = args.selector as string;
      const t = await client.findTarget(id);
      const { dryRun } = policy.guard({ tool: "click", capability: "write", target: t.url });
      if (dryRun) return textResult(`[dry-run] Would click '${selector}' in ${t.url}.`);
      const pt = await client.click(id, selector);
      return textResult(`Clicked '${selector}' at (${Math.round(pt.x)}, ${Math.round(pt.y)}).`);
    },
  },
  {
    name: "type_text",
    capability: "write",
    config: {
      title: "Type text",
      description:
        "Type text into the page. With a selector, the element is focused (clicked) first. Do not type passwords, " +
        "tokens or other secrets.",
      inputSchema: {
        target_id: targetId,
        text: z.string().describe("Text to insert."),
        selector: z.string().optional().describe("CSS selector to focus before typing (omit to type into the focused element)."),
      },
    },
    handler: async (args, { client, policy }) => {
      const id = args.target_id as string;
      const text = args.text as string;
      const selector = args.selector as string | undefined;
      const t = await client.findTarget(id);
      const { dryRun } = policy.guard({ tool: "type_text", capability: "write", target: t.url });
      if (dryRun) return textResult(`[dry-run] Would type ${text.length} chars${selector ? ` into '${selector}'` : ""} in ${t.url}.`);
      await client.typeText(id, text, selector);
      return textResult(`Typed ${text.length} chars${selector ? ` into '${selector}'` : ""}.`);
    },
  },
  {
    name: "press_key",
    capability: "write",
    config: {
      title: "Press a key",
      description: "Dispatch a single named key: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right.",
      inputSchema: {
        target_id: targetId,
        key: z
          .enum(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])
          .describe("The key to press."),
      },
    },
    handler: async (args, { client, policy }) => {
      const id = args.target_id as string;
      const key = args.key as string;
      const t = await client.findTarget(id);
      const { dryRun } = policy.guard({ tool: "press_key", capability: "write", target: t.url });
      if (dryRun) return textResult(`[dry-run] Would press ${key} in ${t.url}.`);
      await client.pressKey(id, key);
      return textResult(`Pressed ${key}.`);
    },
  },
  {
    name: "navigate",
    capability: "write",
    destructive: true,
    idempotent: false,
    config: {
      title: "Navigate",
      description:
        "Navigate a target to a URL. The destination must pass the target allowlist and must not be a protected " +
        "target (sign-in pages / browser internals). Asks a human to confirm; honours CDP_DRY_RUN.",
      inputSchema: { target_id: targetId, url: z.string().describe("Destination URL.") },
    },
    handler: async (args, { client, policy, confirm }) => {
      const id = args.target_id as string;
      const url = args.url as string;
      // Scope on the DESTINATION url — that is what we're moving to.
      const { dryRun } = policy.guard({ tool: "navigate", capability: "write", target: url, destructive: true });
      if (dryRun) return textResult(`[dry-run] Would navigate target ${id} to ${url}.`);
      const ok = await confirm.confirm({ action: "navigate the page", target: url });
      if (!ok.approved) return textResult(`Navigation cancelled — ${ok.reason}.`);
      await client.navigate(id, url);
      return textResult(`Navigated target ${id} to ${url}.`);
    },
  },
];
