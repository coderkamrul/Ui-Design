/**
 * Professional Rich Text Engine for Antigravity Designer (Figma / Notion / Docs style)
 * 
 * Guarantees:
 * 1. Flat hierarchy: NEVER creates nested <span> inside <span>.
 * 2. Style merging: If text inside a span is formatted again, styles are cleanly combined into one single span.
 * 3. Pruning: Completely removes empty spans (<span ...></span> with no text).
 * 4. Merging: Combines adjacent sibling spans that have identical styles.
 * 5. Clean unwrapping: When styles are removed, spans without styles are unwrapped into plain text.
 */

/** Parse inline style string into a key-value map. */
export function parseStyleString(styleStr) {
  const map = {};
  if (!styleStr || typeof styleStr !== "string") return map;
  const parts = styleStr.split(";");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).trim().toLowerCase();
      const val = part.slice(colonIdx + 1).trim();
      if (key && val) {
        map[key] = val;
      }
    }
  }
  return map;
}

/** Serialize key-value map into a clean inline style string. */
export function serializeStyleMap(styleMap) {
  const keys = Object.keys(styleMap || {}).sort();
  const entries = [];
  for (const k of keys) {
    const val = styleMap[k];
    if (val && val !== "normal" && val !== "none" && val !== "initial") {
      entries.push(`${k}: ${val}`);
    }
  }
  return entries.join("; ");
}

/** Normalize raw HTML string into clean, flat, professional rich text HTML. */
export function cleanAndNormalizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== "string") return "";
  
  // Quick check: if no tags, return trimmed text
  if (!/<[a-z][\s\S]*>/i.test(rawHtml)) {
    return rawHtml;
  }

  // Browser / DOM environment
  if (typeof document !== "undefined") {
    const temp = document.createElement("div");
    temp.innerHTML = rawHtml;
    normalizeElement(temp);
    
    // Check if any styled spans remain
    const spans = temp.querySelectorAll("span");
    let hasStyledSpan = false;
    for (const span of spans) {
      const st = span.getAttribute("style");
      if (st && st.trim().length > 0) {
        hasStyledSpan = true;
        break;
      }
    }
    
    if (!hasStyledSpan) {
      // Preserve line breaks (<br> and <div>) when extracting plain text
      const htmlWithBr = temp.innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/div>\s*<div>/gi, "\n")
        .replace(/<div>/gi, "\n")
        .replace(/<\/div>/gi, "");
      const d = document.createElement("div");
      d.innerHTML = htmlWithBr;
      return d.textContent || "";
    }
    return temp.innerHTML.trim();
  }

  // Node.js fallback (regex-based cleaner for tests/SSR)
  return regexCleanHtml(rawHtml);
}

/** In-place DOM normalizer on an element */
export function normalizeElement(rootEl) {
  if (!rootEl) return;

  // 1. Remove empty spans (<span ...></span> with zero text content)
  let changed = true;
  while (changed) {
    changed = false;
    const spans = rootEl.querySelectorAll("span");
    for (const span of spans) {
      if (!span.textContent || span.textContent.length === 0) {
        span.remove();
        changed = true;
      }
    }
  }

  // 2. Flatten nested spans: <span style="A"><span style="B">text</span></span>
  // -> <span style="combined(A, B)">text</span>
  changed = true;
  while (changed) {
    changed = false;
    const spans = rootEl.querySelectorAll("span");
    for (const span of spans) {
      const childSpans = Array.from(span.children).filter((c) => c.tagName === "SPAN");
      if (childSpans.length > 0) {
        const parentStyles = parseStyleString(span.getAttribute("style"));
        for (const child of childSpans) {
          const childStyles = parseStyleString(child.getAttribute("style"));
          const merged = { ...parentStyles, ...childStyles };
          child.setAttribute("style", serializeStyleMap(merged));
        }
        // If span only contained child spans, unwrap span
        const nonSpanNodes = Array.from(span.childNodes).filter((n) => n.nodeType !== 1 || n.tagName !== "SPAN");
        const hasTextOutside = nonSpanNodes.some((n) => n.textContent && n.textContent.trim().length > 0);
        if (!hasTextOutside) {
          while (span.firstChild) {
            span.parentNode.insertBefore(span.firstChild, span);
          }
          span.remove();
          changed = true;
          break;
        }
      }
    }
  }

  // 3. Unwrap spans with no styles or empty style attributes
  const allSpans = Array.from(rootEl.querySelectorAll("span"));
  for (const span of allSpans) {
    const styleAttr = span.getAttribute("style");
    const styleMap = parseStyleString(styleAttr);
    const serialized = serializeStyleMap(styleMap);
    if (!serialized) {
      span.replaceWith(...Array.from(span.childNodes));
    } else {
      span.setAttribute("style", serialized);
    }
  }

  // 4. Merge adjacent sibling spans that share identical style attributes
  changed = true;
  while (changed) {
    changed = false;
    const spans = Array.from(rootEl.querySelectorAll("span"));
    for (const span of spans) {
      const next = span.nextSibling;
      if (next && next.nodeType === 1 && next.tagName === "SPAN") {
        const style1 = span.getAttribute("style") || "";
        const style2 = next.getAttribute("style") || "";
        if (style1 === style2) {
          while (next.firstChild) {
            span.appendChild(next.firstChild);
          }
          next.remove();
          changed = true;
          break;
        }
      }
    }
  }

  // 5. Unwrap accidental block elements (<div>, <p>) to prevent unwanted newlines / multi-line breaks
  const blocks = Array.from(rootEl.querySelectorAll("div, p"));
  for (const block of blocks) {
    if (block === rootEl) continue;
    while (block.firstChild) {
      block.parentNode.insertBefore(block.firstChild, block);
    }
    block.remove();
  }

  // 6. Merge adjacent text nodes
  rootEl.normalize();
}

