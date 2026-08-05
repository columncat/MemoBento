import { NextResponse } from "next/server";

import { AGENT_LOG_DAYS, clearAgentLog, listAgentLog } from "@/lib/agent-log";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: listAgentLog(), retentionDays: AGENT_LOG_DAYS });
}

/** 기록 비우기. 되돌릴 수 없지만 기록일 뿐이라 데이터가 사라지지는 않는다. */
export async function DELETE() {
  clearAgentLog();
  return NextResponse.json({ entries: [], retentionDays: AGENT_LOG_DAYS });
}
