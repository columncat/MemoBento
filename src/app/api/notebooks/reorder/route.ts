import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { listNotebooks, reorderNotebooks } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderedIds: z.array(z.string().min(1)),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  reorderNotebooks(parsed.data.orderedIds);
  logAgent(req, "메모함 순서 바꾸기", null, { count: parsed.data.orderedIds.length });
  return NextResponse.json({ notebooks: listNotebooks() });
}
