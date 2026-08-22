import { NextResponse } from "next/server";

import {
  AGENT_LOG_DAYS,
  clearAgentLog,
  latestAgentLogId,
  listAgentLog,
} from "@/lib/agent-log";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  /*
   * `?head=1` — 번호 하나만.
   *
   * 화면이 "에이전트가 뭔가 바꿨나" 를 짧은 간격으로 물어보는 자리다. 목록을
   * 통째로 실어 보내면 아무것도 안 바뀐 대부분의 물음에 200줄씩 오간다.
   */
  if (new URL(req.url).searchParams.get("head")) {
    return NextResponse.json({ rev: latestAgentLogId() });
  }
  return NextResponse.json({ entries: listAgentLog(), retentionDays: AGENT_LOG_DAYS });
}

/** 기록 비우기. 되돌릴 수 없지만 기록일 뿐이라 데이터가 사라지지는 않는다. */
export async function DELETE() {
  clearAgentLog();
  return NextResponse.json({ entries: [], retentionDays: AGENT_LOG_DAYS });
}
