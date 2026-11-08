/**
 * Standalone checks for lib/codegen.js (M3) — run with:
 *   node scripts/codegen-test.mjs
 *
 * Loaded through a data: URL when a direct import fails (same pattern as
 * the other suites: the package has no "type": "module").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

async function load(rel) {
  try {
    return await import(rel);
  } catch {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    return import(`data:text/javascript,${encodeURIComponent(src)}`);
  }
}

const C = await load("../lib/codegen.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// Fixture: a flex row whose gap is token-bound, with a Fixed child, a Fill
// child whose fill is a colour token, and a text child. ----------------------
const doc = {
  tokens: [
    { id: "tok-brand", type: "color", name: "Brand / Primary", value: "#3B82F6" },
    { id: "tok-gap", type: "spacing", name: "Spacing / Section gap", value: 24 },
  ],
  nodes: {
    "frame-flex": {
      id: "frame-flex",
      type: "frame",
      name: "Flex row",
      parentId: null,
      childIds: ["flex-a", "flex-b", "text-1"],
      layout: {
        mode: "flex",
        direction: "row",
        reverse: false,
        wrap: false,
        gap: { tokenId: "tok-gap" },
        padding: { h: 16, v: 16 },
        alignMain: "start",
        alignCross: "start",
      },
      position: { x: 96, y: 440 },
      size: { w: { kind: "fixed", px: 560 }, h: { kind: "fixed", px: 160 } },
      style: { fill: { kind: "solid", color: "#FFFFFF" }, radius: 8 },
    },
    "flex-a": {
      id: "flex-a",
      type: "rect",
      name: "Flex fixed",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 120 }, h: { kind: "fill" } },
      style: { fill: { kind: "solid", color: "#B9CFFB" }, radius: 6 },
    },
    "flex-b": {
      id: "flex-b",
      type: "rect",
      name: "Flex fill",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fill" }, h: { kind: "fixed", px: 96 } },
      style: { fill: { kind: "token", tokenId: "tok-brand" }, radius: 6 },
    },
    "text-1": {
      id: "text-1",
      type: "text",
      name: "Caption",
      parentId: "frame-flex",
      childIds: [],
      layout: { mode: "freeform" },
      position: { x: 0, y: 0 },
      size: { w: { kind: "fixed", px: 200 }, h: { kind: "fit" } },
      style: { fill: { kind: "solid", color: "#1F1F1F" } },
      text: {
        content: "Hello canvas",
        fontSize: 16,
        fontWeight: 600,
        lineHeight: 1.25,
        align: "left",
      },
    },
  },
};
const root = doc.nodes["frame-flex"];

// 1. CSS: token :root block ---------------------------------------------------
check("CSS emits the token :root block", () => {
  const css = C.nodeToCss(root, doc);
  assert.ok(css.includes(":root {"), "missing :root block");
  assert.ok(css.includes("--brand-primary: #3B82F6;"), "missing colour var");
  assert.ok(
    css.includes("--spacing-section-gap: 24px;"),
    "spacing token should be a px value",
  );
});

// 2. CSS: flex props + token references -----------------------------------------
check("CSS emits flex props and var() references", () => {
  const css = C.nodeToCss(root, doc);
  assert.ok(css.includes("display: flex;"));
  assert.ok(css.includes("flex-direction: row;"));
  assert.ok(
    css.includes("gap: var(--spacing-section-gap);"),
    "token-bound gap should emit var()",
  );
  assert.ok(css.includes("padding: 16px 16px;"));
  // the token-bound fill exports as a var() background
  assert.ok(css.includes("background: var(--brand-primary);"));
  // first (only) Fill child takes the remainder
  assert.ok(css.includes("flex: 1 1 0px;"));
  // fixed child exports its basis + cross-axis stretch
  assert.ok(css.includes("flex: 0 0 120px;"));
  assert.ok(css.includes("align-self: stretch;"));
  // text styles travel too
  assert.ok(css.includes("font-size: 16px;"));
  assert.ok(css.includes("color: #1F1F1F;"));
});

// 3. Tailwind: arbitrary-value classes --------------------------------------------
check("Tailwind emits arbitrary-value classes", () => {
  const tw = C.nodeToTailwind(root, doc);
  assert.ok(tw.includes("flex"), "container should be flex");
  assert.ok(tw.includes("flex-row"));
  assert.ok(
    tw.includes("gap-[var(--spacing-section-gap)]"),
    "token gap should be an arbitrary var() class",
  );
  assert.ok(
    tw.includes("bg-[#B9CFFB]"),
    "solid fill should be an arbitrary colour class",
  );
  assert.ok(tw.includes("bg-[var(--brand-primary)]"), "token fill as var()");
  assert.ok(tw.includes("flex-1"), "first Fill child should flex-1");
  assert.ok(tw.includes("basis-[120px]"), "fixed child basis");
  assert.ok(tw.includes("Hello canvas"), "text content included");
});

// 4. React: component name + style values -------------------------------------------
check("React emits a named component with style objects", () => {
  const react = C.nodeToReact(root, doc);
  assert.ok(
    react.includes("export default function FlexRow()"),
    "component should be named after the root node",
  );
  assert.ok(react.includes('display: "flex"'));
  assert.ok(react.includes('flexDirection: "row"'));
  assert.ok(react.includes('gap: "var(--spacing-section-gap)"'));
  assert.ok(react.includes('background: "var(--brand-primary)"'));
  assert.ok(react.includes("fontWeight: 600"), "numeric style values stay numeric");
  assert.ok(react.includes("Hello canvas"));
});

// 5. Standalone HTML with Tailwind CDN ----------------------------------------------
check("Standalone HTML document emits HTML5 with Tailwind CDN and Google Fonts", () => {
  const html = C.nodeToHtmlDocument(root, doc);
  assert.ok(html.includes("<!DOCTYPE html>"), "should have DOCTYPE");
  assert.ok(html.includes("<title>Flex row</title>"), "should include frame title");
  assert.ok(html.includes("https://cdn.tailwindcss.com"), "should include Tailwind CDN");
  assert.ok(html.includes("fonts.googleapis.com"), "should include Google Fonts");
  assert.ok(html.includes('class="'), "should have class attribute instead of className");
  assert.ok(html.includes("Hello canvas"), "should contain text content");
  assert.ok(html.includes(":root {"), "should embed :root design tokens in style block");
  assert.ok(html.includes("--brand-primary: #3B82F6;"), "should include color tokens");
  assert.ok(html.includes("--container-1280: 1280px;"), "should include container-1280 token");
});

// 6. Hidden fill toggle is respected across codegen ----------------------------------
check("Hidden fill toggle suppresses background across all codegen outputs", () => {
  const hiddenFillDoc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      "flex-a": {
        ...doc.nodes["flex-a"],
        style: {
          ...doc.nodes["flex-a"].style,
          fill: { kind: "solid", color: "#B9CFFB", visible: false },
        },
      },
    },
  };
  const tw = C.nodeToTailwind(hiddenFillDoc.nodes["frame-flex"], hiddenFillDoc);
  assert.ok(!tw.includes("bg-[#B9CFFB]"), "hidden fill should not emit bg color class in Tailwind");

  const css = C.nodeToCss(hiddenFillDoc.nodes["frame-flex"], hiddenFillDoc);
  assert.ok(!css.includes("background: #B9CFFB"), "hidden fill should not emit background in CSS");

  const react = C.nodeToReact(hiddenFillDoc.nodes["frame-flex"], hiddenFillDoc);
  assert.ok(!react.includes('"#B9CFFB"'), "hidden fill should not emit background in React");

  const html = C.nodeToHtmlDocument(hiddenFillDoc.nodes["frame-flex"], hiddenFillDoc);
  assert.ok(!html.includes("bg-[#B9CFFB]"), "hidden fill should not emit bg color class in HTML document");
});

// 7. Image fill on rectangle is exported correctly -----------------------------------
check("Rectangle with image fill emits background-image across all codegen outputs", () => {
  const imgDoc = {
    ...doc,
    assets: {
      "asset-pic-1": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
    nodes: {
      ...doc.nodes,
      "flex-a": {
        ...doc.nodes["flex-a"],
        style: {
          ...doc.nodes["flex-a"].style,
          fill: {
            kind: "image",
            assetId: "asset-pic-1",
            fit: "cover",
            visible: true,
          },
        },
      },
    },
  };
  const tw = C.nodeToTailwind(imgDoc.nodes["frame-flex"], imgDoc);
  assert.ok(tw.includes("style={{ backgroundImage: \"url('data:image/png;base64,"), "Tailwind should include image fill url in style prop");
  assert.ok(tw.includes("bg-cover"), "Tailwind should include bg-cover");

  const css = C.nodeToCss(imgDoc.nodes["frame-flex"], imgDoc);
  assert.ok(css.includes("background-image: url('data:image/png;base64,"), "CSS should include background-image url");
  assert.ok(css.includes("background-size: cover;"), "CSS should include background-size cover");

  const react = C.nodeToReact(imgDoc.nodes["frame-flex"], imgDoc);
  assert.ok(react.includes("backgroundImage: \"url('data:image/png;base64,"), "React should include backgroundImage");
  assert.ok(react.includes('backgroundSize: "cover"'), "React should include backgroundSize cover");

  const html = C.nodeToHtmlDocument(imgDoc.nodes["frame-flex"], imgDoc);
  assert.ok(html.includes("background-image: url('data:image/png;base64,"), "HTML doc should include inline background-image");
  assert.ok(html.includes("background-size: cover"), "HTML doc should include inline background-size cover");
});

// 8. Vertical padding and customCss export correctly -----------------------------------
check("Vertical padding (py) and custom CSS emit correctly in codegen", () => {
  const padDoc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      "frame-flex": {
        ...doc.nodes["frame-flex"],
        layout: {
          ...doc.nodes["frame-flex"].layout,
          padding: { l: 12, r: 12, t: 100, b: 100 },
        },
        style: {
          ...doc.nodes["frame-flex"].style,
          customCss: {
            "max-width": { value: "1536px", enabled: true },
            "margin-left": { value: "auto", enabled: true },
          },
        },
      },
    },
  };
  const tw = C.nodeToTailwind(padDoc.nodes["frame-flex"], padDoc);
  assert.ok(tw.includes("px-[12px]"), "Tailwind should include px-[12px]");
  assert.ok(tw.includes("py-[100px]"), "Tailwind should include py-[100px]");
  assert.ok(tw.includes("[max-width:1536px]"), "Tailwind should include custom max-width");
  assert.ok(tw.includes("[margin-left:auto]"), "Tailwind should include custom margin-left");

  const css = C.nodeToCss(padDoc.nodes["frame-flex"], padDoc);
  assert.ok(css.includes("padding: 100px 12px;"), "CSS should emit padding: 100px 12px");
  assert.ok(css.includes("max-width: 1536px;"), "CSS should emit max-width");
  assert.ok(css.includes("margin-left: auto;"), "CSS should emit margin-left");
});

// 9. React / Next.js JSX component export ----------------------------------------------
check("React / Next.js JSX export produces functional component with props", () => {
  const jsx = C.nodeToReactJsx(root, doc);
  assert.ok(jsx.includes('"use client";'), "JSX should include 'use client' by default");
  assert.ok(jsx.includes('export default function FlexRow({ className = "", ...props })'), "JSX should export component with props");
  assert.ok(jsx.includes("className={`relative"), "JSX should spread root className");
  assert.ok(jsx.includes("Hello canvas"), "JSX should include child text content");
});

// 10. React / Next.js TSX component export ---------------------------------------------
check("React / Next.js TSX export produces typed component with interface", () => {
  const tsx = C.nodeToReactTsx(root, doc);
  assert.ok(tsx.includes('"use client";'), "TSX should include 'use client'");
  assert.ok(tsx.includes("export interface FlexRowProps extends React.HTMLAttributes<HTMLDivElement>"), "TSX should define interface");
  assert.ok(tsx.includes("export default function FlexRow({ className = \"\", children, ...props }: FlexRowProps)"), "TSX should type component props");
  assert.ok(tsx.includes("Hello canvas"), "TSX should include child content");
});

// 11. Astro component export -----------------------------------------------------------
check("Astro component export produces frontmatter fence and HTML class attributes", () => {
  const astro = C.nodeToAstro(root, doc);
  assert.ok(astro.includes("---"), "Astro should have frontmatter fence");
  assert.ok(astro.includes("const { class: className = \"\", ...props } = Astro.props;"), "Astro should extract Astro.props");
  assert.ok(astro.includes("class={`relative"), "Astro should use class attribute instead of className");
  assert.ok(astro.includes("Hello canvas"), "Astro should contain text content");
});

// 12. Margin codegen export ------------------------------------------------------------
check("Margin emits correctly in CSS and Tailwind", () => {
  const marginDoc = {
    nodes: {
      "box-margin": {
        id: "box-margin",
        name: "Box Margin",
        type: "rect",
        layout: {
          margin: { t: 24, b: 32, l: 16, r: 16 },
        },
      },
    },
  };
  const tw = C.nodeToTailwind(marginDoc.nodes["box-margin"], marginDoc);
  assert.ok(tw.includes("mt-[24px]"), "Tailwind should include mt-[24px]");
  assert.ok(tw.includes("mb-[32px]"), "Tailwind should include mb-[32px]");
  assert.ok(tw.includes("mx-[16px]"), "Tailwind should include mx-[16px]");

  const css = C.nodeToCss(marginDoc.nodes["box-margin"], marginDoc);
  assert.ok(css.includes("margin: 24px 16px 32px 16px;"), "CSS should emit margin shorthand");
});

// 13. Rich text formatted spans ---------------------------------------------------------
check("Rich text formatted spans emit HTML/JSX and link custom Google Fonts", () => {
  const richDoc = {
    nodes: {
      "txt-rich": {
        id: "txt-rich",
        name: "Rich Text",
        type: "text",
        text: {
          content: "How can i Help You!",
          html: 'How can <span style="font-weight: 700; color: #3F74EE; font-family: \'Lobster Two\', sans-serif">i Help</span> You!',
          fontFamily: "Roboto",
          fontSize: 24,
        },
        childIds: [],
      },
    },
  };
  const html = C.nodeToHtmlDocument(richDoc.nodes["txt-rich"], richDoc);
  assert.ok(html.includes("family=Lobster+Two"), "HTML should detect Lobster Two from child span and link Google Fonts");
  assert.ok(html.includes('<span style="font-weight: 700; color: #3F74EE; font-family: \'Lobster Two\', sans-serif">i Help</span>'), "HTML should render child span markup");

  const jsx = C.nodeToReactJsx(richDoc.nodes["txt-rich"], richDoc);
  assert.ok(jsx.includes("dangerouslySetInnerHTML"), "JSX should render rich text via dangerouslySetInnerHTML");
  assert.ok(jsx.includes("family=Lobster+Two"), "JSX should link Lobster Two from span");
});

// 14. Multi-fill on frame (Solid color + Image fill) ----------------------------
check("Multi-fill on frame preserves solid background and image fill without duplicate classes", () => {
  const multiDoc = {
    tokens: [],
    nodes: {
      "frame-multi": {
        id: "frame-multi",
        name: "Frame 5",
        type: "frame",
        size: { w: { kind: "fixed", px: 636 }, h: { kind: "fixed", px: 800 } },
        style: {
          radius: 16,
          fills: [
            { kind: "solid", color: "#1D3A85", visible: true, blendMode: "hard-light" },
            { kind: "image", fileName: "hero-product-serum.jpg", fit: "cover", visible: true },
          ],
        },
        layout: { mode: "flex", direction: "column", gap: 40, padding: { h: 32, v: 32 } },
        childIds: [],
      },
    },
  };
  const node = multiDoc.nodes["frame-multi"];

  // 1. CSS
  const css = C.nodeToCss(node, multiDoc);
  assert.ok(css.includes("background-color: #1D3A85;"), "CSS should emit solid background-color");
  assert.ok(css.includes("url('./hero-product-serum.jpg')"), "CSS should emit image background-image");
  assert.ok(css.includes("background-size:"), "CSS should emit background-size");

  // 2. Tailwind
  const tw = C.nodeToTailwind(node, multiDoc);
  assert.ok(tw.includes("bg-[#1D3A85]"), "Tailwind should include bg-[#1D3A85]");
  assert.ok(tw.includes("bg-cover"), "Tailwind should include bg-cover");
  // Check no duplicate box-border
  const boxBorderCount = (tw.match(/box-border/g) || []).length;
  assert.equal(boxBorderCount, 1, "box-border should not be duplicated");

  // 3. Standalone HTML
  const html = C.nodeToHtmlDocument(node, multiDoc);
  assert.ok(html.includes("hero-product-serum.jpg"), "HTML should include image fill filename");
  assert.ok(html.includes("bg-[#1D3A85]"), "HTML should include solid background color");

  // 4. JSX
  const jsx = C.nodeToReactJsx(node, multiDoc);
  assert.ok(jsx.includes("hero-product-serum.jpg"), "JSX should include image fill");

  // 5. TSX
  const tsx = C.nodeToReactTsx(node, multiDoc);
  assert.ok(tsx.includes("hero-product-serum.jpg"), "TSX should include image fill");

  // 6. Astro
  const astro = C.nodeToAstro(node, multiDoc);
  assert.ok(astro.includes("hero-product-serum.jpg"), "Astro should include image fill");
});

// 15. Frame 5 fidelity check (Drop shadow, child relative positioning, clean rich text)
check("Frame 5 codegen fidelity: text drop-shadow, relative on child frames, clean flat rich text", () => {
  const userClip = {
    nodes: {
      "node-12": {
        id: "node-12",
        name: "Frame 5",
        type: "frame",
        size: { w: { px: 636, kind: "fixed" }, h: { px: 800, kind: "fixed" } },
        layout: { mode: "flex", direction: "column", gap: 40, alignCross: "center" },
        childIds: ["node-13", "node-14", "node-15"],
      },
      "node-13": {
        id: "node-13",
        name: "Frame 6",
        type: "frame",
        size: { w: { kind: "fill" }, h: { kind: "auto" } },
        layout: { mode: "flex", direction: "row" },
        childIds: ["svg-logo"],
        parentId: "node-12",
      },
      "svg-logo": {
        id: "svg-logo",
        name: "SVG",
        type: "svg",
        size: { w: { px: 100, kind: "fixed" }, h: { px: 25, kind: "fixed" } },
        position: { x: 443, y: 19, absolute: true },
        parentId: "node-13",
      },
      "node-14": {
        id: "node-14",
        name: "Text 4",
        type: "text",
        text: { content: "7k", fontSize: 173, fontWeight: 900 },
        style: {
          fill: { kind: "solid", color: "#FAFAFA" },
          shadow: [{ x: 2, y: 2, blur: 6, alpha: 0.2, color: "#000000" }],
          shadowType: "drop",
        },
        parentId: "node-12",
      },
      "node-15": {
        id: "node-15",
        name: "Text 5",
        type: "text",
        size: { w: { px: 461, kind: "fixed" }, h: { px: 29, kind: "fixed" } },
        text: {
          html: 'A <span style="font-style: italic; color: rgb(40, 43, 49);"></span><span style="color: rgb(231, 202, 250);"><span style="font-style: italic; color: rgb(227, 198, 244);">surprise</span></span> for you in the caption',
          content: "A surprise for you in the caption",
          fontSize: 36,
          fontFamily: "Handlee",
          fontWeight: 700,
        },
        style: {
          fill: { kind: "solid", color: "#FAFAFA" },
          shadow: [{ x: 2, y: 2, blur: 3, alpha: 1, color: "#000000" }],
          shadowType: "drop",
        },
        parentId: "node-12",
      },
    },
  };

  const html = C.nodeToHtmlDocument(userClip.nodes["node-12"], userClip);
  // 1. Text 14 ("7k") must have drop-shadow, NOT rectangular box shadow
  assert.ok(html.includes("drop-shadow"), "Text 4 must use drop-shadow, not box shadow");
  assert.ok(!/(?:^|\s)shadow-\[/.test(html), "Text 4 must NOT use box-shadow");

  // 2. Frame 6 (node-13) must be relative so absolute SVG is positioned inside it
  assert.ok(html.includes("relative"), "Frame 6 must have relative positioning");

  // 3. Rich text must be cleaned: no empty spans, no nested spans
  assert.ok(!html.includes('<span style="font-style: italic; color: rgb(40, 43, 49);"></span>'), "Empty span must be removed");
  assert.ok(!html.includes('<span style="color: rgb(231, 202, 250);"><span'), "Nested spans must be flattened");
  assert.ok(html.includes('<span style="color: rgb(227, 198, 244); font-style: italic">surprise</span>'), "Flat span must be produced");
});

console.log(`\n${passed} codegen checks passed`);
