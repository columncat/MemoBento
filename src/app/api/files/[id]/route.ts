import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { contentTypeFor, cspFor, isInlineSafe } from "@/lib/file-kind";
import { openStored } from "@/lib/file-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 업로드 원본 서빙.
 *   - 기본: 열람용 inline (이미지 / PDF / plaintext)
 *   - ?dl=1: 다운로드(attachment)
 *   - 그 외 확장자: 항상 attachment → 클릭 시 바로 다운로드
 *
 * 업로드된 파일은 신뢰할 수 없는 내용이므로 CSP sandbox + nosniff 로
 * 같은 오리진에서의 스크립트 실행을 막는다.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))
    .get();
  if (!row) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 404 });
  }

  const opened = await openStored(row.path);
  if (!opened) {
    return NextResponse.json(
      { error: "파일 본체를 찾을 수 없습니다" },
      { status: 410 },
    );
  }

  const wantsDownload =
    new URL(req.url).searchParams.get("dl") === "1" || !isInlineSafe(row.name);

  return new Response(opened.body, {
    headers: {
      "Content-Type": contentTypeFor(row.name, row.mimeType),
      "Content-Length": String(opened.size),
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; ${encodeDispositionFilename(row.name)}`,
      "Content-Security-Policy": cspFor(row.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/** RFC 5987 — 한글/공백 파일명이 깨지지 않게 filename* 을 함께 보낸다. */
function encodeDispositionFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
