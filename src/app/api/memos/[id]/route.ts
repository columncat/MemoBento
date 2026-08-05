import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteMemo, listNotebooks, updateMemo } from "@/lib/memo-server";
import { MEMO_COLORS } from "@/lib/db/schema";
import { normalizeUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  text: z.string().max(20000).optional(),
  title: z.string().max(200).optional(),
  /** null 또는 빈 문자열이면 링크 해제. */
  url: z.string().trim().nullable().optional(),
  done: z.boolean().optional(),
  /** null 이면 기한 해제. */
  dueAt: z.number().int().nullable().optional(),
  /** 반복 규칙. 서버에서 정규화하므로 형태는 느슨하게 받는다. null 이면 해제. */
  recurrence: z.unknown().optional(),
  /** 글자 색. 팔레트 밖의 값은 거절한다 — 그대로 CSS 변수 이름이 된다. */
  color: z.enum(MEMO_COLORS).nullable().optional(),
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
    if (!patch.url) {
      // 빈 값은 해제 의도다. 예전엔 400 이라 한 번 붙인 링크를 뗄 수 없었다.
      patch.url = null;
    } else {
      const url = normalizeUrl(patch.url);
      if (!url) {
        return NextResponse.json(
          { error: "올바른 URL 이 아닙니다" },
          { status: 400 },
        );
      }
      patch.url = url;
    }
  }

  const beforeLabel = memoLabelOf(id);
  try {
    updateMemo(id, patch);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: 400 },
    );
  }
  logAgent(req, "메모 고치기", beforeLabel, patch);
  return NextResponse.json({ notebooks: listNotebooks() });
}

/** 기록에 쓸 사람이 읽는 이름. 지운 뒤에도 남게 미리 뜬다. */
function memoLabelOf(id: string): string {
  for (const nb of listNotebooks()) {
    const m = nb.memos.find((x) => x.id === id);
    if (m) {
      const label = m.title ?? m.text ?? m.url ?? m.file?.name ?? id;
      return `${nb.name} / ${label.slice(0, 80)}`;
    }
  }
  return id;
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const label = memoLabelOf(id);
  try {
    deleteMemo(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: 400 },
    );
  }
  logAgent(req, "메모 지우기 (휴지통)", label);
  return NextResponse.json({ notebooks: listNotebooks() });
}
