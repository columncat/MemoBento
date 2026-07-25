import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { contentTypeFor, extOf, kindOf, memoTypeForKind } from "@/lib/file-kind";
import { removeStored, writeEncryptedThumb } from "@/lib/file-store";
import { createMemo, listNotebooks } from "@/lib/memo-server";
import { PLAIN_CHUNK, discard, finalize, loadSession } from "@/lib/upload-session";
import { uid } from "@/lib/uid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  uploadId: z.string().min(1),
  /**
   * 브라우저가 만들고 **암호화까지 마친** 썸네일 레코드 (base64).
   * 미리보기도 평문으로 남기지 않는다. 없으면 아이콘 폴백.
   */
  thumb: z.string().optional(),
});

/** 조각이 다 도착했으면 실제 파일로 확정하고 메모를 만든다. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const session = await loadSession(parsed.data.uploadId);
  if (!session) {
    return NextResponse.json(
      { error: "업로드 세션을 찾을 수 없습니다" },
      { status: 404 },
    );
  }

  const name = (session.name || "untitled").split(/[\\/]/).pop() || "untitled";
  const ext = extOf(name);
  const kind = kindOf(name);
  const fileId = uid();

  let path: string;
  try {
    ({ path } = await finalize(session, fileId, ext));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "확정 실패" },
      { status: 400 },
    );
  }

  let thumbPath: string | null = null;
  if (parsed.data.thumb) {
    thumbPath = await writeEncryptedThumb(fileId, parsed.data.thumb);
  }

  try {
    db.insert(schema.files)
      .values({
        id: fileId,
        name,
        ext,
        mimeType: contentTypeFor(name),
        size: session.size, // 평문 기준 — 화면에 보이는 크기
        kind,
        path,
        thumbPath,
        encrypted: session.encrypted ? 1 : 0,
        chunkSize: session.encrypted ? PLAIN_CHUNK : 0,
      })
      .run();

    createMemo({
      notebookId: session.notebookId,
      type: memoTypeForKind(kind),
      title: null,
      fileId,
    });
  } catch (e) {
    // 메모를 못 만들면 방금 놓은 파일도 지운다 (고아 방지)
    await removeStored(path, thumbPath);
    db.delete(schema.files).where(eq(schema.files.id, fileId)).run();
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "메모 생성 실패" },
      { status: 400 },
    );
  }

  return NextResponse.json({ notebooks: listNotebooks(), fileId });
}

/** 사용자가 취소한 업로드 정리. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) await discard(id);
  return NextResponse.json({ ok: true });
}
