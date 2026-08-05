import { NextResponse } from "next/server";

import { listNotebooks } from "@/lib/memo-server";
import { expandMemos } from "@/lib/schedule-instances";

export const dynamic = "force-dynamic";

/**
 * "Schedule for Agents" 에서 **지금 발화할 것**을 돌려준다.
 *
 * 에이전트가 스스로를 깨우는 장치다. 반복 규칙을 여기서 펼치는 이유는 계산을
 * 한 곳에만 두기 위해서다 — 봇 쪽에 다시 구현하면 요일·말일·26시 같은 판정이
 * 둘로 갈라지고, 그때부터는 어느 쪽이 맞는지 아무도 모른다.
 *
 * `since` 이후 ~ 지금 사이에 시작 시각이 든 발생만 준다. 시각을 정하지 않은
 * 항목은 그날 아무 때나가 아니라 **자정**을 시작으로 본다 — 하루에 한 번만
 * 발화해야 하기 때문이다.
 */
const AGENT_SCHEDULE_ID = "sys-agent-schedule";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since"));
  const now = Date.now();
  if (!Number.isFinite(since) || since <= 0) {
    return NextResponse.json({ error: "since (unix ms) 가 필요합니다" }, { status: 400 });
  }
  // 너무 먼 과거를 주면 밀린 것이 한꺼번에 쏟아진다. 하루로 자른다.
  const from = Math.max(since, now - 86400_000);

  const nb = listNotebooks().find((n) => n.id === AGENT_SCHEDULE_ID);
  if (!nb) return NextResponse.json({ due: [], now });

  const { instances } = expandMemos(
    nb.memos,
    new Date(from - 86400_000),
    new Date(now + 86400_000),
  );

  const due = instances
    .map((i) => ({
      memoId: i.memoId,
      key: i.key,
      // 시각이 없으면 그날 자정. 하루 한 번만 걸리게.
      at: i.startsAt ?? i.day.getTime(),
      text: i.memo.text ?? i.memo.title ?? "",
    }))
    .filter((i) => i.at > from && i.at <= now && i.text.trim())
    .sort((a, b) => a.at - b.at);

  return NextResponse.json({ due, now });
}
