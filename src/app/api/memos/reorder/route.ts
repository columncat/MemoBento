import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { listNotebooks, reorderMemos } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  notebookId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    reorderMemos(parsed.data.notebookId, parsed.data.orderedIds);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "정렬 실패" },
      { status: 400 },
    );
  }
  logAgent(req, "메모 순서 바꾸기", null, { count: parsed.data.orderedIds.length });
  return NextResponse.json({ notebooks: listNotebooks() });
}
