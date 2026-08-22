import { NextResponse } from "next/server";

import {
  PLAIN_CHUNK,
  currentSize,
  loadSession,
  writeChunk,
} from "@/lib/upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 조각 하나 받기. 본문은 가공하지 않은 바이트 그대로다
 * (암호화했다면 서버는 그 내용을 알 수 없다).
 *
 * 조각 크기가 고정이라 정해진 오프셋에 쓴다 — 순서가 뒤바뀌거나 재시도해도
 * 같은 결과가 된다.
 */
export async function PUT(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const index = Number(url.searchParams.get("index"));

  if (!id || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  const session = await loadSession(id);
  if (!session) {
    return NextResponse.json(
      { error: "업로드 세션을 찾을 수 없습니다 (만료되었을 수 있음)" },
      { status: 404 },
    );
  }

  const buf = new Uint8Array(await req.arrayBuffer());
  const max = PLAIN_CHUNK;
  if (buf.byteLength === 0 || buf.byteLength > max) {
    return NextResponse.json(
      { error: `조각 크기가 잘못되었습니다 (${buf.byteLength} bytes)` },
      { status: 400 },
    );
  }

  await writeChunk(session, index, buf);
  return NextResponse.json({ ok: true, received: await currentSize(id) });
}
