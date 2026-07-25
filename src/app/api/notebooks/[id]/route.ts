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
  try {
    updateNotebook(id, parsed.data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: e instanceof NotebookLockedError ? 403 : 400 },
    );
  }
  return NextResponse.json({ notebooks: listNotebooks() });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    deleteNotebook(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: e instanceof NotebookLockedError ? 403 : 400 },
    );
  }
  return NextResponse.json({ notebooks: listNotebooks() });
}
