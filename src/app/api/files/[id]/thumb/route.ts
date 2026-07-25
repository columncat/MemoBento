import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { openStored } from "@/lib/file-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 썸네일 서빙. 없으면 404 → UI 는 파일 아이콘으로 폴백한다. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))
    .get();
  if (!row?.thumbPath) {
    return NextResponse.json({ error: "썸네일 없음" }, { status: 404 });
  }

  const opened = await openStored(row.thumbPath);
  if (!opened) {
    return NextResponse.json({ error: "썸네일 없음" }, { status: 404 });
  }

  const ext = row.thumbPath.split(".").pop()?.toLowerCase();
  const type =
    ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png";

  return new Response(opened.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(opened.size),
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
