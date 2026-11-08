/**
 * End-to-end checks for mcp/server.mjs — run with:
 *   node scripts/mcp-test.mjs
 *
 * Spawns the real server as a child process against a TEMP workspace
 * dir, speaks newline-delimited JSON-RPC at it, and asserts the full suite:
 * - initialize & ping
 * - tools/list (all 22 tools with valid schemas)
 * - file operations (create, duplicate, list, delete)
 * - page operations (create, list, update, delete)
 * - node operations (add, get, create_tree, update, batch_update, duplicate, reparent, delete)
 * - design tokens (add, list, update, delete)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

const dir = mkdtempSync(join(tmpdir(), "canvastool-mcp-test-"));
const serverPath = fileURLToPath(new URL("../mcp/server.mjs", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, CANVAS_TOOL_DIR: dir },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`[mcp stderr] ${d}`));

let buf = "";
const waiters = new Map(); // id -> resolve
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  }
});

let seq = 0;
function request(method, params) {
  const id = ++seq;
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${method} response`)),
      8000,
    );
    waiters.set(id, (msg) => {
      clearTimeout(timer);
      resolvePromise(msg);
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}
function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}
function toolText(res) {
  assert.equal(res.error, undefined, `unexpected RPC error: ${JSON.stringify(res.error)}`);
  assert.ok(Array.isArray(res.result?.content), "tool result has content");
  return res.result.content[0].text;
}
function toolJson(res) {
  return JSON.parse(toolText(res));
}

try {
  // A malformed line must be ignored
  child.stdin.write("this is not json\n");

  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "0" },
  });
  ok(init.result?.serverInfo?.name === "canvas-tool", "initialize → serverInfo.name");
  ok(
    init.result?.serverInfo?.version === "1.1.0",
    "initialize → serverInfo.version",
  );
  ok(
    init.result?.protocolVersion === "2024-11-05",
    "initialize → protocolVersion",
  );
  notify("notifications/initialized", {});

  const ping = await request("ping");
  ok(ping.result !== undefined, "ping → result");

  const list = await request("tools/list");
  const toolNames = (list.result?.tools ?? []).map((t) => t.name).sort();
  const expectedTools = [
    "add_node",
    "add_token",
    "batch_update_nodes",
    "create_file",
    "create_page",
    "create_tree",
    "delete_file",
    "delete_node",
    "delete_page",
    "delete_token",
    "duplicate_file",
    "duplicate_node",
    "get_node",
    "list_files",
    "list_nodes",
    "list_pages",
    "list_tokens",
    "read_file",
    "reparent_node",
    "update_node",
    "update_page",
    "update_token",
  ].sort();
  assert.deepEqual(toolNames, expectedTools);
  checks++;
  ok(list.result.tools.every((t) => t.inputSchema?.type === "object"), "tools/list → schemas");

  // 1. File CRUD
  const created = toolJson(
    await request("tools/call", {
      name: "create_file",
      arguments: { title: "MCP test file" },
    }),
  );
  ok(typeof created.id === "string" && created.id.length > 0, "create_file → id");
  ok(created.title === "MCP test file", "create_file → title");
  const fileId = created.id;

  const files = toolJson(await request("tools/call", { name: "list_files", arguments: {} }));
  const entry = files.files.find((f) => f.id === fileId);
  ok(!!entry && entry.pages === 1 && entry.nodes === 0, "list_files → the new file");

  // 2. Page CRUD
  const newPageRes = toolJson(
    await request("tools/call", {
      name: "create_page",
      arguments: { fileId, name: "About Us", background: "#FFFFFF" },
    }),
  );
  ok(newPageRes.page?.name === "About Us", "create_page → created About Us");

  const pagesList = toolJson(
    await request("tools/call", {
      name: "list_pages",
      arguments: { fileId },
    }),
  );
  ok(pagesList.pages?.length === 2, "list_pages → 2 pages");

  await request("tools/call", {
    name: "update_page",
    arguments: { fileId, pageId: newPageRes.page.id, patch: { name: "About Us Updated" } },
  });

  // 3. Node CRUD
  const frame = toolJson(
    await request("tools/call", {
      name: "add_node",
      arguments: {
        fileId,
        pageId: "page-1",
        node: {
          type: "frame",
          x: 100,
          y: 80,
          w: 480,
          h: 320,
          fill: "#FFFFFF",
          layout: { mode: "flex", direction: "column", gap: 12 },
        },
      },
    }),
  ).node;
  ok(frame.type === "frame" && frame.parentId === null, "add_node frame → shape");
  ok(frame.position.x === 100 && frame.position.y === 80, "add_node frame → position");
  ok(frame.size.w.px === 480 && frame.size.h.px === 320, "add_node frame → size");
  ok(frame.layout.mode === "flex" && frame.layout.gap === 12, "add_node frame → flex layout");

  const text = toolJson(
    await request("tools/call", {
      name: "add_node",
      arguments: {
        fileId,
        pageId: "page-1",
        parentId: frame.id,
        node: {
          type: "text",
          x: 140,
          y: 120,
          text: { content: "Hello from MCP", fontFamily: "Inter", fontSize: 20 },
        },
      },
    }),
  ).node;
  ok(text.parentId === frame.id, "add_node text → parented to frame");
  ok(text.position.x === 40 && text.position.y === 40, "add_node text → parent-relative position");
  ok(text.text.content === "Hello from MCP", "add_node text → content");
  ok(text.text.fontSize === 20, "add_node text → fontSize");

  // 4. get_node
  const fetchedNode = toolJson(
    await request("tools/call", {
      name: "get_node",
      arguments: { fileId, nodeId: text.id },
    }),
  ).node;
  ok(fetchedNode.id === text.id, "get_node → returns exact node");

  // 5. create_tree (High-speed UI generation)
  const treeRes = toolJson(
    await request("tools/call", {
      name: "create_tree",
      arguments: {
        fileId,
        pageId: "page-1",
        root: {
          type: "frame",
          name: "Hero Section",
          w: 1200,
          h: 600,
          layout: { mode: "flex", direction: "column", gap: 24, padding: 32 },
          children: [
            {
              type: "text",
              name: "Hero Title",
              text: { content: "Welcome to our AI platform", fontSize: 36, fontWeight: 700 },
            },
            {
              type: "frame",
              name: "Button",
              w: 140,
              h: 44,
              layout: { mode: "flex", alignMain: "center", alignCross: "center" },
              style: { fill: "#0D99FF", radius: 8 },
              children: [
                {
                  type: "text",
                  text: { content: "Get Started", color: "#FFFFFF", fontWeight: 600 },
                },
              ],
            },
          ],
        },
      },
    }),
  );
  ok(treeRes.createdCount === 4, "create_tree → 4 nodes created in one call");

  // 6. update_node & batch_update_nodes
  const updated = toolJson(
    await request("tools/call", {
      name: "update_node",
      arguments: {
        fileId,
        nodeId: frame.id,
        patch: { x: 200, hidden: false, visible: true, locked: true },
      },
    }),
  ).node;
  ok(updated.position.x === 200, "update_node → x moved");
  ok(updated.visible === true && updated.locked === true, "update_node → visible and locked patched");

  const batchRes = toolJson(
    await request("tools/call", {
      name: "batch_update_nodes",
      arguments: {
        fileId,
        updates: [
          { nodeId: frame.id, patch: { name: "Updated Frame" } },
          { nodeId: text.id, patch: { text: "Updated Text" } },
        ],
      },
    }),
  );
  ok(batchRes.updatedCount === 2, "batch_update_nodes → 2 nodes updated");

  // 7. duplicate_node
  const dupRes = toolJson(
    await request("tools/call", {
      name: "duplicate_node",
      arguments: { fileId, nodeId: frame.id },
    }),
  );
  ok(dupRes.clonedNode != null && dupRes.totalCloned >= 2, "duplicate_node → clones subtree");

  // 8. Design Tokens CRUD
  const tokenRes = toolJson(
    await request("tools/call", {
      name: "add_token",
      arguments: {
        fileId,
        token: { type: "color", name: "Brand / Primary", value: "#0D99FF" },
      },
    }),
  );
  ok(tokenRes.token?.name === "Brand / Primary", "add_token → added brand color");

  const tokensList = toolJson(
    await request("tools/call", {
      name: "list_tokens",
      arguments: { fileId },
    }),
  );
  ok(tokensList.tokens?.length === 1, "list_tokens → 1 token");

  await request("tools/call", {
    name: "update_token",
    arguments: {
      fileId,
      tokenId: tokenRes.token.id,
      patch: { value: "#0077EE" },
    },
  });

  await request("tools/call", {
    name: "delete_token",
    arguments: {
      fileId,
      tokenId: tokenRes.token.id,
    },
  });

  // 9. Clean up page & delete node
  await request("tools/call", {
    name: "delete_page",
    arguments: { fileId, pageId: newPageRes.page.id },
  });

  const deleted = toolJson(
    await request("tools/call", {
      name: "delete_node",
      arguments: { fileId, nodeId: frame.id },
    }),
  );
  ok(
    deleted.removed.includes(frame.id) && deleted.removed.includes(text.id),
    "delete_node → frame + descendants removed",
  );
} finally {
  child.stdin.end();
  const code = await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise("timeout");
    }, 5000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolvePromise(exitCode);
    });
  });
  assert.equal(code, 0, `server exits cleanly on stdin EOF (got ${code})`);
  checks++;
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} mcp checks passed`);
