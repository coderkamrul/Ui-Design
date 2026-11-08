// scripts/build-portfolio-mcp.mjs
// Builds a full high-end graphic designer portfolio landing page via MCP

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
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.error) {
    throw new Error(`MCP RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

function getPortfolioTreeSpec() {
  return {
    type: "frame",
    name: "Portfolio - Graphic Designer",
    x: 100,
    y: 100,
    w: 1440,
    h: 2400,
    layout: {
      mode: "flex",
      direction: "column",
      gap: 56,
      padding: { top: 48, right: 64, bottom: 64, left: 64 },
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
        w: 1312,
        h: 60,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        style: { fill: "transparent" },
        children: [
          // Brand Monogram
          {
            type: "text",
            name: "Brand Logo",
            text: {
              content: "KAMRUL HASAN / STUDIO",
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: "#FFFFFF",
            },
          },
          // Nav Links Group
          {
            type: "frame",
            name: "Nav Links",
            w: 480,
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
                name: "Nav Item 1",
                text: { content: "Selected Work", fontSize: 13, fontWeight: 500, color: "#E2E8F0" },
              },
              {
                type: "text",
                name: "Nav Item 2",
                text: { content: "Visual Systems", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
              {
                type: "text",
                name: "Nav Item 3",
                text: { content: "Exhibitions", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
              {
                type: "text",
                name: "Nav Item 4",
                text: { content: "About & Press", fontSize: 13, fontWeight: 500, color: "#94A3B8" },
              },
            ],
          },
          // Header CTA Button
          {
            type: "frame",
            name: "Contact Button",
            w: 140,
            h: 42,
            layout: {
              mode: "flex",
              direction: "row",
              justifyContent: "center",
              alignItems: "center",
            },
            style: {
              fill: "#181A24",
              radius: 999,
              stroke: { color: "#2E334D", width: 1 },
            },
            children: [
              {
                type: "text",
                name: "Btn Text",
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
        w: 1312,
        h: 440,
        layout: {
          mode: "flex",
          direction: "column",
          gap: 24,
          alignItems: "flex-start",
          justifyContent: "center",
          padding: { top: 40, right: 0, bottom: 40, left: 0 },
        },
        style: { fill: "transparent" },
        children: [
          // Availability Pill
          {
            type: "frame",
            name: "Availability Badge",
            w: 270,
            h: 32,
            layout: {
              mode: "flex",
              direction: "row",
              gap: 8,
              alignItems: "center",
              padding: { top: 0, right: 14, bottom: 0, left: 14 },
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
                text: {
                  content: "● AVAILABLE FOR COMMISSIONS 2026",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: "#34D399",
                },
              },
            ],
          },
          // Big Headline
          {
            type: "text",
            name: "Hero Title",
            w: 1100,
            h: 170,
            text: {
              content: "Visual Identity, Typography & Editorial Direction.",
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.12,
              letterSpacing: -1.5,
              color: "#F8FAFC",
            },
          },
          // Subtitle
          {
            type: "text",
            name: "Hero Subtitle",
            w: 780,
            h: 56,
            text: {
              content:
                "Independent graphic designer and art director specializing in distinctive brand identities, bespoke typography, and avant-garde editorial publications for global cultural institutions.",
              fontSize: 17,
              fontWeight: 400,
              lineHeight: 1.55,
              color: "#94A3B8",
            },
          },
          // Buttons Row
          {
            type: "frame",
            name: "Hero Actions",
            w: 420,
            h: 52,
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
                name: "Primary CTA",
                w: 190,
                h: 48,
                layout: {
                  mode: "flex",
                  direction: "row",
                  justifyContent: "center",
                  alignItems: "center",
                },
                style: { fill: "#FFFFFF", radius: 8 },
                children: [
                  {
                    type: "text",
                    name: "CTA Text",
                    text: {
                      content: "View Selected Work ↓",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#0A0B10",
                    },
                  },
                ],
              },
              {
                type: "frame",
                name: "Secondary CTA",
                w: 170,
                h: 48,
                layout: {
                  mode: "flex",
                  direction: "row",
                  justifyContent: "center",
                  alignItems: "center",
                },
                style: {
                  fill: "#151722",
                  radius: 8,
                  stroke: { color: "#2B2F42", width: 1 },
                },
                children: [
                  {
                    type: "text",
                    name: "CTA Text 2",
                    text: {
                      content: "Studio Archive",
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
        w: 1312,
        h: 110,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "center",
          padding: { top: 24, right: 36, bottom: 24, left: 36 },
        },
        style: {
          fill: "#11131B",
          radius: 16,
          stroke: { color: "#1E2232", width: 1 },
        },
        children: [
          {
            type: "frame",
            name: "Stat 1",
            w: 220,
            h: 60,
            layout: { mode: "flex", direction: "column", gap: 4 },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Number",
                text: { content: "14+", fontSize: 30, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Label",
                text: { content: "Years of Practice", fontSize: 12, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 2",
            w: 220,
            h: 60,
            layout: { mode: "flex", direction: "column", gap: 4 },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Number",
                text: { content: "60+", fontSize: 30, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Label",
                text: { content: "Brand Identities Delivered", fontSize: 12, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 3",
            w: 220,
            h: 60,
            layout: { mode: "flex", direction: "column", gap: 4 },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Number",
                text: { content: "11", fontSize: 30, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Label",
                text: { content: "TDC & D&AD Awards", fontSize: 12, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
          {
            type: "frame",
            name: "Stat 4",
            w: 220,
            h: 60,
            layout: { mode: "flex", direction: "column", gap: 4 },
            style: { fill: "transparent" },
            children: [
              {
                type: "text",
                name: "Number",
                text: { content: "100%", fontSize: 30, fontWeight: 800, color: "#FFFFFF" },
              },
              {
                type: "text",
                name: "Label",
                text: { content: "Creative Ownership", fontSize: 12, fontWeight: 500, color: "#64748B" },
              },
            ],
          },
        ],
      },

      // 4. Featured Projects Header
      {
        type: "frame",
        name: "Projects Header",
        w: 1312,
        h: 40,
        layout: {
          mode: "flex",
          direction: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        },
        style: { fill: "transparent" },
        children: [
          {
            type: "text",
            name: "Section Title",
            text: { content: "SELECTED RECENT COMMISSIONS", fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#64748B" },
          },
          {
            type: "text",
            name: "View All Link",
            text: { content: "Index of All Projects (34) →", fontSize: 13, fontWeight: 600, color: "#3B82F6" },
          },
        ],
      },

      // 5. Featured Projects Grid (2x2 cards)
      {
        type: "frame",
        name: "Projects Grid Row 1",
        w: 1312,
        h: 460,
        layout: {
          mode: "flex",
          direction: "row",
          gap: 24,
          alignItems: "stretch",
        },
        style: { fill: "transparent" },
        children: [
          // Project Card 1: Lumina Sound
          {
            type: "frame",
            name: "Project Card - Lumina",
            w: 644,
            h: 460,
            layout: {
              mode: "flex",
              direction: "column",
              justifyContent: "space-between",
              padding: { top: 32, right: 32, bottom: 32, left: 32 },
            },
            style: {
              fill: "#15102A",
              radius: 16,
              stroke: { color: "#312E81", width: 1 },
            },
            children: [
              {
                type: "frame",
                name: "Card Top",
                w: 580,
                h: 80,
                layout: { mode: "flex", direction: "column", gap: 6 },
                style: { fill: "transparent" },
                children: [
                  {
                    type: "text",
                    name: "Project Year",
                    text: { content: "2026 — BRAND IDENTITY / CUSTOM TYPE", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#A5B4FC" },
                  },
                  {
                    type: "text",
                    name: "Project Title",
                    text: { content: "Lumina Spatial Audio", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
                  },
                ],
              },
              {
                type: "frame",
                name: "Card Mockup Frame",
                w: 580,
                h: 220,
                layout: {
                  mode: "flex",
                  direction: "column",
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
                    name: "Art Mark",
                    text: { content: "✦ LUMINA 360°", fontSize: 24, fontWeight: 900, letterSpacing: 3, color: "#C7D2FE" },
                  },
                ],
              },
              {
                type: "text",
                name: "Description",
                text: { content: "Generative audio brand system and dynamic typeface for high-fidelity spatial hardware.", fontSize: 13, fontWeight: 400, color: "#94A3B8" },
              },
            ],
          },

          // Project Card 2: Velox Architecture
          {
            type: "frame",
            name: "Project Card - Velox",
            w: 644,
            h: 460,
            layout: {
              mode: "flex",
              direction: "column",
              justifyContent: "space-between",
              padding: { top: 32, right: 32, bottom: 32, left: 32 },
            },
            style: {
              fill: "#0B1D28",
              radius: 16,
              stroke: { color: "#164E63", width: 1 },
            },
            children: [
              {
                type: "frame",
                name: "Card Top",
                w: 580,
                h: 80,
                layout: { mode: "flex", direction: "column", gap: 6 },
                style: { fill: "transparent" },
                children: [
                  {
                    type: "text",
                    name: "Project Year",
                    text: { content: "2025 — EDITORIAL / EXHIBITION CATALOG", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "#67E8F9" },
                  },
                  {
                    type: "text",
                    name: "Project Title",
                    text: { content: "Velox Kinetic Architecture", fontSize: 32, fontWeight: 800, color: "#FFFFFF" },
                  },
                ],
              },
              {
                type: "frame",
                name: "Card Mockup Frame",
                w: 580,
                h: 220,
                layout: {
                  mode: "flex",
                  direction: "column",
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
                    name: "Art Mark",
                    text: { content: "▲ MONOGRAPH V", fontSize: 24, fontWeight: 900, letterSpacing: 4, color: "#A5F3FC" },
                  },
                ],
              },
              {
                type: "text",
                name: "Description",
                text: { content: "380-page dual-foil stamped monograph celebrating parametric pavilion engineering in Zurich.", fontSize: 13, fontWeight: 400, color: "#94A3B8" },
              },
            ],
          },
        ],
      },

      // 6. Contact & Commission Banner
      {
        type: "frame",
        name: "Commission Banner",
        w: 1312,
        h: 280,
        layout: {
          mode: "flex",
          direction: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
          padding: { top: 48, right: 48, bottom: 48, left: 48 },
        },
        style: {
          fill: "#131622",
          radius: 20,
          stroke: { color: "#252B42", width: 1 },
        },
        children: [
          {
            type: "text",
            name: "Banner Subtitle",
            text: { content: "READY TO ELEVATE YOUR BRAND?", fontSize: 12, fontWeight: 700, letterSpacing: 2, color: "#3B82F6" },
          },
          {
            type: "text",
            name: "Banner Title",
            text: { content: "Let's craft something unforgettable together.", fontSize: 38, fontWeight: 800, color: "#FFFFFF" },
          },
          {
            type: "frame",
            name: "Email CTA",
            w: 280,
            h: 48,
            layout: {
              mode: "flex",
              direction: "row",
              justifyContent: "center",
              alignItems: "center",
            },
            style: { fill: "#3B82F6", radius: 999 },
            children: [
              {
                type: "text",
                name: "Email Text",
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
  console.log("=== Building Graphic Designer Portfolio via MCP ===");

  // 1. List files
  const listRes = await callMcp("list_files", {});
  const listData = JSON.parse(listRes.content[0].text);
  console.log("Available files:", listData.files.map((f) => `${f.id} (${f.title})`));

  // We will build the page on BOTH file-landing and file-mw5mdwrk-x0qii so whichever the user checks is populated!
  const targets = [
    { fileId: "file-landing", name: "Landing Page" },
    { fileId: "file-mw5mdwrk-x0qii", name: "New Design Project" },
  ];

  for (const target of targets) {
    try {
      console.log(`\nProcessing target: ${target.fileId} (${target.name})`);

      // List pages
      const pagesRes = await callMcp("list_pages", { fileId: target.fileId });
      const pagesData = JSON.parse(pagesRes.content[0].text);
      console.log(`Pages for ${target.fileId}:`, pagesData.pages.map((p) => p.id));

      // Find or create the Graphic Designer Portfolio page
      let targetPage = pagesData.pages.find((p) =>
        p.name.toLowerCase().includes("portfolio") || p.name.toLowerCase().includes("graphic")
      );

      if (!targetPage) {
        console.log(`Creating page on ${target.fileId} via MCP create_page...`);
        const createPageRes = await callMcp("create_page", {
          fileId: target.fileId,
          name: "Graphic Designer Portfolio",
          background: "#0A0B10",
        });
        const created = JSON.parse(createPageRes.content[0].text);
        targetPage = created.page;
        console.log(`Created page: ${targetPage.id}`);
      } else {
        console.log(`Using existing page: ${targetPage.id} (${targetPage.name})`);
      }

      // Now create the entire landing page tree via MCP create_tree!
      console.log(`Creating full design tree on page ${targetPage.id} via MCP create_tree...`);
      const treeSpec = getPortfolioTreeSpec();
      const treeRes = await callMcp("create_tree", {
        fileId: target.fileId,
        pageId: targetPage.id,
        root: treeSpec,
      });

      const treeResult = JSON.parse(treeRes.content[0].text);
      console.log(`✓ Tree created on ${target.fileId}: rootId=${treeResult.rootId}, createdCount=${treeResult.createdCount}`);
    } catch (err) {
      console.error(`Error on target ${target.fileId}:`, err.message);
    }
  }

  console.log("\n=== Complete! ===");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
