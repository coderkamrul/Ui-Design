/**
 * Our starter theme (M2). "Use starter theme" appends these tokens to the
 * file. The GROUP STRUCTURE mirrors the counts recorded in the spec
 * (Phase 1 v2.6: colour ramps, radius ramp, font scale…) because that shape
 * is the product behaviour being reproduced — but every name and value here
 * is our own (hex colours, our ramp hues, our font stacks).
 *
 * Returns fresh { type, name, value } objects (ids are assigned by the
 * store when appending).
 */
export function starterTokens() {
  const tokens = [];
  const add = (type, name, value) => tokens.push({ type, name, value });

  // -- Color: two 11-step ramps (neutral + brand), our own hex values ------
  const neutral = [
    "#FAFAFA", "#F4F4F5", "#E7E7EA", "#D6D6DC", "#B9B9C2", "#8E8E99",
    "#6C6C76", "#52525B", "#3D3D44", "#27272B", "#17171A",
  ];
  const brand = [
    "#EEF3FE", "#DCE7FD", "#B9CFFB", "#8FB0F8", "#6491F4", "#3F74EE",
    "#2B5BD7", "#2348AC", "#1D3A85", "#182D66", "#101E45",
  ];
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  neutral.forEach((hex, i) => add("color", `Neutral / ${steps[i]}`, hex));
  brand.forEach((hex, i) => add("color", `Brand / ${steps[i]}`, hex));

  // -- Radius: 8 ------------------------------------------------------------
  for (const v of [2, 4, 6, 8, 12, 16, 24, 32]) add("radius", `Radius / ${v}`, v);

  // -- Spacing: 8 -------------------------------------------------------------
  for (const v of [4, 8, 12, 16, 24, 32, 48, 64]) {
    add("spacing", `Spacing / ${v}`, v);
  }

  // -- Container: 6 -----------------------------------------------------------
  for (const v of [320, 480, 640, 768, 1024, 1280]) {
    add("container", `Container / ${v}`, v);
  }

  // -- Breakpoint: 5 ----------------------------------------------------------
  for (const v of [640, 768, 1024, 1280, 1536]) {
    add("breakpoint", `Breakpoint / ${v}`, v);
  }

  // -- Font family: 3 generic stacks ------------------------------------------
  add("fontFamily", "Font / Sans", "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
  add("fontFamily", "Font / Serif", "Georgia, 'Times New Roman', serif");
  add("fontFamily", "Font / Mono", "ui-monospace, 'SF Mono', Menlo, Consolas, monospace");

  // -- Font weight: 9 ---------------------------------------------------------
  const weights = [
    [100, "Thin"], [200, "Extra light"], [300, "Light"], [400, "Regular"],
    [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"],
    [900, "Black"],
  ];
  for (const [v, label] of weights) add("fontWeight", `Weight / ${label}`, v);

  // -- Font size: 13 ----------------------------------------------------------
  for (const v of [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72]) {
    add("fontSize", `Text / ${v}`, v);
  }

  // -- Line height: 5 (percent) ------------------------------------------------
  for (const v of [100, 125, 150, 175, 200]) {
    add("lineHeight", `Leading / ${v}%`, v);
  }

  // -- Letter spacing: 6 (percent) ----------------------------------------------
  for (const v of [-5, -2, 0, 2, 5, 10]) {
    add("letterSpacing", `Tracking / ${v}%`, v);
  }

  // -- Opacity: 5 (percent) -------------------------------------------------------
  for (const v of [0, 25, 50, 75, 100]) add("opacity", `Opacity / ${v}%`, v);

  return tokens;
}
