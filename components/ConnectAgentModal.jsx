"use client";

import { useState, useEffect } from "react";
import { Check, Copy, Globe, Terminal, Sparkles, ExternalLink } from "lucide-react";

const AGENTS = [
  {
    id: "claude",
    name: "Claude",
    target: "Claude Desktop",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        <line x1="4.93" y1="19.07" x2="19.07" y2="4.93" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "cursor",
    name: "Cursor",
    target: "Cursor",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 16-9 5-9-5V8l9-5 9 5v8Z" />
        <path d="M12 3v18" />
        <path d="m3 8 9 5 9-5" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    target: "Antigravity",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 22h20L12 2z" />
        <path d="M6.5 15h11" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "opencode",
    name: "OpenCode",
    target: "OpenCode",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "vscode",
    name: "VS Code",
    target: "VS Code",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 3.5L8 10.5L3.5 7L2 8.5L6.5 12L2 15.5L3.5 17L8 13.5L16.5 20.5L22 17.5V6.5L16.5 3.5Z" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    target: "GitHub Copilot",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="14" rx="4" />
        <line x1="8" y1="12" x2="10" y2="12" />
        <line x1="14" y1="12" x2="16" y2="12" />
        <path d="M9 2v3" />
        <path d="M15 2v3" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "codex",
    name: "Codex",
    target: "Codex",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2Z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
  {
    id: "other",
    name: "Other agents",
    target: "other agents",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    ),
    getConfig: (origin, mode) =>
      mode === "web"
        ? {
            mcpServers: {
              "canvas-tool": {
                type: "sse",
                url: `${origin}/api/mcp`,
              },
            },
          }
        : {
            mcpServers: {
              "canvas-tool": {
                type: "stdio",
                command: "node",
                args: ["${PROJECT_PATH}/mcp/server.mjs"],
              },
            },
          },
  },
];

