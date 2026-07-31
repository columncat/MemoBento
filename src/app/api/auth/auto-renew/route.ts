import { cookies, headers } from "next/headers";
import { type NextRequest } from "next/server";

import {
  REMEMBER_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_TTL_LONG,
  isAuthEnabled,
  logLogin,
  nowSeconds,
  sessionCookieOptions,
} from "@/lib/auth";
import { redirectTo } from "@/lib/redirect";
import {
  encryptSession,
  verifySession,
  type SessionPayload,
} from "@/lib/auth-crypto";

export async function GET(req: NextRequest) {
  if (!isAuthEnabled()) {
    return redirectTo("/");
  }

  const cookieStore = await cookies();
  const rememberToken = cookieStore.get(REMEMBER_COOKIE_NAME)?.value;
  if (!rememberToken) {
    return redirectTo("/login");
  }

  const verified = await verifySession(rememberToken);
  if (!verified) {
    return redirectTo("/login");
  }

  const ua = (await headers()).get("user-agent") ?? "unknown";
  try {
    await logLogin({ type: "auto", success: true, userAgent: ua });
  } catch {
    /* 로그 실패해도 로그인 자체는 진행 */
  }

  const now = nowSeconds();
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_LONG,
    remember: true,
  };
  cookieStore.set(
    SESSION_COOKIE_NAME,
    await encryptSession(payload),
    sessionCookieOptions(true),
  );

  const to = req.nextUrl.searchParams.get("to") || "/";
  const safeTo = to.startsWith("/") && !to.startsWith("//") ? to : "/";
  return redirectTo(safeTo);
}
