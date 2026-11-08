#!/usr/bin/env node
/**
 * canvas-tool MCP server — stdio transport (Local CLI / Desktop).
 * Runs against the shared lib/mcp-core.mjs engine.
 */
import {
  PROTOCOL_VERSION,
  SERVER_INFO,
  TOOLS,
  callTool,
} from "../lib/mcp-core.mjs";

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
  const { id, method } = msg;
  const isNotification = id === undefined || id === null;
  if (typeof method !== "string") return;
  if (method.startsWith("notifications/")) return;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    case "tools/call":
      send({ jsonrpc: "2.0", id, result: callTool(msg.params ?? {}) });
      return;
    default:
      if (!isNotification) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      handleMessage(msg);
    } catch (err) {
      if (msg && msg.id != null) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: `Internal error: ${err.message}` },
        });
      }
    }
  }
});
process.stdin.on("end", () => process.exit(0));
