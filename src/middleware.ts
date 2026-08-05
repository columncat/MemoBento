import { NextResponse, type NextRequest } from "next/server";

import { verifySession } from "@/lib/auth-crypto";

/**
 * Edge-runtime 미들웨어 — DB 접근 X, bcrypt X.
 * 세션 쿠키 검증만 수행. auto-login 등 DB 기록은 /api/auth/auto-renew 에서 처리.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/auth/auto-renew",
  "/_next",
  "/favicon",
  /**
   * 복호화 서비스 워커 스크립트.
   * 로그인으로 리다이렉트되면 등록 자체가 실패해 암호화 파일을 열 수 없다.
   * 스크립트에 비밀은 없고, 키는 워커가 세션 쿠키로 따로 받아온다.
   */
  "/sw.js",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  // 인증 비활성 → 통과
  if (!process.env.AUTH_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const sessionToken = req.cookies.get("mb_session")?.value;
  if (sessionToken) {
    const session = await verifySession(sessionToken);
    if (session) return NextResponse.next();
  }

  const rememberToken = req.cookies.get("mb_remember")?.value;
  if (rememberToken) {
    const remember = await verifySession(rememberToken);
    if (remember) {
      const renewUrl = new URL("/api/auth/auto-renew", req.url);
      renewUrl.searchParams.set("to", pathname + req.nextUrl.search);
      return NextResponse.redirect(renewUrl);
    }
  }

  const loginUrl = new URL("/login", req.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("from", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /*
   * 확장자 제외를 넣지 않는다.
   *
   * 부정 전방탐색 안의 `.*\.(?:png|…)` 에는 끝 앵커가 없어서 확장자가 경로
   * **어디에** 있어도 걸린다. `/api/…/5.png` 같은 요청이 미들웨어를 통째로
   * 건너뛰고, 라우트는 `id="5.png"` 로 그대로 매치된다 — 로그인 없이 API 가
   * 열린다. 앵커를 붙여도 끝에 `.png` 를 달면 그만이라 소용없다.
   *
   * 정적 자산은 아래 PUBLIC_PREFIXES 의 "/_next" · "/favicon" 이 이미
   * 통과시키므로 여기서 뺄 이유가 없다.
   */
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
