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
  return NextResponse.json({ notebooks: listNotebooks() });
}
