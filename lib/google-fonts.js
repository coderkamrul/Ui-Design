// Google Fonts Developer API Integration

export const GOOGLE_FONTS_API_KEY = "AIzaSyAL-GmOCWX-xmiOli1c4Z1_JHZhmYBVWqY";
const GOOGLE_FONTS_API_URL = `https://www.googleapis.com/webfonts/v1/webfonts?key=${GOOGLE_FONTS_API_KEY}&sort=popularity`;
const CACHE_STORAGE_KEY = "google_fonts_catalog_v2";

// Top popular Google fonts available immediately without waiting for API response
export const DEFAULT_POPULAR_FONTS = [
  { family: "Handlee", category: "handwriting", variants: ["regular"] },
  { family: "Inter", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Roboto", category: "sans-serif", variants: ["100", "300", "regular", "500", "700", "900"] },
  { family: "Open Sans", category: "sans-serif", variants: ["300", "regular", "500", "600", "700", "800"] },
  { family: "Montserrat", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Poppins", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Lato", category: "sans-serif", variants: ["100", "300", "regular", "700", "900"] },
  { family: "Manrope", category: "sans-serif", variants: ["200", "300", "regular", "500", "600", "700", "800"] },
  { family: "Geist", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Plus Jakarta Sans", category: "sans-serif", variants: ["200", "300", "regular", "500", "600", "700", "800"] },
  { family: "DM Sans", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Outfit", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Oswald", category: "sans-serif", variants: ["200", "300", "regular", "500", "600", "700"] },
  { family: "Raleway", category: "sans-serif", variants: ["100", "200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Space Grotesk", category: "sans-serif", variants: ["300", "regular", "500", "600", "700"] },
  { family: "Playfair Display", category: "serif", variants: ["regular", "500", "600", "700", "800", "900"] },
  { family: "Merriweather", category: "serif", variants: ["300", "regular", "700", "900"] },
  { family: "Lora", category: "serif", variants: ["regular", "500", "600", "700"] },
  { family: "Cinzel", category: "serif", variants: ["regular", "500", "600", "700", "800", "900"] },
  { family: "Bebas Neue", category: "display", variants: ["regular"] },
  { family: "Syne", category: "sans-serif", variants: ["regular", "500", "600", "700", "800"] },
  { family: "JetBrains Mono", category: "monospace", variants: ["100", "200", "300", "regular", "500", "600", "700", "800"] },
  { family: "Fira Code", category: "monospace", variants: ["300", "regular", "500", "600", "700"] },
  { family: "Source Code Pro", category: "monospace", variants: ["200", "300", "regular", "500", "600", "700", "800", "900"] },
  { family: "Caveat", category: "handwriting", variants: ["regular", "500", "600", "700"] },
  { family: "Dancing Script", category: "handwriting", variants: ["regular", "500", "600", "700"] },
  { family: "Pacifico", category: "handwriting", variants: ["regular"] },
  { family: "system-ui", category: "sans-serif", variants: ["regular", "700"] },
  { family: "Arial", category: "sans-serif", variants: ["regular", "700"] },
  { family: "Helvetica", category: "sans-serif", variants: ["regular", "700"] },
  { family: "Georgia", category: "serif", variants: ["regular", "700"] },
  { family: "Times New Roman", category: "serif", variants: ["regular", "700"] },
  { family: "Courier New", category: "monospace", variants: ["regular", "700"] },
];

const loadedFontsSet = new Set();
let inMemoryFontsCache = null;

const WEB_SAFE_FONTS = new Set([
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "arial",
  "helvetica",
  "georgia",
  "times new roman",
  "courier new",
  "verdana",
  "tahoma",
  "trebuchet ms",
]);

/**
 * Extract clean font family names from an HTML string (e.g. from styled spans in rich text).
 * Handles HTML entities like &quot;, escaped quotes, and multiple comma-separated fallbacks.
 */
export function extractFontFamiliesFromHtml(html) {
  if (!html || typeof html !== "string") return [];
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");

  const fonts = [];
  const matches = decoded.matchAll(/font-family:\s*([^;>]+)/gi);
  for (const m of matches) {
    if (m[1]) {
      const firstFont = m[1].split(",")[0].trim().replace(/^['"]+|['"]+$/g, "");
      if (
        firstFont &&
        !WEB_SAFE_FONTS.has(firstFont.toLowerCase()) &&
        !["inherit", "initial"].includes(firstFont.toLowerCase())
      ) {
        fonts.push(firstFont);
      }
    }
  }
  return fonts;
}

/**
 * Dynamically injects a Google Fonts stylesheet link tag into <head>
 * for the requested family and weights.
 */
export function loadGoogleFont(family, variants = null) {
  if (!family || typeof document === "undefined") return;

  // Clean and decode HTML entities or stray quotes
  const clean = family
    .replace(/&quot;/g, "")
    .replace(/&#39;|&apos;/g, "")
    .split(",")[0]
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
  const lower = clean.toLowerCase();

  if (!clean || clean.length < 2) return;
  if (WEB_SAFE_FONTS.has(lower) || lower === "inherit" || lower === "initial") return;
  if (loadedFontsSet.has(clean)) return;

  const fontId = `gfont-${lower.replace(/[^a-z0-9]/g, "-")}`;
  if (document.getElementById(fontId)) {
    loadedFontsSet.add(clean);
    return;
  }

  // Auto-detect variants from popular list or in-memory catalog if not explicitly provided
  let effectiveVariants = variants;
  if (!effectiveVariants) {
    const popular = DEFAULT_POPULAR_FONTS.find((f) => f.family.toLowerCase() === lower);
    if (popular?.variants) {
      effectiveVariants = popular.variants;
    } else if (Array.isArray(inMemoryFontsCache) && inMemoryFontsCache.length > 0) {
      const catItem = inMemoryFontsCache.find((f) => f.family.toLowerCase() === lower);
      if (catItem?.variants) effectiveVariants = catItem.variants;
    }
  }

  try {
    let weightParam = "";
    if (Array.isArray(effectiveVariants) && effectiveVariants.length > 0) {
      const numericWeights = Array.from(
        new Set(
          effectiveVariants
            .map((v) => (v === "regular" ? "400" : String(v).replace("italic", "")))
            .filter((v) => /^\d+$/.test(v))
        )
      ).sort((a, b) => Number(a) - Number(b));

      if (numericWeights.length > 0) {
        weightParam = `:wght@${numericWeights.join(";")}`;
      }
    }

    const link = document.createElement("link");
    link.id = fontId;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${clean.replace(/ /g, "+")}${weightParam}&display=swap`;
    link.onload = () => loadedFontsSet.add(clean);
    link.onerror = () => {
      // Fallback without weight restrictions if specific weights were rejected
      if (weightParam) {
        link.href = `https://fonts.googleapis.com/css2?family=${clean.replace(/ /g, "+")}&display=swap`;
      }
    };
    document.head.appendChild(link);
    loadedFontsSet.add(clean);
  } catch (err) {
    console.error("Failed to load Google font:", family, err);
  }
}

/**
 * Preloads all Google Fonts used across an entire design document (nodes and tokens).
 */
export function preloadDocGoogleFonts(doc) {
  if (!doc || !doc.nodes || typeof document === "undefined") return;

  const fontFamilies = new Set();

  for (const node of Object.values(doc.nodes)) {
    if (node?.type === "text" && node.text) {
      if (node.text.fontFamily) {
        fontFamilies.add(node.text.fontFamily);
      }
      if (node.text.html) {
        const extracted = extractFontFamiliesFromHtml(node.text.html);
        for (const fam of extracted) {
          fontFamilies.add(fam);
        }
      }
    }
  }

  if (doc.tokens?.typography) {
    for (const token of Object.values(doc.tokens.typography)) {
      if (token?.fontFamily) {
        fontFamilies.add(token.fontFamily);
      } else if (token?.value && typeof token.value === "string") {
        fontFamilies.add(token.value);
      }
    }
  }

  for (const family of fontFamilies) {
    loadGoogleFont(family);
  }
}

/**
 * Fetches all Google fonts from the Developer API with caching.
 */
export async function getGoogleFontsCatalog() {
  if (inMemoryFontsCache && inMemoryFontsCache.length > 0) {
    return inMemoryFontsCache;
  }

  // Check localStorage cache
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
          inMemoryFontsCache = parsed.items;
          return inMemoryFontsCache;
        }
      }
    } catch (_) {}
  }

  try {
    const res = await fetch(GOOGLE_FONTS_API_URL);
    if (!res.ok) {
      throw new Error(`Google Fonts API returned ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.items) && data.items.length > 0) {
      // Slim format to keep memory footprint minimal (~180KB total for 1,968 fonts)
      const slim = data.items.map((item) => ({
        family: item.family,
        category: item.category || "sans-serif",
        variants: item.variants || ["regular"],
      }));

      inMemoryFontsCache = slim;
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(
            CACHE_STORAGE_KEY,
            JSON.stringify({ timestamp: Date.now(), items: slim })
          );
        } catch (_) {}
      }
      return slim;
    }
  } catch (err) {
    console.warn("Using default popular Google fonts (offline/fallback):", err);
  }

  inMemoryFontsCache = DEFAULT_POPULAR_FONTS;
  return DEFAULT_POPULAR_FONTS;
}

const loadedEnsureFonts = new Set();

/**
 * Scans an HTML string for all font-family declarations and dynamically loads
 * matching Google Fonts stylesheets with full weight ranges (300-900).
 */
export function ensureFonts(html) {
  if (!html || typeof document === "undefined") return;
  for (const m of html.matchAll(/font-family:\s*([^;"]+)/gi)) {
    const f = m[1].split(",")[0].replace(/["']|&quot;/g, "").trim();
    if (!f || loadedEnsureFonts.has(f) || /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|inherit|initial)$/i.test(f) || /fallback/i.test(f)) continue;
    loadedEnsureFonts.add(f);
    loadGoogleFont(f, ["300", "400", "500", "600", "700", "800", "900"]);
  }
}
