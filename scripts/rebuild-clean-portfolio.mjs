// scripts/rebuild-clean-portfolio.mjs
// Clean, professional, high-contrast Graphic Designer Portfolio landing page

const PORT = 3000;
const MCP_ENDPOINT = `http://localhost:${PORT}/api/mcp`;

async function callMcp(toolName, args) {
  const res = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) throw new Error(`MCP error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`MCP RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

function getCleanPortfolioSpec() {
  return {
    type: "frame",
    name: "Portfolio - Graphic Designer",
    x: 80,
    y: 80,
    w: 1440,
    h: 2400,
    layout: {
      mode: "flex",
      direction: "column",
      gap: 56,
      padding: { top: 48, right: 80, bottom: 80, left: 80 },
      alignItems: "stretch",
    },
    style: {
      fill: "#0A0B10",
      radius: 0,
      overflow: "hidden",
    },
    children: [
      // 1. Navigation Header
      {
        type: "frame",
        name: "Navbar",
        w: 1280,
        h: 56,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        style: { fill: "transparent" },
        children: [
          // Logo
          {
            type: "text",
            name: "Studio Logo",
            w: "fit",
            h: "fit",
            style: { fill: "#FFFFFF" },
            text: {
              content: "KAMRUL HASAN / STUDIO",
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: "#FFFFFF",
            },
          },
          // Nav items
          {
            type: "frame",
            name: "Nav Items",
            w: 420,
            h: 36,
            layout: {
              mode: "flex",
              direction: "row",
              gap: 32,
              alignItems: "center",
              justifyContent: "center",
            },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Nav 1",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "Selected Work", fontSize: 13, fontWeight: 600, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Nav 2",
                w: "fit",
                h: "fit",
                style: { fill: "#94A3B8" },
                text: { content: "Visual Systems", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
              {
                type: "text",
                name: "Nav 3",
                w: "fit",
                h: "fit",
                style: { fill: "#94A3B8" },
                text: { content: "Exhibitions", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
              {
                type: "text",
                name: "Nav 4",
                w: "fit",
                h: "fit",
                style: { fill: "#94A3B8" },
                text: { content: "About & Press", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
            ],
          },
          // Header CTA
          {
            type: "frame",
            name: "Header CTA Button",
            w: "fit",
            h: 40,
            layout: {
              mode: "flex",
              direction: "row",
              alignItems: "center",
              justifyContent: "center",
              padding: { top: 8, right: 18, bottom: 8, left: 18 },
            },
            style: {
              fill: "#181A26",
              radius: 999,
              stroke: { color: "#2E334D", width: 1 },
            },
            children: [
              {
                type: "text",
                name: "CTA Label",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "Get in Touch", fontSize: 13, fontWeight: 600, color: "#FFFFFF" },
              },
            ],
          },
        ],
      },

      // 2. Hero Section
      {
        type: "frame",
        name: "Hero Section",
        w: 1280,
        layout: {
          mode: "flex",
          direction: "column",
          gap: 24,
          alignItems: "start",
          padding: { top: 24, right: 0, bottom: 24, left: 0 },
        },
        style: { fill: "transparent" },
        children: [
          // Availability Pill
          {
            type: "frame",
            name: "Availability Badge",
            w: "fit",
            h: 32,
            layout: {
              mode: "flex",
              direction: "row",
              gap: 8,
              alignItems: "center",
              padding: { top: 6, right: 14, bottom: 6, left: 14 },
            },
            style: {
              fill: "#064E3B",
              radius: 999,
              stroke: { color: "#059669", width: 1 },
            },
            children: [
              {
                type: "text",
                name: "Status Text",
                w: "fit",
                h: "fit",
                style: { fill: "#34D399" },
                text: {
                  content: "● AVAILABLE FOR SELECT COMMISSIONS 2026",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: "#34D399",
                },
              },
            ],
          },
          // Large Hero Headline
          {
            type: "text",
            name: "Hero Headline",
            w: 1040,
            h: "fit",
            style: { fill: "#FFFFFF" },
            text: {
              content: "Visual Identity, Typography & Art Direction.",
              fontSize: 56,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -1,
              color: "#FFFFFF",
            },
          },
          // Subtitle
          {
            type: "text",
            name: "Hero Subtitle",
            w: 780,
            h: "fit",
            style: { fill: "#94A3B8" },
            text: {
              content:
                "Independent graphic designer and art director crafting distinctive brand systems, bespoke typography, and avant-garde editorial publications for cultural institutions and progressive technology companies worldwide.",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.6,
              color: "#94A3B8",
            },
          },
          // Buttons Row
          {
            type: "frame",
            name: "Buttons Row",
            w: 440,
            h: 50,
            layout: {
              mode: "flex",
              direction: "row",
              gap: 16,
              alignItems: "center",
            },
            style: { fill: "transparent" },
            children: [
              {
                type: "frame",
                name: "Primary Button",
                w: "fit",
                h: 46,
                layout: {
                  mode: "flex",
                  direction: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: { top: 12, right: 24, bottom: 12, left: 24 },
                },
                style: { fill: "#FFFFFF", radius: 8 },
                children: [
                  {
                    type: "text",
                    name: "Btn Text 1",
                    w: "fit",
                    h: "fit",
                    style: { fill: "#0A0B10" },
                    text: {
                      content: "Explore Selected Works ↓",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#0A0B10",
                    },
                  },
                ],
              },
              {
                type: "frame",
                name: "Secondary Button",
                w: "fit",
                h: 46,
                layout: {
                  mode: "flex",
                  direction: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: { top: 12, right: 22, bottom: 12, left: 22 },
                },
                style: {
                  fill: "#151724",
                  radius: 8,
                  stroke: { color: "#2B2F45", width: 1 },
                },
                children: [
                  {
                    type: "text",
                    name: "Btn Text 2",
                    w: "fit",
                    h: "fit",
                    style: { fill: "#E2E8F0" },
                    text: {
                      content: "Studio Archive (PDF)",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#E2E8F0",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },

      // 3. Stats Strip
      {
        type: "frame",
        name: "Stats Bar",
        w: 1280,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "center",
          padding: { top: 28, right: 40, bottom: 28, left: 40 },
        },
        style: {
          fill: "#11131E",
          radius: 16,
          stroke: { color: "#1E2235", width: 1 },
        },
        children: [
          {
            type: "frame",
            name: "Stat 1",
            w: 220,
            layout: { mode: "flex", direction: "column", gap: 4, alignItems: "start" },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Num 1",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "14+", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Lbl 1",
                w: "fit",
                h: "fit",
                style: { fill: "#64748B" },
                text: { content: "Years of Practice", fontSize: 13, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 2",
            w: 220,
            layout: { mode: "flex", direction: "column", gap: 4, alignItems: "start" },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Num 2",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "60+", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Lbl 2",
                w: "fit",
                h: "fit",
                style: { fill: "#64748B" },
                text: { content: "Brand Identities Built", fontSize: 13, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 3",
            w: 220,
            layout: { mode: "flex", direction: "column", gap: 4, alignItems: "start" },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Num 3",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "11", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Lbl 3",
                w: "fit",
                h: "fit",
                style: { fill: "#64748B" },
                text: { content: "TDC & D&AD Awards", fontSize: 13, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 4",
            w: 220,
            layout: { mode: "flex", direction: "column", gap: 4, alignItems: "start" },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Num 4",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "100%", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Lbl 4",
                w: "fit",
                h: "fit",
                style: { fill: "#64748B" },
                text: { content: "Independent Ownership", fontSize: 13, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
        ],
      },

      // 4. Section Header
      {
        type: "frame",
        name: "Projects Header",
        w: 1280,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        style: { fill: "transparent" },
        children: [
          {
            type: "text",
            name: "Sec Title",
            w: "fit",
            h: "fit",
            style: { fill: "#64748B" },
            text: { content: "SELECTED RECENT COMMISSIONS", fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#64748B" },
          },
          {
            type: "text",
            name: "Index Link",
            w: "fit",
            h: "fit",
            style: { fill: "#38BDF8" },
            text: { content: "Index of All Projects (34) →", fontSize: 13, fontWeight: 600, color: "#38BDF8" },
          },
        ],
      },

      // 5. Featured Projects Grid (2 Cards side by side)
      {
        type: "frame",
        name: "Projects Grid",
        w: 1280,
        layout: {
          mode: "flex",
          direction: "row",
          gap: 24,
          alignItems: "stretch",
        },
        style: { fill: "transparent" },
        children: [
          // Card 1: Lumina Spatial Audio
          {
            type: "frame",
            name: "Card - Lumina",
            w: 628,
            layout: {
              mode: "flex",
              direction: "column",
              gap: 20,
              padding: { top: 32, right: 32, bottom: 32, left: 32 },
            },
            style: {
              fill: "#131024",
              radius: 16,
              stroke: { color: "#2B2356", width: 1 },
            },
            children: [
              {
                type: "text",
                name: "Tag 1",
                w: "fit",
                h: "fit",
                style: { fill: "#A5B4FC" },
                text: { content: "2026 — BRAND IDENTITY / CUSTOM TYPE", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#A5B4FC" },
              },
              {
                type: "text",
                name: "Title 1",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "Lumina Spatial Audio", fontSize: 28, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "frame",
                name: "Art Mockup 1",
                w: 564,
                h: 220,
                layout: {
                  mode: "flex",
                  direction: "row",
                  justifyContent: "center",
                  alignItems: "center",
                },
                style: {
                  fill: "#22194D",
                  radius: 12,
                  stroke: { color: "#4338CA", width: 1 },
                },
                children: [
                  {
                    type: "text",
                    name: "Art 1",
                    w: "fit",
                    h: "fit",
                    style: { fill: "#C7D2FE" },
                    text: { content: "✦ LUMINA 360°", fontSize: 24, fontWeight: 900, letterSpacing: 3, color: "#C7D2FE" },
                  },
                ],
              },
              {
                type: "text",
                name: "Desc 1",
                w: 564,
                h: "fit",
                style: { fill: "#94A3B8" },
                text: { content: "Generative audio brand system and dynamic variable typeface designed for high-fidelity spatial hardware.", fontSize: 14, fontWeight: 400, lineHeight: 1.5, color: "#94A3B8" },
              },
            ],
          },

          // Card 2: Velox Kinetic Architecture
          {
            type: "frame",
            name: "Card - Velox",
            w: 628,
            layout: {
              mode: "flex",
              direction: "column",
              gap: 20,
              padding: { top: 32, right: 32, bottom: 32, left: 32 },
            },
            style: {
              fill: "#0B1D28",
              radius: 16,
              stroke: { color: "#164E63", width: 1 },
            },
            children: [
              {
                type: "text",
                name: "Tag 2",
                w: "fit",
                h: "fit",
                style: { fill: "#67E8F9" },
                text: { content: "2025 — EDITORIAL / EXHIBITION CATALOG", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#67E8F9" },
              },
              {
                type: "text",
                name: "Title 2",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "Velox Kinetic Architecture", fontSize: 28, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "frame",
                name: "Art Mockup 2",
                w: 564,
                h: 220,
                layout: {
                  mode: "flex",
                  direction: "row",
                  justifyContent: "center",
                  alignItems: "center",
                },
                style: {
                  fill: "#103348",
                  radius: 12,
                  stroke: { color: "#0E7490", width: 1 },
                },
                children: [
                  {
                    type: "text",
                    name: "Art 2",
                    w: "fit",
                    h: "fit",
                    style: { fill: "#A5F3FC" },
                    text: { content: "▲ MONOGRAPH V", fontSize: 24, fontWeight: 900, letterSpacing: 4, color: "#A5F3FC" },
                  },
                ],
              },
              {
                type: "text",
                name: "Desc 2",
                w: 564,
                h: "fit",
                style: { fill: "#94A3B8" },
                text: { content: "380-page dual-foil stamped monograph celebrating parametric pavilion engineering and kinetic forms in Zurich.", fontSize: 14, fontWeight: 400, lineHeight: 1.5, color: "#94A3B8" },
              },
            ],
          },
        ],
      },

      // 6. Commission Banner
      {
        type: "frame",
        name: "Commission Banner",
        w: 1280,
        layout: {
          mode: "flex",
          direction: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
          padding: { top: 48, right: 48, bottom: 48, left: 48 },
        },
        style: {
          fill: "#131624",
          radius: 20,
          stroke: { color: "#252B44", width: 1 },
        },
        children: [
          {
            type: "text",
            name: "Banner Subtitle",
            w: "fit",
            h: "fit",
            style: { fill: "#38BDF8" },
            text: { content: "READY TO ELEVATE YOUR BRAND?", fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#38BDF8" },
          },
          {
            type: "text",
            name: "Banner Title",
            w: "fit",
            h: "fit",
            style: { fill: "#FFFFFF" },
            text: { content: "Let's craft something unforgettable together.", fontSize: 36, fontWeight: 800, color: "#FFFFFF" },
          },
          {
            type: "frame",
            name: "Email CTA",
            w: "fit",
            h: 48,
            layout: {
              mode: "flex",
              direction: "row",
              justifyContent: "center",
              alignItems: "center",
              padding: { top: 12, right: 28, bottom: 12, left: 28 },
            },
            style: { fill: "#2563EB", radius: 999 },
            children: [
              {
                type: "text",
                name: "Email Text",
                w: "fit",
                h: "fit",
                style: { fill: "#FFFFFF" },
                text: { content: "contact@kamrulhasan.design →", fontSize: 14, fontWeight: 700, color: "#FFFFFF" },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function run() {
  console.log("=== Rebuilding Clean High-Contrast Graphic Designer Portfolio ===");

  const fileId = "file-mw5mdwrk-x0qii";
  const docRes = await callMcp("read_file", { fileId });
  const doc = JSON.parse(docRes.content[0].text);

  // Clear existing nodes and set page 1 as clean target
  const targetPage = doc.pages[0];
  console.log(`Target page: ${targetPage.id} (${targetPage.name})`);

  // Clear previous root nodes from target page
  for (const rid of targetPage.rootNodeIds || []) {
    try {
      await callMcp("delete_node", { fileId, nodeId: rid });
    } catch (_) {}
  }

  // Update page name & dark canvas background
  await callMcp("update_page", {
    fileId,
    pageId: targetPage.id,
    patch: {
      name: "Landing page for portfolio",
      background: "#0A0B10",
    },
  });

  // Create tree cleanly
  const treeSpec = getCleanPortfolioSpec();
  const treeRes = await callMcp("create_tree", {
    fileId,
    pageId: targetPage.id,
    root: treeSpec,
  });

  const treeData = JSON.parse(treeRes.content[0].text);
  console.log(`✓ Tree created cleanly: rootId=${treeData.rootId}, count=${treeData.createdCount}`);
  console.log("=== Done! ===");
}

run().catch(console.error);
