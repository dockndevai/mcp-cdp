import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import { makeConfirmer } from "./elicit.js";
import { GuardClient, loadGuardConfig } from "./guard.js";
import { CdpClient, CdpError } from "./cdp/client.js";
import { PolicyError, SecurityPolicy } from "./security.js";
import { adminTools } from "./tools/admin.js";
import { annotationsFor } from "./tools/annotations.js";
import { readTools } from "./tools/read.js";
import type { ToolContext, ToolDef } from "./tools/types.js";
import { writeTools } from "./tools/write.js";

export const ALL_TOOLS: ToolDef[] = [...readTools, ...writeTools, ...adminTools];

export function buildServer(config: AppConfig): { server: McpServer; client: CdpClient; enabled: string[] } {
  const policy = new SecurityPolicy(config.security);
  const client = new CdpClient(config.connection);

  const server = new McpServer({ name: "cdp", version: "0.2.1" });
  const guard = new GuardClient(loadGuardConfig());
  const ctx: ToolContext = { client, policy, confirm: makeConfirmer(server), guard };

  const enabled: string[] = [];
  for (const tool of ALL_TOOLS) {
    if (!policy.isCapabilityEnabled(tool.capability)) continue;
    enabled.push(tool.name);
    server.registerTool(
      tool.name,
      { ...tool.config, annotations: annotationsFor(tool) },
      async (args: Record<string, unknown>) => {
        try {
          return await tool.handler(args ?? {}, ctx);
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  }

  return { server, client, enabled };
}

function toErrorResult(err: unknown) {
  let message: string;
  if (err instanceof PolicyError) {
    message = `Policy denied: ${err.message}`;
  } else if (err instanceof CdpError) {
    message = `CDP error: ${err.message}`;
  } else if (err instanceof Error) {
    message = `${err.name}: ${err.message}`;
  } else {
    message = String(err);
  }
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
