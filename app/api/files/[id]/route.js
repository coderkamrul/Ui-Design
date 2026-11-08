import { NextResponse } from "next/server";
import { existsSync, unlinkSync } from "fs";
import { filePath, loadDoc, saveDoc } from "@/lib/mcp-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const doc = loadDoc(id);
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const doc = await request.json();
    saveDoc(id, doc);
    return NextResponse.json({ success: true, id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const p = filePath(id);
    if (existsSync(p)) {
      unlinkSync(p);
    }
    return NextResponse.json({ success: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
