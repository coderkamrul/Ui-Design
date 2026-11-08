# canvas-tool MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that
lets any AI agent create, inspect, and edit canvas-tool design files, pages,
modern flex layouts, typography, and design tokens. It is written against
the MCP stdio transport (newline-delimited JSON-RPC 2.0) with **zero npm dependencies**:
plain Node.js, nothing to install.

## What it edits

The tool's own document format, as standalone JSON files:

- **One `<fileId>.json` per file**, containing the full document JSON —
  exactly what the app's dashboard **Export JSON** button downloads, and what
  its **Import JSON** button accepts.
- Files live in a workspace directory: the `CANVAS_TOOL_DIR` environment
  variable, or `./canvastool-files` relative to the server's working directory.
- Every write is atomic (tmp file + rename), so crashed edits never leave corrupted files.

### The round trip (how agent edits reach the app)

1. In the app dashboard, pick a file's **••• menu → Export JSON** and
   save the download into the workspace directory.
2. The agent reads, creates, and edits designs with the MCP tools below.
3. Back in the dashboard, **Import JSON** and pick the edited file.

## Client configuration

```json
{
  "mcpServers": {
    "canvas-tool": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-tool/mcp/server.mjs"],
      "env": {
        "CANVAS_TOOL_DIR": "/absolute/path/to/canvastool-files"
      }
    }
  }
}
```

## Available MCP Tools

### 1. Document & File Management
- **`list_files`** — List all design files in the directory with page and node counts.
- **`read_file`** (`fileId`) — Read full document JSON (tokens, pages, node tree, styles).
- **`create_file`** (`title?`) — Create a new blank design file.
- **`duplicate_file`** (`fileId`, `title?`) — Duplicate an existing design file.
- **`delete_file`** (`fileId`) — Permanently delete a design file.

### 2. Page Management
- **`list_pages`** (`fileId`) — List all canvas tabs/pages (id, name, background, node count).
- **`create_page`** (`fileId`, `name?`, `background?`, `icon?`) — Create a new page (e.g. "Checkout", "Pricing").
- **`update_page`** (`fileId`, `pageId`, `patch: { name?, background?, icon? }`) — Rename or style a page.
- **`delete_page`** (`fileId`, `pageId`) — Delete a page and its nodes.

### 3. Node & Layout Operations
- **`list_nodes`** (`fileId`, `pageId?`) — List nodes flat or in hierarchy with depth.
- **`get_node`** (`fileId`, `nodeId`) — Get complete node properties.
- **`add_node`** (`fileId`, `pageId`, `parentId?`, `node`) — Add a single node (frame, rect, text, path, shader, image).
- **`update_node`** (`fileId`, `nodeId`, `patch`) — Update geometry, flex layout, styles, or text.
- **`batch_update_nodes`** (`fileId`, `updates: [{ nodeId, patch }]`) — Update multiple nodes in a single call.
- **`duplicate_node`** (`fileId`, `nodeId`, `parentId?`) — Clone a node and its entire subtree.
- **`reparent_node`** (`fileId`, `nodeId`, `newParentId?`, `insertIndex?`) — Move nodes between frames.
- **`delete_node`** (`fileId`, `nodeId`) — Delete a node and its descendants.

### 4. High-Speed AI Generation: `create_tree`
Generate entire responsive UI sections, components, or pages in **a single tool call**:

```json
{
  "name": "create_tree",
  "arguments": {
    "fileId": "file-123",
    "pageId": "page-1",
    "root": {
      "type": "frame",
      "name": "Hero Section",
      "w": 1200,
      "h": 600,
      "layout": {
        "mode": "flex",
        "direction": "column",
        "gap": 24,
        "padding": 48,
        "alignMain": "center",
        "alignCross": "center"
      },
      "style": { "fill": "#0F172A", "radius": 16 },
      "children": [
        {
          "type": "text",
          "name": "Heading",
          "text": {
            "content": "Craft Beautiful Interfaces with AI",
            "fontSize": 48,
            "fontWeight": 700,
            "color": "#FFFFFF"
          }
        },
        {
          "type": "frame",
          "name": "CTA Button",
          "w": 180,
          "h": 48,
          "layout": { "mode": "flex", "alignMain": "center", "alignCross": "center" },
          "style": { "fill": "#2563EB", "radius": 8 },
          "children": [
            {
              "type": "text",
              "text": { "content": "Get Started", "fontWeight": 600, "color": "#FFFFFF" }
            }
          ]
        }
      ]
    }
  }
}
```

### 5. Design Tokens (Themes)
- **`list_tokens`** (`fileId`) — List all color, typography, spacing, radius tokens.
- **`add_token`** (`fileId`, `token: { type, name, value }`) — Create a new token.
- **`update_token`** (`fileId`, `tokenId`, `patch: { name?, value? }`) — Update a token.
- **`delete_token`** (`fileId`, `tokenId`) — Delete a token and detach from nodes.
