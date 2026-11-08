import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { FILES_DIR, filePath, saveDoc, loadDoc } from "@/lib/mcp-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    if (!existsSync(FILES_DIR)) {
      return NextResponse.json({ files: [] });
    }

    const entries = readdirSync(FILES_DIR).filter((f) => f.endsWith(".json"));
    const files = [];

    for (const file of entries) {
      try {
        const fullPath = join(FILES_DIR, file);
        const content = JSON.parse(readFileSync(fullPath, "utf8"));
        files.push({
          id: content.id || file.replace(/\.json$/, ""),
          title: content.title || "Untitled",
          updatedAt: content.updatedAt || new Date().toISOString(),
          archived: Boolean(content.archived),
          thumbnail: content.thumbnail || null,
          swatch: "oklch(0.65 0.18 250)",
          isMcp: true,
        });
      } catch (_) {}
    }

    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json({ error: err.message, files: [] }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const doc = await request.json();
    if (!doc || !doc.id) {
      return NextResponse.json({ error: "Missing document or doc.id" }, { status: 400 });
    }
    saveDoc(doc.id, doc);
    return NextResponse.json({ success: true, id: doc.id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
