/**
 * Image ingestion (M4) — browser-only (uses Image/canvas), so unlike the
 * pure lib modules this one is never loaded by the node test scripts.
 *
 * Assets live inside the document (`doc.assets` maps asset id → string).
 * In LOCAL MODE that string is a dataURL, which keeps the M3 persistence
 * story intact (the doc JSON already serialises through localStorage) at
 * the cost of the localStorage quota — hence the downscale below.
 *
 * In CONFIGURED MODE (Supabase connected, user signed in) the downscaled
 * image is uploaded to the `assets` storage bucket at
 * `<userId>/<assetId>.<ext>` and the document stores the returned public
 * URL instead. ANY failure along the way (no session, bucket missing,
 * network, …) silently falls back to the dataURL, so intake never breaks.
 */
import { getSupabase, isSupabaseConfigured } from "./supabase";

export const MAX_ASSET_EDGE = 1600;
export const MAX_PLACED_EDGE = 800;

/** Fresh asset id (assets persist inside docs, so no bare counters). */
export function newAssetId() {
  return `asset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image file"));
    img.src = url;
  });
}

/** Scale (w, h) down so the long edge is at most `maxEdge`; never upscale. */
export function capSize(w, h, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Upload a rendered canvas to the Supabase `assets` bucket and return
 * its public URL — or null when storage isn't reachable for any reason
 * (caller falls back to the dataURL). Configured mode only.
 */
async function tryUploadToStorage(id, canvas, isPng) {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data: sessionData } = await sb.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return null;
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, isPng ? "image/png" : "image/jpeg", 0.85),
    );
    if (!blob) return null;
    const path = `${userId}/${id}.${isPng ? "png" : "jpg"}`;
    const { error } = await sb.storage
      .from("assets")
      .upload(path, blob, { contentType: blob.type, upsert: true });
    if (error) return null;
    const { data } = sb.storage.from("assets").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Read a File into a stored asset: decode it, downscale to at most
 * 1600px on the long edge, and re-encode — PNG sources stay PNG (alpha
 * survives), everything else becomes JPEG at quality 0.85.
 *
 * @param {File} file
 * @returns {Promise<{ id: string, dataUrl: string,
 *                     width: number, height: number }>}
 *   `dataUrl` is a dataURL in local mode, or the asset's public storage
 *   URL in configured mode when the upload succeeds.
 *   width/height are the STORED (post-downscale) pixel dimensions.
 */
export async function fileToAsset(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { w, h } = capSize(
      img.naturalWidth,
      img.naturalHeight,
      MAX_ASSET_EDGE,
    );
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const isPng = file.type === "image/png";
    const dataUrl = isPng
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", 0.85);
    const id = newAssetId();
    if (isSupabaseConfigured()) {
      const publicUrl = await tryUploadToStorage(id, canvas, isPng);
      if (publicUrl) return { id, dataUrl: publicUrl, width: w, height: h };
    }
    return { id, dataUrl, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
