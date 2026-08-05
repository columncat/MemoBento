import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { listNotebooks } from "@/lib/memo-server";
import { listTrash, purgeOne, restoreFromTrash } from "@/lib/trash";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ trash: listTrash() });
}

const bodySchema = z.object({
  id: z.string().min(1),
  action: z.enum(["restore", "purge"]),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const label = listTrash().find((x) => x.id === parsed.data.id)?.label ?? parsed.data.id;
  try {
    if (parsed.data.action === "restore") {
      restoreFromTrash(parsed.data.id);
    } else {
      await purgeOne(parsed.data.id);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "처리 실패" },
      { status: 400 },
    );
  }
  logAgent(
    req,
    parsed.data.action === "restore" ? "휴지통에서 되살리기" : "영구 삭제",
    label,
  );
  return NextResponse.json({ trash: listTrash(), notebooks: listNotebooks() });
}
