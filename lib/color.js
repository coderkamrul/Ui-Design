/**
 * Colour conversions (depth-gap batch) — an import-free VIEW layer over
 * the document's colour values. Documents and tokens keep storing hex
 * strings (plus a separate alpha); this module only converts between
 * representations for the Inspector's colour editor (Hex / RGB / HSL /
 * OKLCH modes). Nothing here changes the doc model.
 *
 * OKLCH goes through OKLab with Björn Ottosson's matrices:
 * sRGB → linear sRGB → LMS (cube root) → OKLab → OKLCH, and back.
 * The inverse GAMUT-CLAMPS: out-of-gamut OKLCH colours (high chroma at
 * some hues) have their LINEAR sRGB channels clamped to [0, 1] before
 * gamma encoding, so the result is always a valid sRGB hex — the hue
 * is kept and the chroma effectively reduced to the gamut boundary.
 */

// -- hex <-> rgb -----------------------------------------------------------

/** Parse #rgb / #rrggbb / #rrggbbaa into { r, g, b } (0–255), else null. */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let digits = m[1];
  if (digits.length === 3) {
    digits = digits.split("").map((c) => c + c).join("");
  }
  const n = parseInt(digits.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** { r, g, b } (0–255, clamped + rounded) → "#RRGGBB". */
export function rgbToHex({ r, g, b }) {
  const byte = (v) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

// -- rgb <-> hsl -------------------------------------------------------------

/** { r, g, b } (0–255) → { h: 0–360, s: 0–1, l: 0–1 }. Achromatic → h 0. */
export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

/** { h: 0–360, s: 0–1, l: 0–1 } → { r, g, b } (0–255). */
export function hslToRgb({ h, s, l }) {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  };
}

// -- rgb <-> oklch (via OKLab) -------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** { r, g, b } (0–255) → { l: 0–1, c: ≥0, h: 0–360 }. Achromatic → h 0. */
export function rgbToOklch({ r, g, b }) {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  // linear sRGB → LMS
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  // LMS → OKLab
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  // atan2 of two ~0 values is meaningless; achromatic colours get h 0.
  if (C < 1e-4) H = 0;
  return { l: L, c: C, h: H };
}

/**
 * { l, c, h } → { r, g, b } (0–255). Out-of-gamut results are clamped
 * in linear sRGB (see the module header) — never NaN, never negative.
 */
export function oklchToRgb({ l, c, h }) {
  const hr = ((h % 360) * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L3 = l_ * l_ * l_;
  const M3 = m_ * m_ * m_;
  const S3 = s_ * s_ * s_;
  // OKLab → linear sRGB, gamut-clamped to [0, 1] per channel.
  const R = clamp01(4.0767416621 * L3 - 3.3077115913 * M3 + 0.2309699292 * S3);
  const G = clamp01(-1.2684380046 * L3 + 2.6097574011 * M3 - 0.3413193965 * S3);
  const B = clamp01(-0.0041960863 * L3 - 0.7034186147 * M3 + 1.707614701 * S3);
  return {
    r: Math.round(linearToSrgb(R) * 255),
    g: Math.round(linearToSrgb(G) * 255),
    b: Math.round(linearToSrgb(B) * 255),
  };
}

// -- hex <-> oklch ---------------------------------------------------------

/** "#RRGGBB" → { l, c, h }, or null for a non-hex value. */
export function hexToOklch(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToOklch(rgb) : null;
}

/**
 * { l, c, h } → "#RRGGBB". When `alpha` is given and < 1, the alpha is
 * appended as a byte ("#RRGGBBAA"); the editor itself keeps alpha in
 * the paint's separate field and calls this without it.
 */
export function oklchToHex(oklch, alpha) {
  const hex = rgbToHex(oklchToRgb(oklch));
  if (alpha == null || alpha >= 1) return hex;
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${hex}${byte}`;
}

// -- oklch strings -----------------------------------------------------------

const trimNum = (v, decimals) => String(parseFloat(v.toFixed(decimals)));

/** { l, c, h } → "oklch(0.628 0.2577 29.23)". */
export function formatOklch({ l, c, h }) {
  return `oklch(${trimNum(l, 3)} ${trimNum(c, 4)} ${trimNum(h, 2)})`;
}

/**
 * Parse an "oklch(L C H)" string (L may be a %; an alpha component
 * after "/" is ignored — alpha lives outside the colour in our model).
 * Returns { l, c, h } or null.
 */
export function parseOklch(str) {
  if (typeof str !== "string") return null;
  const m =
    /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/i.exec(
      str.trim(),
    );
  if (!m) return null;
  let l = parseFloat(m[1]);
  if (m[2] === "%") l /= 100;
  const c = parseFloat(m[3]);
  const h = parseFloat(m[4]);
  if (![l, c, h].every(Number.isFinite)) return null;
  return { l, c, h };
}

/**
 * Any stored colour string → { r, g, b } (0–255), or null when the
 * value isn't a representation this module understands (named colours,
 * gradients…). Handles hex and oklch() strings (token literals can be
 * either) plus plain rgb()/rgba() notation.
 */
export function colorToRgb(color) {
  if (typeof color !== "string") return null;
  const hex = hexToRgb(color);
  if (hex) return hex;
  const norm = normalizeCssColor(color);
  if (norm?.hex) return hexToRgb(norm.hex);
  return null;
}

/**
 * Converts any CSS color representation (Hex, RGB, RGBA, OKLab, OKLCH, HSL, HSLA, named colors)
 * into a standard, clean uppercase 6-digit hex string (#RRGGBB) and an alpha float (0–1).
 * Preserves the exact color while converting the code syntax to standard design hex format.
 *
 * @param {string} input - CSS color string
 * @returns {{ hex: string, alpha: number }}
 */
export function normalizeCssColor(input) {
  if (!input || typeof input !== "string") return { hex: "#000000", alpha: 1 };
  const str = input.trim();
  const lower = str.toLowerCase();

  if (lower === "transparent") return { hex: "#000000", alpha: 0 };
  if (lower === "white") return { hex: "#FFFFFF", alpha: 1 };
  if (lower === "black") return { hex: "#000000", alpha: 1 };

  // 1. Standard Hex (#RGB, #RRGGBB, #RGBA, #RRGGBBAA)
  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(str);
  if (hexMatch) {
    let raw = hexMatch[1];
    let alpha = 1;
    if (raw.length === 3) {
      raw = raw.split("").map((c) => c + c).join("");
    } else if (raw.length === 4) {
      alpha = parseInt(raw[3] + raw[3], 16) / 255;
      raw = raw.slice(0, 3).split("").map((c) => c + c).join("");
    } else if (raw.length === 6) {
      // standard #RRGGBB
    } else if (raw.length === 8) {
      alpha = parseInt(raw.slice(6, 8), 16) / 255;
      raw = raw.slice(0, 6);
    }
    return { hex: `#${raw.toUpperCase()}`, alpha: Math.round(alpha * 100) / 100 };
  }

  // 2. rgb(...) / rgba(...) (comma or CSS Color 4 space/slash syntax)
  const rgbMatch = /^rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(lower);
  if (rgbMatch) {
    let r = parseFloat(rgbMatch[1]);
    if (rgbMatch[2] === "%") r = (r * 255) / 100;
    let g = parseFloat(rgbMatch[3]);
    if (rgbMatch[4] === "%") g = (g * 255) / 100;
    let b = parseFloat(rgbMatch[5]);
    if (rgbMatch[6] === "%") b = (b * 255) / 100;
    let a = 1;
    if (rgbMatch[7] != null) {
      a = parseFloat(rgbMatch[7]);
      if (rgbMatch[8] === "%") a = a / 100;
    }
    const byte = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();
    return { hex: `#${byte(r)}${byte(g)}${byte(b)}`, alpha: Math.round(a * 100) / 100 };
  }

  // 3. oklab(L a b / alpha)
  const oklabMatch = /^oklab\(\s*([-\d.eE+]+|none)(%?)\s+([-\d.eE+]+|none)\s+([-\d.eE+]+|none)\s*(?:\/\s*([-\d.eE+]+|none)(%?))?\s*\)$/i.exec(lower);
  if (oklabMatch) {
    let L = oklabMatch[1] === "none" ? 0 : parseFloat(oklabMatch[1]);
    if (oklabMatch[2] === "%") L /= 100;
    const a = oklabMatch[3] === "none" ? 0 : parseFloat(oklabMatch[3]) || 0;
    const b = oklabMatch[4] === "none" ? 0 : parseFloat(oklabMatch[4]) || 0;
    let alpha = 1;
    if (oklabMatch[5] != null && oklabMatch[5] !== "none") {
      alpha = parseFloat(oklabMatch[5]);
      if (oklabMatch[6] === "%") alpha /= 100;
    }
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;
    const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    const R = Math.round(clamp01(toSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3)) * 255);
    const G = Math.round(clamp01(toSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3)) * 255);
    const B = Math.round(clamp01(toSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)) * 255);
    const byte = (v) => v.toString(16).padStart(2, "0").toUpperCase();
    return { hex: `#${byte(R)}${byte(G)}${byte(B)}`, alpha: Math.round(alpha * 100) / 100 };
  }

  // 4. oklch(L C H / alpha)
  const oklchMatch = /^oklch\(\s*([-\d.eE+]+|none)(%?)\s+([-\d.eE+]+|none)\s+([-\d.eE+]+|none)(?:deg)?\s*(?:\/\s*([-\d.eE+]+|none)(%?))?\s*\)$/i.exec(lower);
  if (oklchMatch) {
    let l = oklchMatch[1] === "none" ? 0 : parseFloat(oklchMatch[1]);
    if (oklchMatch[2] === "%") l /= 100;
    const c = oklchMatch[3] === "none" ? 0 : parseFloat(oklchMatch[3]) || 0;
    const h = oklchMatch[4] === "none" ? 0 : parseFloat(oklchMatch[4]) || 0;
    let alpha = 1;
    if (oklchMatch[5] != null && oklchMatch[5] !== "none") {
      alpha = parseFloat(oklchMatch[5]);
      if (oklchMatch[6] === "%") alpha /= 100;
    }
    const hr = ((h % 360) * Math.PI) / 180;
    const a = c * Math.cos(hr);
    const b = c * Math.sin(hr);
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;
    const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    const R = Math.round(clamp01(toSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3)) * 255);
    const G = Math.round(clamp01(toSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3)) * 255);
    const B = Math.round(clamp01(toSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)) * 255);
    const byte = (v) => v.toString(16).padStart(2, "0").toUpperCase();
    return { hex: `#${byte(R)}${byte(G)}${byte(B)}`, alpha: Math.round(alpha * 100) / 100 };
  }

  // 5. Browser Canvas DOM resolution fallback (for display-p3, hsl, system colors, etc.)
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.fillStyle = str;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        const byte = (v) => v.toString(16).padStart(2, "0").toUpperCase();
        return { hex: `#${byte(r)}${byte(g)}${byte(b)}`, alpha: Math.round((a / 255) * 100) / 100 };
      }
    } catch {}
  }

  return { hex: "#000000", alpha: 1 };
}

/**
 * Returns a clean 6-digit hex string without '#' (e.g. "FF8904").
 * @param {string} color
 * @returns {string}
 */
export function toCleanHex(color) {
  const norm = normalizeCssColor(color);
  return norm.hex.replace("#", "").toUpperCase();
}