/** Regex-based cleaner for Node.js / non-browser environments */
function regexCleanHtml(html) {
  let str = html;
  // Remove empty spans
  str = str.replace(/<span[^>]*>\s*<\/span>/gi, "");
  // Flatten simple nested spans: <span style="styleA"><span style="styleB">text</span></span>
  const nestedSpanRegex = /<span\s+style="([^"]*)"\s*><span\s+style="([^"]*)"\s*>([\s\S]*?)<\/span><\/span>/gi;
  while (nestedSpanRegex.test(str)) {
    str = str.replace(nestedSpanRegex, (_, styleA, styleB, content) => {
      const mapA = parseStyleString(styleA);
      const mapB = parseStyleString(styleB);
      const merged = serializeStyleMap({ ...mapA, ...mapB });
      return `<span style="${merged}">${content}</span>`;
    });
  }
  return str.trim();
}

/**
 * Apply styles directly to a Range within a root editable element without creating nested spans.
 */
export function applyStyleToRange(rootEl, range, stylePatch) {
  if (!rootEl || !range || range.collapsed) return null;

  const doc = rootEl.ownerDocument || document;
  const selText = range.toString();
  if (!selText) return null;

  // Check if range is fully inside an existing span
  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentElement;
  
  if (container && container.tagName === "SPAN" && rootEl.contains(container)) {
    // Modify styles on existing span directly
    const currentStyles = parseStyleString(container.getAttribute("style"));
    updateStyleMapWithPatch(currentStyles, stylePatch);
    const serialized = serializeStyleMap(currentStyles);
    
    if (container.textContent === selText) {
      // Exactly selected this span
      let targetNode = container;
      if (serialized) {
        container.setAttribute("style", serialized);
      } else {
        const textNode = doc.createTextNode(container.textContent);
        container.replaceWith(textNode);
        targetNode = textNode;
      }
      normalizeElement(rootEl);
      if (targetNode && targetNode.isConnected) {
        const newRange = doc.createRange();
        newRange.selectNodeContents(targetNode);
        const winSel = doc.defaultView?.getSelection?.();
        if (winSel) {
          winSel.removeAllRanges();
          winSel.addRange(newRange);
        }
        return newRange;
      }
      return null;
    }
  }

  // General case: extract contents, flatten any internal spans, wrap in one clean span
  const fragment = range.extractContents();
  const tempDiv = doc.createElement("div");
  tempDiv.appendChild(fragment);

  // Extract all text and any existing styles inside the fragment
  const childSpans = tempDiv.querySelectorAll("span");
  let combinedStyles = {};
  if (childSpans.length > 0) {
    for (const cs of childSpans) {
      Object.assign(combinedStyles, parseStyleString(cs.getAttribute("style")));
    }
  }
  updateStyleMapWithPatch(combinedStyles, stylePatch);
  const serialized = serializeStyleMap(combinedStyles);

  const plainText = tempDiv.textContent;
  let targetNode = null;
  if (serialized) {
    const newSpan = doc.createElement("span");
    newSpan.setAttribute("style", serialized);
    newSpan.textContent = plainText;
    range.insertNode(newSpan);
    targetNode = newSpan;
  } else {
    const textNode = doc.createTextNode(plainText);
    range.insertNode(textNode);
    targetNode = textNode;
  }

  normalizeElement(rootEl);

  if (targetNode && targetNode.isConnected) {
    const newRange = doc.createRange();
    newRange.selectNodeContents(targetNode);
    const winSel = doc.defaultView?.getSelection?.();
    if (winSel) {
      winSel.removeAllRanges();
      winSel.addRange(newRange);
    }
    return newRange;
  }
  return null;
}

function updateStyleMapWithPatch(styleMap, stylePatch) {
  if (stylePatch.fontWeight !== undefined) {
    if (stylePatch.fontWeight === "normal" || stylePatch.fontWeight === "" || stylePatch.fontWeight === 400) {
      delete styleMap["font-weight"];
    } else {
      styleMap["font-weight"] = String(stylePatch.fontWeight);
    }
  }
  if (stylePatch.fontStyle !== undefined) {
    if (stylePatch.fontStyle === "normal" || stylePatch.fontStyle === "") {
      delete styleMap["font-style"];
    } else {
      styleMap["font-style"] = stylePatch.fontStyle;
    }
  }
  if (stylePatch.textDecoration !== undefined) {
    if (stylePatch.textDecoration === "none" || stylePatch.textDecoration === "") {
      delete styleMap["text-decoration"];
    } else {
      styleMap["text-decoration"] = stylePatch.textDecoration;
    }
  }
  if (stylePatch.color !== undefined) {
    if (!stylePatch.color) {
      delete styleMap["color"];
    } else {
      styleMap["color"] = stylePatch.color;
    }
  }
  if (stylePatch.fontFamily !== undefined) {
    if (!stylePatch.fontFamily) {
      delete styleMap["font-family"];
    } else {
      styleMap["font-family"] = `"${stylePatch.fontFamily}", sans-serif`;
    }
  }
}
