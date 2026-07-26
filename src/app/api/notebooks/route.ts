import { NextResponse } from "next/server";
import { z } from "zod";

import { NOTEBOOK_KINDS } from "@/lib/db/schema";
import { createNotebook, listNotebooks } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ notebooks: listNotebooks() });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력하세요").max(60),
  kind: z.enum(NOTEBOOK_KINDS).default("memo"),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  createNotebook(parsed.data.name, parsed.data.kind);
  return NextResponse.json({ notebooks: listNotebooks() });
}
