"use client";

/**
 * AI Create panels (platform batch) — the toolbar's "Create SVG" and
 * "Create image" buttons and their shared prompt panel.
 *
 * ⚠️ HONEST LABELLING: generation is PROCEDURAL (lib/ai.js) — a seeded
 * composition engine that runs entirely in this browser. No external
 * AI model is called, no prompt leaves the machine. The panel says so
 * in plain text ("Procedural generation — runs locally, no external
 * AI model"). The README documents the future provider hook (an
 * AI_IMAGE_API_URL env var the panel would POST the prompt to); that
 * network call is deliberately NOT implemented here.
 *
 * Flows:
 * - Create SVG: generateSvg(prompt, size) → the SVG becomes an asset
 *   (data:image/svg+xml;utf8 URL) + an image node at the page centre,
 *   ONE history commit (addNode), node named from the prompt.
 * - Create image: the SAME generated SVG is rasterised in-browser
 *   (SVG → Image via blob URL → canvas → PNG dataURL, downscale-capped
 *   like M4 image intake) and inserted the same way. If rasterisation
 *   fails in some browser, the SVG itself is inserted instead — the
 *   motif logic lives in exactly one place (lib/ai.js) either way.
 *
 * Plan gate (lib/plans.js): Free gets aiPerDay generations/day
 * (counter at localStorage canvastool:ai-usage); at the cap the panel
 * shows the upgrade prompt instead of generating.
 */
import { useState } from "react";
import { createNode, useEditorStore } from "@/lib/store";
import * as G from "@/lib/geometry";
import { generateSvg, promptPalette } from "@/lib/ai";
import { MAX_ASSET_EDGE, MAX_PLACED_EDGE, capSize, newAssetId } from "@/lib/images";
import { aiGenerationsLeft, planOf, recordAiUsage } from "@/lib/plans";

const SIZES = [
  { label: "800 × 600", w: 800, h: 600 },
  { label: "1024 × 768", w: 1024, h: 768 },
  { label: "1080 × 1080 (square)", w: 1080, h: 1080 },
  { label: "1200 × 800", w: 1200, h: 800 },
  { label: "1920 × 1080 (HD)", w: 1920, h: 1080 },
];

function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG rasterisation failed"));
    img.src = url;
  });
}

/** Rasterise an SVG string to a PNG dataURL at a capped size. */
async function svgToPng(svg, w, h) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageEl(url);
    const capped = capSize(w, h, MAX_ASSET_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = capped.w;
    canvas.height = capped.h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, capped.w, capped.h);
    return { dataUrl: canvas.toDataURL("image/png"), w: capped.w, h: capped.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Insert an image asset as an image node at the viewport centre —
 * the same placement rules as the Viewport's Place image (page root
 * when the centre lands in a flex frame), as ONE history commit.
 */
function insertGeneratedImage(st, { assetId, w, h, name }) {
  const placed = capSize(w, h, MAX_PLACED_EDGE);
  const centre = G.screenToCanvas(st.viewport, {
    x: st.canvasSize.w / 2,
    y: st.canvasSize.h / 2,
  });
  const rect = {
    x: Math.round(centre.x - placed.w / 2),
    y: Math.round(centre.y - placed.h / 2),
    w: placed.w,
    h: placed.h,
  };
  const pg = st.doc.pages.find((p) => p.id === st.activePageId);
  let parentId = G.findFrameAtPoint(st.doc.nodes, pg, centre);
  if (parentId && st.doc.nodes[parentId]?.layout?.mode === "flex") {
    parentId = null;
  }
  const node = createNode(st.doc, "image", rect, parentId);
  node.name = name;
  node.image = { assetId, fit: "cover" };
  st.addNode(node);
  st.setActiveTool("move");
}

