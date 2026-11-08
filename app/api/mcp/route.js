/**
 * Next.js Web MCP Endpoint — /api/mcp
 *
 * Exposes the full canvas-tool MCP server over HTTP and Server-Sent Events (SSE).
 * Works seamlessly with web agents, Claude Desktop, Cursor, Antigravity, VS Code,
 * and remote AI workflows on any deployed domain.
 */
import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  PROTOCOL_VERSION,
  SERVER_INFO,
  TOOLS,
  callTool,
} from "@/lib/mcp-core.mjs";

function getInstructions() {
  const p = join(process.cwd(), "CANVAS_TOOL_INSTRUCTIONS.md");
  if (existsSync(p)) {
    try {
      return readFileSync(p, "utf8");
    } catch (_) {}
  }
  return "Canvas Tool MCP: Vector design and flex auto-layout environment.";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Active SSE sessions: sessionId -> TransformStream writer / controller
const activeSessions = new Map();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accept = request.headers.get("accept") || "";
  const isSse = accept.includes("text/event-stream") || searchParams.get("transport") === "sse";

  if (!isSse) {
    if (searchParams.get("instructions") === "true" || accept.includes("text/markdown")) {
      return new Response(getInstructions(), {
        headers: { ...corsHeaders, "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    // Info response for browsers / health checks
    return NextResponse.json(
      {
        server: SERVER_INFO.name,
        version: SERVER_INFO.version,
        protocolVersion: PROTOCOL_VERSION,
        status: "online",
        transport: ["sse", "http-jsonrpc"],
        toolsCount: TOOLS.length,
        sseEndpoint: "/api/mcp?transport=sse",
        postEndpoint: "/api/mcp",
        instructionsUrl: "/api/mcp?instructions=true",
      },
      { headers: corsHeaders },
    );
  }

  // Handle SSE Connection
  const sessionId = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const encoder = new TextEncoder();

  let controllerRef = null;
  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      activeSessions.set(sessionId, controller);

      // Send initial endpoint event as required by MCP SSE spec
      const endpointMsg = `event: endpoint\ndata: /api/mcp?sessionId=${sessionId}\n\n`;
      controller.enqueue(encoder.encode(endpointMsg));
    },
    cancel() {
      activeSessions.delete(sessionId);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { id, method, params } = body || {};
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    let responsePayload = null;

    switch (method) {
      case "initialize":
        responsePayload = {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, prompts: {} },
            serverInfo: SERVER_INFO,
            instructions: getInstructions(),
          },
        };
        break;

      case "ping":
        responsePayload = { jsonrpc: "2.0", id, result: {} };
        break;

      case "prompts/list":
        responsePayload = {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: [
              {
                name: "design_system_instructions",
                description:
                  "Comprehensive design rules, auto-layout flex model, typography hierarchy, and UI component recipes for canvas-tool.",
              },
            ],
          },
        };
        break;

      case "prompts/get":
        responsePayload = {
          jsonrpc: "2.0",
          id,
          result: {
            description: "Canvas Tool AI Design Guidelines",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: getInstructions(),
                },
              },
            ],
          },
        };
        break;

      case "tools/list":
        responsePayload = { jsonrpc: "2.0", id, result: { tools: TOOLS } };
        break;

      case "tools/call": {
        const toolResult = callTool(params ?? {});
        responsePayload = { jsonrpc: "2.0", id, result: toolResult };
        break;
      }

      default:
        responsePayload = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }

    // If an SSE session is active, also push the message event down the stream
    if (sessionId && activeSessions.has(sessionId)) {
      const controller = activeSessions.get(sessionId);
      const encoder = new TextEncoder();
      const sseMsg = `event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`;
      controller.enqueue(encoder.encode(sseMsg));
    }

    return NextResponse.json(responsePayload, { headers: corsHeaders });
  } catch (err) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: `Server error: ${err.message}` },
      },
      { status: 500, headers: corsHeaders },
    );
  }
}
