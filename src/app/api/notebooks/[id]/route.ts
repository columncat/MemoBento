import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { VIEW_MODES } from "@/lib/db/schema";
import {
  NotebookLockedError,
  deleteNotebook,
  listNotebooks,
  updateNotebook,
} from "@/lib/memo-server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  viewMode: z.enum(VIEW_MODES).optional(),
  /** 접기 — 화면에서만 가린다. 서버는 내용을 그대로 내려보낸다. */
  hidden: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const before = listNotebooks().find((n) => n.id === id);
  try {
    updateNotebook(id, parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: e instanceof NotebookLockedError ? 403 : 400 },
    );
  }
  logAgent(req, "메모함 고치기", before?.name ?? id, parsed.data);
  return NextResponse.json({ notebooks: listNotebooks() });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = listNotebooks().find((n) => n.id === id);
  try {
    deleteNotebook(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: e instanceof NotebookLockedError ? 403 : 400 },
    );
  }
  logAgent(req, "메모함 지우기 (휴지통)", target?.name ?? id, {
    memos: target?.memos.length ?? 0,
  });
  return NextResponse.json({ notebooks: listNotebooks() });
}
