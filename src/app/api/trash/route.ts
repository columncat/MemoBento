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
  return NextResponse.json({ trash: listTrash(), notebooks: listNotebooks() });
}
