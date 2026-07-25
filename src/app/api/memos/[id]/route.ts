import { NextResponse } from "next/server";
import { z } from "zod";

import { removeStored } from "@/lib/file-store";
import { deleteMemo, listNotebooks, updateMemo } from "@/lib/memo-server";
import { normalizeUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  text: z.string().max(20000).optional(),
  title: z.string().max(200).optional(),
  url: z.string().trim().optional(),
  notebookId: z.string().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const patch = { ...parsed.data };
  if (patch.url !== undefined) {
    const url = normalizeUrl(patch.url);
    if (!url) {
      return NextResponse.json(
        { error: "올바른 URL 이 아닙니다" },
        { status: 400 },
      );
    }
    patch.url = url;
  }

  try {
    updateMemo(id, patch);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: 400 },
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
    const orphaned = deleteMemo(id);
    await removeStored(...orphaned);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: 400 },
    );
  }
  return NextResponse.json({ notebooks: listNotebooks() });
}