export function AiPanel({ mode: initialMode = "svg", onClose }) {
  const [mode, setMode] = useState(initialMode);
  const planId = useEditorStore((s) => s.planId);
  const [prompt, setPrompt] = useState("");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(() => aiGenerationsLeft(planId));
  const plan = planOf(planId);
  const size = SIZES[sizeIdx];
  const palette = promptPalette(prompt);
  const atCap = left <= 0;

  const generate = async () => {
    const st = useEditorStore.getState();
    if (st.previewVersionId || busy) return;
    if (aiGenerationsLeft(st.planId) <= 0) {
      setLeft(0);
      return;
    }
    setBusy(true);
    try {
      const svg = generateSvg(prompt, { w: size.w, h: size.h });
      const name = (prompt.trim() || "Generated image").slice(0, 40);
      const assetId = newAssetId();
      if (mode === "svg") {
        st.addAsset({
          id: assetId,
          dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
        });
        insertGeneratedImage(st, { assetId, w: size.w, h: size.h, name });
      } else {
        try {
          const png = await svgToPng(svg, size.w, size.h);
          st.addAsset({ id: assetId, dataUrl: png.dataUrl });
          insertGeneratedImage(st, { assetId, w: png.w, h: png.h, name });
        } catch {
          // Rasterisation unsupported here — insert the SVG itself
          // rather than failing the generation outright.
          st.addAsset({
            id: assetId,
            dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          });
          insertGeneratedImage(st, { assetId, w: size.w, h: size.h, name });
          st.showToast({
            message: "PNG conversion wasn't available — inserted the SVG instead",
          });
        }
      }
      recordAiUsage();
      setLeft(aiGenerationsLeft(useEditorStore.getState().planId));
      onClose();
    } catch (err) {
      useEditorStore
        .getState()
        .showToast({ message: `Generation failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-2 py-1.5 outline-none focus:border-[var(--accent-focus)]";

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="fixed top-1/2 z-40 w-[300px] max-w-[calc(100%-24px)] -translate-y-1/2 rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface-content)] p-3 shadow-xl"
        style={{ left: "calc(var(--layout-toolbar-w) + 12px)" }}
        data-ai="panel"
        data-ai-mode={mode}
      >
        <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-[var(--text-1)]">Create with AI</span>
            <div className="flex items-center rounded-md bg-[var(--surface-hover)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("svg")}
                className={`px-2 py-0.5 rounded transition-all ${
                  mode === "svg"
                    ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-xs font-medium"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
              >
                SVG
              </button>
              <button
                type="button"
                onClick={() => setMode("image")}
                className={`px-2 py-0.5 rounded transition-all ${
                  mode === "image"
                    ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-xs font-medium"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                }`}
              >
                PNG
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
            title="Close"
          >
            ✕
          </button>
        </div>

        <p className="mt-1 text-[var(--type-micro)] text-[var(--text-2)]">
          Procedural generation — runs locally, no external AI model.
          Describe a scene; keywords pick the palette and motif.
        </p>

        <input
          autoFocus
          className={`${inputCls} mt-2`}
          placeholder="e.g. sunset over mountain ridges"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") generate();
            if (e.key === "Escape") onClose();
          }}
        />

        <div className="mt-2 flex items-center gap-2">
          <span
            className="flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]"
            title={`Palette: ${palette.name}`}
          >
            {palette.stops.map((c) => (
              <span
                key={c}
                className="h-3.5 w-3.5"
                style={{ background: c }}
              />
            ))}
            <span
              className="h-3.5 w-3.5"
              style={{ background: palette.accent }}
            />
          </span>
          <span className="text-[var(--type-micro)] text-[var(--text-2)]">
            {palette.name}
          </span>
          <div className="flex-1" />
          <select
            className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-content)] px-1 py-1 text-[var(--type-label)] outline-none"
            value={sizeIdx}
            onChange={(e) => setSizeIdx(Number(e.target.value))}
            title="Output size"
          >
            {SIZES.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {atCap ? (
          <div className="mt-3 rounded-[var(--radius-md)] px-3 py-2" style={{ background: "var(--surface-hover)" }}>
            <p className="text-[var(--type-label)]">
              You&apos;ve used today&apos;s {plan.aiPerDay} free generations.
              Pro removes the cap.
            </p>
            <button
              className="mt-2 rounded-[var(--radius-md)] px-3 py-1.5 font-medium"
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
              }}
              onClick={() => {
                onClose();
                useEditorStore.getState().setUpgradeDialogOpen(true);
              }}
            >
              Upgrade to Pro
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={generate}
              disabled={busy}
              className="mt-3 h-8 w-full rounded-[var(--radius-lg)] font-medium disabled:opacity-40"
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
              }}
            >
              {busy ? "Generating…" : "Generate"}
            </button>
            <p className="mt-1.5 text-center text-[var(--type-micro)] text-[var(--text-2)]">
              {Number.isFinite(left)
                ? `${left} of ${plan.aiPerDay} free generations left today`
                : "Unlimited generations on Pro"}
            </p>
          </>
        )}
      </div>
    </>
  );
}

/**
 * AI Create toolbar button (icon 10 from VerticalToolBar) + shared prompt panel.
 * Rendered inside ToolButtons, so it appears in both the docked
 * toolbar and the hide-UI floating pill.
 */
export default function AiCreateButtons() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative group">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            open
              ? "bg-[var(--surface-content)] text-[var(--text-1)] shadow-xs border border-[var(--line)]"
              : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
          }`}
          title="Create SVG with AI (⌥V)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5.5" width="14" height="14" rx="1.5" />
            <circle cx="3.5" cy="5.5" r="1.2" fill="currentColor" />
            <circle cx="17.5" cy="5.5" r="1.2" fill="currentColor" />
            <circle cx="3.5" cy="19.5" r="1.2" fill="currentColor" />
            <circle cx="17.5" cy="19.5" r="1.2" fill="currentColor" />
            <path d="M19.5 1.5v4M17.5 3.5h4" strokeWidth="1.8" />
          </svg>
        </button>
        <div className="absolute left-10 top-1/2 -translate-y-1/2 bg-[var(--surface-content)] text-[var(--text-1)] border border-[var(--line)] px-2.5 py-1 rounded-md text-xs whitespace-nowrap shadow-md pointer-events-none z-50 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span>Create SVG (AI)</span>
          <span className="text-[var(--text-2)] font-mono text-[10px]">⌥V</span>
        </div>
      </div>
      {open && <AiPanel onClose={() => setOpen(false)} />}
    </>
  );
}
