import type { ZodRawShape } from "zod";
import type { Confirmer } from "../elicit.js";
import type { CdpClient } from "../cdp/client.js";
import type { Capability, SecurityPolicy } from "../security.js";

export interface ToolContext {
  client: CdpClient;
  policy: SecurityPolicy;
  /** Human-in-the-loop confirmation for destructive/high-impact ops (no-op fallback when the client can't elicit). */
  confirm: Confirmer;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  capability: Capability;
  /** Marks a high-impact interaction (used for annotations + human confirmation). Defaults to `capability === "admin"`. */
  destructive?: boolean;
  /** Marks a tool that runs arbitrary JavaScript — gated by CDP_ALLOW_EVAL. */
  requiresEval?: boolean;
  /** Overrides the idempotency hint. Defaults to `true` for read tools, `false` otherwise. */
  idempotent?: boolean;
  config: {
    title: string;
    description: string;
    inputSchema: Shape;
  };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function imageResult(data: string, caption: string, mimeType = "image/png"): ToolResult {
  return { content: [{ type: "image", data, mimeType }, { type: "text", text: caption }] };
}
