import { z } from "zod";
import type { ToolDef } from "./types.js";
import { imageResult, jsonResult, textResult } from "./types.js";

const targetId = z
  .string()
  .describe("Target id from list_targets — the page / webview / Electron window to inspect.");

export const readTools: ToolDef[] = [
  {
    name: "list_targets",
    capability: "read",
    config: {
      title: "List targets",
      description:
        "List the debuggable targets on the DevTools endpoint — pages, webviews and Electron windows — with " +
        "their id, type, title and URL. Start here to find the target id every other tool needs.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "list_targets", capability: "read" });
      const targets = await client.listTargets();
      return jsonResult(
        targets.map((t) => ({
          id: t.id,
          type: t.type,
          title: t.title,
          url: t.url,
          protected: policy.isTargetProtected(t.url),
          allowed: policy.isTargetAllowed(t.url),
        })),
      );
    },
  },
  {
    name: "dom_snapshot",
    capability: "read",
    config: {
      title: "DOM snapshot",
      description:
        "Return the rendered HTML of a target — the whole document, or just the subtree of the first element " +
        "matching a CSS selector. This is the DOM the agent should read instead of a screenshot: it carries far " +
        "more information and is exact.",
      inputSchema: {
        target_id: targetId,
        selector: z.string().optional().describe("CSS selector to scope the snapshot to (omit for the full document)."),
      },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "dom_snapshot", capability: "read" });
      const html = await client.outerHtml(a.target_id as string, a.selector as string | undefined);
      return textResult(html);
    },
  },
  {
    name: "query_dom",
    capability: "read",
    config: {
      title: "Query DOM",
      description:
        "Return the outer HTML of every element matching a CSS selector (capped). Use to locate the exact " +
        "elements to click or type into, and to confirm what is actually on the page.",
      inputSchema: {
        target_id: targetId,
        selector: z.string().describe("CSS selector, e.g. 'button.submit' or '[data-testid=login]'."),
        limit: z.number().int().min(1).max(200).optional().describe("Max matches to return (default 20)."),
      },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "query_dom", capability: "read" });
      const limit = Math.min((a.limit as number | undefined) ?? 20, 200);
      const matches = await client.queryAll(a.target_id as string, a.selector as string, limit);
      return jsonResult({ count: matches.length, matches });
    },
  },
  {
    name: "console_logs",
    capability: "read",
    config: {
      title: "Console logs",
      description:
        "Return recent console output and uncaught exceptions captured from the target since it was first " +
        "inspected. The fastest way to see why something failed — errors that never appear on screen.",
      inputSchema: {
        target_id: targetId,
        limit: z.number().int().min(1).max(1000).optional().describe("Max entries (most recent first-in-window)."),
      },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "console_logs", capability: "read" });
      // Ensure a session exists so buffering has been running.
      await client.attach(a.target_id as string);
      const limit = Math.min((a.limit as number | undefined) ?? client.maxResults, client.maxResults);
      return jsonResult(client.consoleLogs(a.target_id as string, limit));
    },
  },
  {
    name: "network_requests",
    capability: "read",
    config: {
      title: "Network requests",
      description:
        "Return recent network requests captured from the target — method, URL, status, MIME type, failures. " +
        "Headers are never captured and sensitive URL query values are redacted.",
      inputSchema: {
        target_id: targetId,
        url_filter: z.string().optional().describe("Only requests whose URL contains this substring."),
        limit: z.number().int().min(1).max(1000).optional().describe("Max entries."),
      },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "network_requests", capability: "read" });
      await client.attach(a.target_id as string);
      const limit = Math.min((a.limit as number | undefined) ?? client.maxResults, client.maxResults);
      return jsonResult(client.networkRequests(a.target_id as string, limit, a.url_filter as string | undefined));
    },
  },
  {
    name: "screenshot",
    capability: "read",
    config: {
      title: "Screenshot",
      description:
        "Capture a PNG screenshot of the target's viewport. Prefer dom_snapshot for reading content; use this " +
        "for visual layout, rendering and image checks.",
      inputSchema: { target_id: targetId },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "screenshot", capability: "read" });
      const data = await client.screenshot(a.target_id as string);
      return imageResult(data, `Screenshot of target ${a.target_id}.`);
    },
  },
];