export default function ConnectAgentModal({ onClose }) {
  const [selectedAgentId, setSelectedAgentId] = useState("claude");
  const [connectionMode, setConnectionMode] = useState("web"); // "web" (remote SSE) | "desktop" (local stdio)
  const [copied, setCopied] = useState(false);
  const [instructionsCopied, setInstructionsCopied] = useState(false);
  const [origin, setOrigin] = useState("https://your-domain.com");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  const selectedAgent =
    AGENTS.find((a) => a.id === selectedAgentId) || AGENTS[0];

  const currentConfig = selectedAgent.getConfig(origin, connectionMode);
  const configJson = JSON.stringify(currentConfig, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(configJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none font-sans"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[740px] rounded-2xl border border-[var(--line)] bg-[var(--surface-content)] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150 text-[var(--text-1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Mode Toggle */}
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-1)] tracking-tight">
              Connect your AI Agent
            </h2>
            <p className="text-xs text-[var(--text-2)] mt-0.5">
              Control and create designs in canvas-tool using Model Context Protocol (MCP)
            </p>
          </div>

          {/* Mode Switcher: Web vs Desktop */}
          <div className="flex items-center rounded-lg bg-[var(--surface-hover)] p-0.5 border border-[var(--line)] text-xs font-medium">
            <button
              type="button"
              onClick={() => setConnectionMode("web")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                connectionMode === "web"
                  ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-2xs font-semibold"
                  : "text-[var(--text-2)] hover:text-[var(--text-1)]"
              }`}
            >
              <Globe size={13} />
              <span>Web / Cloud</span>
            </button>
            <button
              type="button"
              onClick={() => setConnectionMode("desktop")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                connectionMode === "desktop"
                  ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-2xs font-semibold"
                  : "text-[var(--text-2)] hover:text-[var(--text-1)]"
              }`}
            >
              <Terminal size={13} />
              <span>Local / CLI</span>
            </button>
          </div>
        </div>

        {/* Two-Column Body */}
        <div className="flex min-h-[380px] max-h-[75vh] overflow-hidden">
          {/* Left Sidebar: Agents list */}
          <div className="w-[190px] shrink-0 border-r border-[var(--line)] p-2 flex flex-col gap-0.5 overflow-y-auto">
            {AGENTS.map((agent) => {
              const isActive = agent.id === selectedAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-normal text-left transition-colors cursor-pointer ${
                    isActive
                      ? "bg-[var(--surface-hover)] font-medium text-[var(--text-1)]"
                      : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <span
                    className={`shrink-0 ${
                      isActive ? "text-[var(--text-1)]" : "text-[var(--text-2)]"
                    }`}
                  >
                    {agent.icon}
                  </span>
                  <span className="truncate">{agent.name}</span>
                </button>
              );
            })}
          </div>

          {/* Right Content Pane */}
          <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-5">
            {/* Step 1: Endpoint & Status */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1e1e1e] text-[11px] font-bold text-white shrink-0">
                  1
                </span>
                <span className="text-sm font-semibold text-[var(--text-1)]">
                  {connectionMode === "web" ? "Live Web Server" : "Local Stdio Server"}
                </span>
              </div>

              <div className="rounded-xl bg-[var(--surface-hover)] p-3.5 flex items-center justify-between gap-3 border border-[var(--line)]/50">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-[var(--text-1)] font-medium flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    {connectionMode === "web"
                      ? `Endpoint dynamically active at ${origin}`
                      : "Server runs directly with Node.js on your computer"}
                  </span>
                  <span className="text-[11px] text-[var(--text-2)]">
                    {connectionMode === "web"
                      ? "Zero local software required. Agents connect directly via SSE."
                      : "Direct disk access to design files in canvastool-files folder."}
                  </span>
                </div>

                <div className="px-2.5 py-1 rounded-md bg-[var(--surface-content)] border border-[var(--line)] text-[11px] font-mono text-[var(--text-2)] shrink-0">
                  {connectionMode === "web" ? "/api/mcp" : "server.mjs"}
                </div>
              </div>
            </div>

            {/* Step 2: Configuration Snippet */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0D99FF] text-white shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="text-sm font-semibold text-[var(--text-1)]">
                  Connect to {selectedAgent.target}
                </span>
              </div>

              <p className="text-xs text-[var(--text-2)] pl-7 -mt-1 font-normal">
                Add this configuration to your {selectedAgent.name} MCP settings:
              </p>

              {/* Code Box with Copy Button */}
              <div className="relative rounded-xl border border-[var(--line)] bg-[var(--surface-hover)] p-4 font-mono text-[12px] leading-relaxed text-[var(--text-1)] group">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute top-3 right-3 p-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5 text-[11px] font-sans"
                  title="Copy configuration snippet"
                >
                  {copied ? (
                    <>
                      <Check size={13} className="text-emerald-500" />
                      <span className="text-emerald-500 font-medium">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <pre className="overflow-x-auto pr-8">
                  <code>{configJson}</code>
                </pre>
              </div>

              <p className="text-[11px] text-[var(--text-2)] leading-relaxed opacity-80">
                {connectionMode === "web"
                  ? `This snippet automatically targets ${origin}/api/mcp. When deployed to any custom domain, it dynamically updates.`
                  : "Replace ${PROJECT_PATH} with your local folder path (or run via npx)."}
              </p>
            </div>

            {/* Step 3: AI System Instructions & Guidelines */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[var(--line)]/60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#10B981] text-white shrink-0">
                    <Sparkles size={11} strokeWidth={2.5} />
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-1)]">
                    AI Design Instructions & Setup Guide
                  </span>
                </div>
                <a
                  href={`${origin}/api/mcp?instructions=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[#0D99FF] hover:underline flex items-center gap-1 font-medium"
                >
                  View Guide <ExternalLink size={10} />
                </a>
              </div>

              <p className="text-xs text-[var(--text-2)] pl-7 -mt-1 font-normal">
                These rules are automatically delivered to your agent via MCP initialize, or you can paste them into your custom AI instructions:
              </p>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-hover)] p-3 text-xs text-[var(--text-2)] flex items-center justify-between gap-3">
                <span className="leading-snug">
                  Rules for auto-layout flex frames, high-contrast typography, hug-contents sizing, and component patterns.
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/mcp?instructions=true");
                      const txt = await res.text();
                      await navigator.clipboard.writeText(txt);
                      setInstructionsCopied(true);
                      setTimeout(() => setInstructionsCopied(false), 2000);
                    } catch (_) {}
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors text-xs font-medium flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                >
                  {instructionsCopied ? (
                    <>
                      <Check size={12} className="text-emerald-500" />
                      <span className="text-emerald-500 font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy AI Prompt</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[var(--line)] flex items-center justify-between bg-[var(--surface-content)]">
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[var(--text-2)] hover:text-[var(--text-1)] flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Learn about MCP</span>
            <ExternalLink size={11} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-5 rounded-lg bg-[#1f1f1f] hover:bg-black text-white text-xs font-medium transition-colors shadow-2xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
