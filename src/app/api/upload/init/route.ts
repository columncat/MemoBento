import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { acceptedTypes, getNotebook } from "@/lib/memo-server";
import { PLAIN_CHUNK, createSession } from "@/lib/upload-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  notebookId: z.string().min(1),
  name: z.string().min(1).max(400),
  size: z.number().int().nonnegative(),
});

/** 청크 업로드 시작 — 조각을 받을 자리를 잡고 uploadId 를 돌려준다. */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { notebookId, name, size } = parsed.data;

  const notebook = getNotebook(notebookId);
  if (!notebook) {
    return NextResponse.json(
      { error: "메모함을 찾을 수 없습니다" },
      { status: 400 },
    );
  }

  const accepted = acceptedTypes(notebook.systemKey ?? null);
  if (!accepted.some((t) => t === "image" || t === "pdf" || t === "file")) {
    return NextResponse.json(
      {
        error: `"${notebook.name}" 메모함에는 파일을 넣을 수 없습니다 (${
          accepted.includes("link") ? "링크" : "텍스트"
        } 전용)`,
      },
      { status: 400 },
    );
  }

  const limit = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (size > limit) {
    return NextResponse.json(
      { error: `파일이 너무 큽니다 (최대 ${env.MAX_UPLOAD_MB}MB)` },
      { status: 413 },
    );
  }

  const session = await createSession({ notebookId, name, size });
  return NextResponse.json({
    uploadId: session.id,
    chunkSize: PLAIN_CHUNK,
    chunks: size === 0 ? 0 : Math.ceil(size / PLAIN_CHUNK),
  });
}
