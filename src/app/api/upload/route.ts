import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import {
  contentTypeFor,
  extOf,
  kindOf,
  memoTypeForKind,
} from "@/lib/file-kind";
import {
  maxUploadBytes,
  removeStored,
  writeOriginal,
  writeThumbFromDataUrl,
} from "@/lib/file-store";
import {
  createMemo,
  getNotebook,
  listNotebooks,
} from "@/lib/memo-server";
import { uid } from "@/lib/uid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 파일 업로드 → 파일 메모 생성.
 * DnD(메모함에 그대로 떨어뜨리기) / 붙여넣기(메모함 선택) / 파일 고르기 모두 여기로 온다.
 *
 * 썸네일은 브라우저가 만들어 `thumb_<index>` 필드로 함께 보낸다 (없으면 아이콘 폴백).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "업로드 데이터를 읽지 못했습니다" },
      { status: 400 },
    );
  }

  const notebookId = String(form.get("notebookId") ?? "");
  if (!notebookId || !getNotebook(notebookId)) {
    return NextResponse.json(
      { error: "메모함을 찾을 수 없습니다" },
      { status: 400 },
    );
  }

  const entries = form.getAll("files").filter((v): v is File => v instanceof File);
  if (entries.length === 0) {
    return NextResponse.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  const limit = maxUploadBytes();
  const written: string[] = []; // 실패 시 되돌릴 경로
  const skipped: string[] = [];

  try {
    for (let i = 0; i < entries.length; i++) {
      const file = entries[i];
      const name = (file.name || "untitled").split(/[\\/]/).pop() || "untitled";

      if (file.size > limit) {
        skipped.push(`${name} (용량 초과)`);
        continue;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = uid();
      const ext = extOf(name);
      const kind = kindOf(name);

      const path = await writeOriginal(id, ext, bytes);
      written.push(path);

      const thumbField = form.get(`thumb_${i}`);
      let thumbPath: string | null = null;
      if (typeof thumbField === "string" && thumbField) {
        thumbPath = await writeThumbFromDataUrl(id, thumbField);
        if (thumbPath) written.push(thumbPath);
      }

      db.insert(schema.files)
        .values({
          id,
          name,
          ext,
          mimeType: contentTypeFor(name, file.type),
          size: bytes.byteLength,
          kind,
          path,
          thumbPath,
        })
        .run();

      createMemo({
        notebookId,
        type: memoTypeForKind(kind),
        title: null,
        fileId: id,
      });
    }
  } catch (e) {
    // 부분 실패 시 이번 요청에서 만든 파일은 지운다 (고아 파일 방지)
    await removeStored(...written);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "업로드 실패" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    notebooks: listNotebooks(),
    skipped: skipped.length ? skipped : undefined,
  });
}
