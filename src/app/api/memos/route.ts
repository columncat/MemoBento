import { logAgent } from "@/lib/agent-log";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createMemo, listNotebooks } from "@/lib/memo-server";
import { autoIconUrl, normalizeUrl } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    notebookId: z.string().min(1),
    text: z.string().trim().min(1, "내용이 비어 있습니다").max(20000),
    /** TODO 기한 (unix ms). */
    dueAt: z.number().int().nullable().optional(),
  }),
  z.object({
    type: z.literal("link"),
    notebookId: z.string().min(1),
    url: z.string().trim().min(1, "URL 을 입력하세요"),
    title: z.string().trim().max(200).optional(),
  }),
]);

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    if (input.type === "text") {
      createMemo({
        notebookId: input.notebookId,
        type: "text",
        text: input.text,
        dueAt: input.dueAt ?? null,
      });
    } else {
      const url = normalizeUrl(input.url);
      if (!url) {
        return NextResponse.json(
          { error: "올바른 URL 이 아닙니다" },
          { status: 400 },
        );
      }
      createMemo({
        notebookId: input.notebookId,
        type: "link",
        url,
        title: input.title ?? null,
        iconUrl: autoIconUrl(url),
      });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "추가 실패" },
      { status: 400 },
    );
  }

  const nbs = listNotebooks();
  logAgent(
    req,
    "메모 추가",
    nbs.find((n) => n.id === input.notebookId)?.name ?? input.notebookId,
    input.type === "text"
      ? { type: "text", text: input.text.slice(0, 200) }
      : { type: "link", url: input.url },
  );
  return NextResponse.json({ notebooks: nbs });
}
