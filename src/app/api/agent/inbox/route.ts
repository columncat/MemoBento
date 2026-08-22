import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { logAgent } from "@/lib/agent-log";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { contentTypeFor, extOf, kindOf, memoTypeForKind } from "@/lib/file-kind";
import { removeStored } from "@/lib/file-store";
import { acceptedTypes, createMemo, getNotebook } from "@/lib/memo-server";
import { PLAIN_CHUNK, createSession, finalize, writeChunk } from "@/lib/upload-session";
import { uid } from "@/lib/uid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 밖에서 들어온 파일을 한 번에 받아 넣는다.
 *
 * 브라우저가 쓰는 `/api/upload/*` 는 세 번에 나눠 부른다. 큰 파일을 올리는 중에
 * 창을 닫아도 이어 갈 수 있게 하려는 것이다.
 *
 * 이 입구는 그 길이 필요 없는 쪽을 위한 것이다. Discord 로 온 첨부와 채팅창에
 * 붙인 파일이 여기로 온다 — 같은 도커 망 안에서 한 번에 보낼 수 있는 크기(25MB
 * 남짓)를 굳이 세 번에 나눠 다룰 이유가 없다.
 *
 * 썸네일은 만들지 않는다. 그건 브라우저가 만드는 것이고(서버에 이미지 처리
 * 의존성을 넣지 않으려는 선택), 없으면 아이콘으로 그려진다.
 */

/** 이 입구로 들어온 것이 기본으로 놓이는 자리. */
const INBOX_NOTEBOOK = "sys-agent-inbox";

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 가 아닙니다" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file 이 없습니다" }, { status: 400 });
  }

  // 이름은 보낸 쪽이 정한다. 경로처럼 생긴 것은 마지막 조각만 남긴다.
  const rawName = (form.get("name") as string | null) || file.name || "untitled";
  const name = rawName.split(/[\\/]/).pop() || "untitled";

  const notebookId = (form.get("notebookId") as string | null) || INBOX_NOTEBOOK;
  const notebook = getNotebook(notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "메모함을 찾을 수 없습니다" }, { status: 400 });
  }
  const accepted = acceptedTypes(notebook.systemKey ?? null, notebook.kind);
  if (!accepted.some((t) => t === "image" || t === "pdf" || t === "file")) {
    return NextResponse.json(
      { error: `"${notebook.name}" 메모함에는 파일을 넣을 수 없습니다` },
      { status: 400 },
    );
  }

  const plain = Buffer.from(await file.arrayBuffer());
  const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (plain.length > limit) {
    return NextResponse.json(
      { error: `파일이 너무 큽니다 (최대 ${env.MAX_UPLOAD_MB}MB)` },
      { status: 413 },
    );
  }

  const session = await createSession({ notebookId, name, size: plain.length });

  const fileId = uid();
  let path: string;
  try {
    // 브라우저가 올리는 것과 같은 조각 크기로 나눈다. 저장된 모양이 같아야
    // 읽는 쪽이 하나로 유지된다.
    const count = plain.length === 0 ? 0 : Math.ceil(plain.length / PLAIN_CHUNK);
    for (let i = 0; i < count; i += 1) {
      await writeChunk(session, i, plain.subarray(i * PLAIN_CHUNK, (i + 1) * PLAIN_CHUNK));
    }
    ({ path } = await finalize(session, fileId, extOf(name)));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 400 },
    );
  }

  const kind = kindOf(name);
  let memoId: string;
  try {
    db.insert(schema.files)
      .values({
        id: fileId,
        name,
        ext: extOf(name),
        mimeType: contentTypeFor(name),
        size: plain.length,
        kind,
        path,
        thumbPath: null,
        encrypted: 0,
        chunkSize: 0,
      })
      .run();

    memoId = createMemo({
      notebookId,
      type: memoTypeForKind(kind),
      title: null,
      fileId,
    });
  } catch (e) {
    // 메모를 못 만들면 방금 놓은 파일도 지운다 (고아 방지)
    await removeStored(path, null);
    db.delete(schema.files).where(eq(schema.files.id, fileId)).run();
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "메모 생성 실패" },
      { status: 400 },
    );
  }

  logAgent(req, "파일 받음", name, { notebookId });

  return NextResponse.json({
    memoId,
    fileId,
    name,
    kind,
    size: plain.length,
    notebookId,
    notebook: notebook.name,
  });
}
