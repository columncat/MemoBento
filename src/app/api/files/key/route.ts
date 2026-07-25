import { NextResponse } from "next/server";

import { getOrCreateFileKey } from "@/lib/file-key";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 파일 암호화 키를 로그인한 클라이언트에 내려준다.
 * 미들웨어가 인증을 강제하므로 세션 없이는 여기 닿지 못한다.
 */
export async function GET() {
  return NextResponse.json(
    { key: getOrCreateFileKey() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
