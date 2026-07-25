import { NextResponse } from "next/server";

import { exportBackup } from "@/lib/memo-server";

export const dynamic = "force-dynamic";

/**
 * 전체 내보내기 — 메모함/메모 구조 + MailBento 호환 widget 필드.
 * 첨부 파일의 바이트는 포함하지 않는다 (data 볼륨에 그대로 남음).
 */
export async function GET() {
  return NextResponse.json(exportBackup());
}
