import { NextResponse } from "next/server";
import { z } from "zod";

import { importLegacyState } from "@/lib/legacy-store";
import {
  importNotebooks,
  listNotebooks,
  type BackupPayload,
} from "@/lib/memo-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** MemoBento 백업의 메모함 구조 (없으면 유지). */
  notebooks: z.array(z.any()).optional(),
  /** MailBento / MemoBento 공통 widget 필드 (Corkboard·Memo). */
  widget: z.unknown().optional(),
});

/**
 * 불러오기.
 *   - notebooks 가 있으면 사용자 메모함을 통째로 교체 (시스템 메모함은 유지).
 *   - widget 이 있으면 시스템 메모함 내용(Corkboard/Memo)을 덮어쓴다.
 *     MailBento 백업 JSON 의 widget 필드를 그대로 받을 수 있다.
 */
export async function PUT(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  let imported = 0;
  try {
    if (parsed.data.widget !== undefined) {
      importLegacyState(parsed.data.widget);
    }
    if (parsed.data.notebooks) {
      imported = importNotebooks(
        parsed.data.notebooks as BackupPayload["notebooks"],
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "불러오기 실패" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, imported, notebooks: listNotebooks() });
}
