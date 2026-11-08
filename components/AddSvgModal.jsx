"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { PRESET_SVGS, parseSvgToNodes } from "@/lib/svg";
import { useEditorStore } from "@/lib/store";
import * as G from "@/lib/geometry";
import {
  Upload,
  Code,
  Sparkles,
  Search,
  Check,
  X,
  FileCode,
  Layers,
  ArrowRight,
  Eye,
} from "lucide-react";

export default function AddSvgModal({ isOpen, onClose }) {
  const [tab, setTab] = useState("presets"); // "presets" | "upload" | "code"
  const [selectedPresetId, setSelectedPresetId] = useState(PRESET_SVGS[0]?.id || "arrow-right");
  const [customSvgText, setCustomSvgText] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null); // { name, size, svgText }
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [size, setSize] = useState(24);
  const [sizeMode, setSizeMode] = useState("scaled"); // "original" | "scaled"
  const [colorMode, setColorMode] = useState("custom"); // "custom" | "original"
  const [color, setColor] = useState("#18181B");
  const [previewBg, setPreviewBg] = useState("checker"); // "checker" | "light" | "dark"
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const fileInputRef = useRef(null);

  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const viewport = useEditorStore((s) => s.viewport);
  const canvasSize = useEditorStore((s) => s.canvasSize);
  const addSvgTree = useEditorStore((s) => s.addSvgTree);
  const showToast = useEditorStore((s) => s.showToast);

  const handleSelectTab = (newTab) => {
    setTab(newTab);
    if (newTab === "upload" || newTab === "code") {
      setColorMode("original");
      setSizeMode("original");
    } else {
      setColorMode("custom");
      setSizeMode("scaled");
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleInsert();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, tab, selectedPresetId, customSvgText, uploadedFile, size, sizeMode, color, colorMode]);

  // Categories for preset icons
  const categories = useMemo(() => {
    const set = new Set(["all"]);
    PRESET_SVGS.forEach((p) => {
      if (p.category) set.add(p.category.toLowerCase());
    });
    return Array.from(set);
  }, []);

  const filteredPresets = useMemo(() => {
    return PRESET_SVGS.filter((p) => {
      const matchCat =
        activeCategory === "all" ||
        (p.category && p.category.toLowerCase() === activeCategory);
      const matchQuery =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [activeCategory, searchQuery]);

  if (!isOpen) return null;

  // Active raw SVG string based on tab
  const activePreset =
    PRESET_SVGS.find((p) => p.id === selectedPresetId) || PRESET_SVGS[0];
  let rawSvgString = "";
  if (tab === "presets") {
    rawSvgString = activePreset?.svg || "";
  } else if (tab === "upload") {
    rawSvgString = uploadedFile?.svgText || "";
  } else {
    rawSvgString = customSvgText;
  }

  // Prepared SVG string with color override if chosen
  let preparedSvgString = rawSvgString;
  if (colorMode === "custom" && color && preparedSvgString) {
    if (preparedSvgString.includes("currentColor")) {
      preparedSvgString = preparedSvgString.replace(/currentColor/g, color);
    } else {
      // Replace stroke or fill if not none
      preparedSvgString = preparedSvgString
        .replace(/stroke="(?!(?:none|transparent|url))[^"]+"/g, `stroke="${color}"`)
        .replace(/fill="(?!(?:none|transparent|url))[^"]+"/g, `fill="${color}"`);
    }
  }

  // Check if current SVG is valid XML & detect intrinsic bounds
  const validationStatus = (() => {
    if (!rawSvgString.trim()) return { valid: false, message: "No SVG provided" };
    try {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(rawSvgString, "image/svg+xml");
      const parserError = parsedDoc.querySelector("parsererror");
      if (parserError) {
        return { valid: false, message: "Invalid SVG XML markup" };
      }
      const svgEl = parsedDoc.querySelector("svg");
      if (!svgEl) return { valid: false, message: "Missing <svg> root element" };
      const paths = parsedDoc.querySelectorAll("path, polygon, polyline, circle, rect, ellipse, line");

      let vb = svgEl.getAttribute("viewBox");
      let nw = parseFloat(svgEl.getAttribute("width")) || 0;
      let nh = parseFloat(svgEl.getAttribute("height")) || 0;
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
          if (!nw) nw = parts[2];
          if (!nh) nh = parts[3];
        }
      }
      nw = Math.max(1, Math.round(nw || 24));
      nh = Math.max(1, Math.round(nh || 24));
      const ratio = nw / nh;

      return {
        valid: true,
        message: `Valid SVG (${paths.length} vector ${paths.length === 1 ? "element" : "elements"})`,
        pathCount: paths.length,
        viewBox: vb || `0 0 ${nw} ${nh}`,
        naturalW: nw,
        naturalH: nh,
        aspectRatio: ratio,
      };
    } catch {
      return { valid: false, message: "Parse error" };
    }
  })();

  // Destination frame check
  const selectedNode = selection[0] ? doc.nodes[selection[0]] : null;
  const targetParent =
    selectedNode?.type === "frame"
      ? selectedNode
      : selectedNode?.parentId && doc.nodes[selectedNode.parentId]?.type === "frame"
      ? doc.nodes[selectedNode.parentId]
      : null;

  const handleFileUpload = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".svg") && file.type !== "image/svg+xml") {
      showToast({ message: "Please upload a valid .svg file" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        setUploadedFile({
          name: file.name.replace(/\.svg$/i, ""),
          size: `${Math.round(file.size / 1024 * 10) / 10} KB`,
          svgText: text,
        });
        setColorMode("original");
        setSizeMode("original");
        setTab("upload");
        showToast({ message: `Loaded ${file.name}` });
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleInsert = () => {
    if (!preparedSvgString.trim() || !validationStatus.valid) {
      showToast({ message: "Please select or provide a valid SVG graphic" });
      return;
    }

    let targetParentId = targetParent ? targetParent.id : null;
    let targetPos = { x: 0, y: 0 };

    let finalW = size;
    let finalH = size;

    if (tab === "upload" || tab === "code") {
      const nw = validationStatus.naturalW || 24;
      const nh = validationStatus.naturalH || 24;
      const ratio = validationStatus.aspectRatio || (nw / nh);
      if (sizeMode === "original") {
        finalW = nw;
        finalH = nh;
      } else {
        if (ratio >= 1) {
          finalW = size;
          finalH = Math.max(4, Math.round(size / ratio));
        } else {
          finalH = size;
          finalW = Math.max(4, Math.round(size * ratio));
        }
      }
    }

    if (targetParent) {
      targetPos = { x: 16, y: 16 };
    } else {
      const center = G.screenToCanvas(viewport, {
        x: (canvasSize?.w ?? 800) / 2,
        y: (canvasSize?.h ?? 600) / 2,
      });
      targetPos = {
        x: Math.round(center.x - finalW / 2),
        y: Math.round(center.y - finalH / 2),
      };
    }

    const parsed = parseSvgToNodes(
      doc,
      preparedSvgString,
      targetParentId,
      targetPos,
      { w: finalW, h: finalH }
    );

    if (!parsed) {
      showToast({ message: "Could not parse SVG into canvas nodes" });
      return;
    }

    // Set custom name if uploaded file
    if (tab === "upload" && uploadedFile?.name) {
      parsed.svgNode.name = uploadedFile.name;
    } else if (tab === "presets" && activePreset?.name) {
      parsed.svgNode.name = activePreset.name;
    }

    addSvgTree(parsed.svgNode, parsed.pathNodes);
    showToast({
      message: targetParent
        ? `Added vector to ${targetParent.name || "Frame"}`
        : "Added vector graphic to canvas",
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-2xl rounded-2xl bg-[var(--surface-content)] border border-[var(--line)] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100 max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="5.5" width="14" height="14" rx="1.5" />
                <circle cx="3.5" cy="5.5" r="1.2" fill="currentColor" />
                <circle cx="17.5" cy="5.5" r="1.2" fill="currentColor" />
                <circle cx="3.5" cy="19.5" r="1.2" fill="currentColor" />
                <circle cx="17.5" cy="19.5" r="1.2" fill="currentColor" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-1)]">
                Add Vector SVG
              </h2>
              <p className="text-[11px] text-[var(--text-2)]">
                Import SVG files, paste XML markup, or insert curated icons
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab switch header */}
        <div className="flex items-center justify-between px-6 pt-3 border-b border-[var(--line)] bg-[var(--surface-panel)]/50">
          <div className="flex gap-2">
            {[
              { id: "presets", label: "Icon Presets", icon: Sparkles },
              { id: "upload", label: "Upload File", icon: Upload },
              { id: "code", label: "Paste Code", icon: Code },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTab(t.id)}
                  className={`flex items-center gap-2 pb-2.5 px-1 text-xs font-medium border-b-2 transition-all cursor-pointer ${
                    isActive
                      ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                      : "border-transparent text-[var(--text-2)] hover:text-[var(--text-1)]"
                  }`}
                >
                  <Icon size={14} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Validation badge */}
          <div className="pb-2 text-[11px] flex items-center gap-1.5">
            {validationStatus.valid ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-md">
                <Check size={12} strokeWidth={2.5} />
                <span>{validationStatus.message}</span>
              </span>
            ) : (
              <span className="text-[var(--text-2)]">
                {validationStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Modal Main Content (Split view) */}
        <div className="grid grid-cols-1 md:grid-cols-12 min-h-0 flex-1 overflow-hidden">
          
          {/* Left panel: Source selector */}
          <div className="md:col-span-7 p-5 flex flex-col gap-4 border-r border-[var(--line)] overflow-y-auto max-h-[50vh]">
            
            {/* TAB 1: Presets Library */}
            {tab === "presets" && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 flex items-center">
                    <Search size={13} className="absolute left-2.5 text-[var(--text-2)] pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search icons…"
                      className="h-8 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-content)] pl-8 pr-2.5 text-xs text-[var(--text-1)] outline-none focus:border-[var(--accent)] transition-colors"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 text-[var(--text-2)] hover:text-[var(--text-1)]"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Category chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`px-2.5 py-1 rounded-md text-[11px] capitalize whitespace-nowrap transition-colors cursor-pointer ${
                        activeCategory === cat
                          ? "bg-[var(--accent)] text-white font-medium"
                          : "bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Icons Grid */}
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {filteredPresets.map((preset) => {
                    const isChosen = selectedPresetId === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedPresetId(preset.id)}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all cursor-pointer group ${
                          isChosen
                            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] ring-2 ring-[var(--accent)]/20 shadow-xs"
                            : "border-[var(--line)] hover:bg-[var(--surface-hover)] text-[var(--text-1)]"
                        }`}
                      >
                        <div
                          className="w-7 h-7 flex items-center justify-center mb-1.5 transition-transform group-hover:scale-110"
                          dangerouslySetInnerHTML={{ __html: preset.svg }}
                        />
                        <span className="text-[11px] font-medium truncate w-full">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="col-span-4 py-8 text-center text-xs text-[var(--text-2)]">
                      No matching icons found
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Upload File */}
            {tab === "upload" && (
              <div className="flex flex-col gap-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".svg,image/svg+xml"
                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  className="hidden"
                />

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={() => setIsDraggingFile(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all cursor-pointer text-center ${
                    isDraggingFile
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 scale-[0.99]"
                      : "border-[var(--line)] hover:border-[var(--text-2)] hover:bg-[var(--surface-hover)]/40"
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-[var(--surface-hover)] text-[var(--text-2)] flex items-center justify-center mb-3">
                    <Upload size={22} />
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-1)] mb-1">
                    Drag & drop SVG file here
                  </span>
                  <p className="text-[11px] text-[var(--text-2)] mb-3">
                    Supports SVG files exported from Figma, Illustrator, Sketch, or icons
                  </p>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-content)] text-xs font-medium text-[var(--text-1)] shadow-2xs hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    Browse SVG File
                  </button>
                </div>

                {uploadedFile && (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--line)] bg-[var(--surface-hover)]/50">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileCode size={20} className="text-[var(--accent)] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--text-1)] truncate">
                          {uploadedFile.name}.svg
                        </div>
                        <div className="text-[10px] text-[var(--text-2)]">
                          {uploadedFile.size}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadedFile(null)}
                      className="p-1 rounded text-[var(--text-2)] hover:text-red-500 hover:bg-[var(--surface-hover)] transition-colors"
                      title="Remove file"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Paste Code */}
            {tab === "code" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--text-1)]">
                    Paste raw SVG, polygons, or path markup:
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setCustomSvgText(
                        `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <circle cx="50" cy="50" r="40" stroke="currentColor" stroke-width="4" />\n  <path d="M35 50L45 60L65 40" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />\n</svg>`
                      )
                    }
                    className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Load Sample
                  </button>
                </div>

                <div className="relative">
                  <textarea
                    rows={8}
                    value={customSvgText}
                    onChange={(e) => setCustomSvgText(e.target.value)}
                    placeholder='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">\n  <path d="M12 2L2 7l10 5 10-5-10-5z" />\n</svg>'
                    className="w-full rounded-xl border border-[var(--line)] p-3 font-mono text-[11px] text-[var(--text-1)] bg-[var(--surface-content)] outline-none focus:border-[var(--accent)] transition-colors resize-none leading-relaxed"
                    spellCheck={false}
                  />
                  {customSvgText && (
                    <button
                      type="button"
                      onClick={() => setCustomSvgText("")}
                      className="absolute right-2 top-2 p-1 rounded bg-[var(--surface-hover)] text-[var(--text-2)] hover:text-[var(--text-1)] text-[10px]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: Live Preview & Customization */}
          <div className="md:col-span-5 p-5 flex flex-col justify-between gap-4 bg-[var(--surface-panel)]/30">
            <div className="flex flex-col gap-4">
              
              {/* Live Preview Box */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-1)]">Live Preview</span>
                  <div className="flex items-center gap-1 bg-[var(--surface-content)] border border-[var(--line)] rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => setPreviewBg("checker")}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        previewBg === "checker"
                          ? "bg-[var(--surface-hover)] text-[var(--text-1)] font-medium"
                          : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      Grid
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewBg("light")}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        previewBg === "light"
                          ? "bg-[var(--surface-hover)] text-[var(--text-1)] font-medium"
                          : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewBg("dark")}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        previewBg === "dark"
                          ? "bg-[var(--surface-hover)] text-[var(--text-1)] font-medium"
                          : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      Dark
                    </button>
                  </div>
                </div>

                <div
                  className={`w-full h-44 rounded-xl border border-[var(--line)] flex items-center justify-center p-4 relative overflow-hidden transition-colors ${
                    previewBg === "light"
                      ? "bg-white"
                      : previewBg === "dark"
                      ? "bg-[#18181B]"
                      : "bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:12px_12px] bg-slate-50 dark:bg-zinc-950"
                  }`}
                >
                  {validationStatus.valid && preparedSvgString ? (
                    <div
                      className="w-full h-full flex items-center justify-center max-w-[85%] max-h-[85%] [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:h-auto [&>svg]:object-contain drop-shadow-xs select-none"
                      dangerouslySetInnerHTML={{ __html: preparedSvgString }}
                    />
                  ) : (
                    <span className="text-xs text-[var(--text-2)]">No preview available</span>
                  )}

                  {validationStatus.valid && (
                    <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[10px] font-mono text-[var(--text-2)] pointer-events-none">
                      <span className="bg-[var(--surface-content)]/85 backdrop-blur-xs px-1.5 py-0.5 rounded border border-[var(--line)]/50">
                        {validationStatus.naturalW}×{validationStatus.naturalH} px
                      </span>
                      <span className="bg-[var(--surface-content)]/85 backdrop-blur-xs px-1.5 py-0.5 rounded border border-[var(--line)]/50">
                        Target: {tab === "upload" || tab === "code" ? (sizeMode === "original" ? `${validationStatus.naturalW}×${validationStatus.naturalH}` : `${size} px (proportional)`) : `${size}×${size} px`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Size selector */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-1)]">Size</span>
                  {(tab === "upload" || tab === "code") && validationStatus.valid && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setSizeMode("original")}
                        className={`cursor-pointer ${
                          sizeMode === "original"
                            ? "text-[var(--accent)] font-medium"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                        }`}
                      >
                        Original
                      </button>
                      <span className="text-[var(--text-2)]">·</span>
                      <button
                        type="button"
                        onClick={() => setSizeMode("scaled")}
                        className={`cursor-pointer ${
                          sizeMode === "scaled"
                            ? "text-[var(--accent)] font-medium"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                        }`}
                      >
                        Scale
                      </button>
                    </div>
                  )}
                  {tab === "presets" && (
                    <span className="font-mono text-[11px] text-[var(--text-2)]">{size} px</span>
                  )}
                </div>

                {sizeMode === "original" && (tab === "upload" || tab === "code") ? (
                  <div className="text-[11px] text-[var(--text-2)] bg-[var(--surface-content)] px-3 py-1.5 rounded-lg border border-[var(--line)] flex items-center justify-between">
                    <span>Natural dimensions</span>
                    <span className="font-mono text-[var(--text-1)] font-medium">
                      {validationStatus.naturalW} × {validationStatus.naturalH} px
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[16, 20, 24, 32, 48, 64, 128].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setSize(s);
                          setSizeMode("scaled");
                        }}
                        className={`px-2 py-1 text-xs rounded-lg border font-mono transition-colors cursor-pointer ${
                          size === s && sizeMode === "scaled"
                            ? "border-[var(--accent)] bg-[var(--accent)] text-white font-medium shadow-2xs"
                            : "border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-1)] hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={4}
                      max={1200}
                      value={size}
                      onChange={(e) => {
                        setSize(Math.max(4, Number(e.target.value)));
                        setSizeMode("scaled");
                      }}
                      className="w-14 h-7 text-xs font-mono text-center rounded-lg border border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-1)] outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Color styling */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-1)]">Fill / Stroke Color</span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setColorMode("custom")}
                      className={`cursor-pointer ${
                        colorMode === "custom"
                          ? "text-[var(--accent)] font-medium"
                          : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      Tint
                    </button>
                    <span className="text-[var(--text-2)]">·</span>
                    <button
                      type="button"
                      onClick={() => setColorMode("original")}
                      className={`cursor-pointer ${
                        colorMode === "original"
                          ? "text-[var(--accent)] font-medium"
                          : "text-[var(--text-2)] hover:text-[var(--text-1)]"
                      }`}
                    >
                      Original
                    </button>
                  </div>
                </div>

                {colorMode === "custom" && (
                  <div className="flex items-center gap-2">
                    {[
                      { hex: "#18181B", label: "Dark" },
                      { hex: "#FFFFFF", label: "White" },
                      { hex: "#3B82F6", label: "Blue" },
                      { hex: "#10B981", label: "Green" },
                      { hex: "#8B5CF6", label: "Purple" },
                      { hex: "#F59E0B", label: "Amber" },
                      { hex: "#EF4444", label: "Red" },
                    ].map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setColor(c.hex)}
                        title={c.label}
                        className={`w-5 h-5 rounded-full border border-black/15 transition-transform cursor-pointer ${
                          color === c.hex ? "scale-125 ring-2 ring-[var(--accent)]" : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                    <div className="flex items-center gap-1 ml-auto">
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="w-20 h-7 text-xs font-mono uppercase text-center rounded-lg border border-[var(--line)] bg-[var(--surface-content)] text-[var(--text-1)] outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Target placement feedback card */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[var(--surface-hover)] border border-[var(--line)] text-xs text-[var(--text-2)]">
              <Layers size={14} className="text-[var(--accent)] shrink-0" />
              <span className="truncate">
                {targetParent ? (
                  <>Target: <strong>{targetParent.name || "Frame"}</strong></>
                ) : (
                  <>Target: <strong>Center of Canvas</strong></>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-[var(--surface-panel)] border-t border-[var(--line)]">
          <div className="text-[11px] text-[var(--text-2)] hidden sm:block">
            Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-hover)] border border-[var(--line)] font-mono text-[10px]">Ctrl+Enter</kbd> to insert
          </div>
          
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-xl text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={!validationStatus.valid}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:opacity-90 shadow-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              <span>Insert Vector</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
