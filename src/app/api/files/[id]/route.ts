import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { contentTypeFor, cspFor, isInlineSafe } from "@/lib/file-kind";
import { openStored, parseRange } from "@/lib/file-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 저장된 바이트 서빙.
 *
 * 암호화된 파일이면 **암호문 그대로** 내보낸다 — 복호화는 서비스 워커가
 * 브라우저 안에서 한다. 서버도 Cloudflare 도 평문을 보지 못한다.
 * 복호화에 필요한 정보(레코드 크기·원래 타입·파일명)는 X-MB-* 헤더로 알린다.
 *
 * Range 를 지원하므로 큰 파일도 이어받기·탐색이 가능하다.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  if (!row) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 404 });
  }

  const encrypted = row.encrypted === 1;
  const realType = contentTypeFor(row.name, row.mimeType);
  const wantsDownload =
    new URL(req.url).searchParams.get("dl") === "1" || !isInlineSafe(row.name);

  // 크기를 먼저 알아야 Range 를 계산할 수 있다
  const probe = await openStored(row.path);
  if (!probe) {
    return NextResponse.json(
      { error: "파일 본체를 찾을 수 없습니다" },
      { status: 410 },
    );
  }
  probe.body.cancel().catch(() => undefined);

  const range = parseRange(req.headers.get("range"), probe.totalSize);
  const opened = await openStored(row.path, range);
  if (!opened) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${probe.totalSize}` },
    });
  }

  const headers: Record<string, string> = {
    // 암호문은 브라우저가 해석하면 안 된다 — 실제 타입은 X-MB-Type 으로 전달
    "Content-Type": encrypted ? "application/octet-stream" : realType,
    "Content-Length": String(opened.size),
    "Accept-Ranges": "bytes",
    "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; ${encodeDispositionFilename(row.name)}`,
    "Content-Security-Policy": cspFor(row.name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-MB-Encrypted": encrypted ? "1" : "0",
    "X-MB-Chunk-Size": String(row.chunkSize),
    "X-MB-Plain-Size": String(row.size),
    "X-MB-Type": realType,
    "X-MB-Name": encodeURIComponent(row.name),
  };
  if (opened.range) {
    headers["Content-Range"] =
      `bytes ${opened.range.start}-${opened.range.end}/${opened.totalSize}`;
  }

  return new Response(opened.body, {
    status: opened.range ? 206 : 200,
    headers,
  });
}

/** RFC 5987 — 한글/공백 파일명이 깨지지 않게 filename* 을 함께 보낸다. */
function encodeDispositionFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
