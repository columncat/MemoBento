"use server";

import { safePath } from "@/lib/redirect";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  REMEMBER_COOKIE_NAME,
  REMEMBER_TTL,
  SESSION_COOKIE_NAME,
  SESSION_TTL_LONG,
  SESSION_TTL_SHORT,
  isAuthEnabled,
  logLogin,
  nowSeconds,
  rememberCookieOptions,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { encryptSession, type SessionPayload } from "@/lib/auth-crypto";
import {
  checkLoginAllowed,
  failDelay,
  noteLoginFailure,
  noteLoginSuccess,
} from "@/lib/login-throttle";

export type LoginFormState = { error?: string } | null;

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") === "on";
  const to = String(formData.get("to") ?? "/");
  const h = await headers();
  const ua = h.get("user-agent") ?? "unknown";

  /*
   * `/api/login` 과 같은 횟수 제한·같은 통.
   *
   * 서버 액션도 결국 POST 하나라 액션 ID 만 알면 스크립트로 두드릴 수 있다.
   * 예전에는 JSON 입구에만 제한이 있어서, 이쪽으로 돌면 제한도 지연도 없이
   * 비밀번호를 무한히 대 볼 수 있었다.
   */
  const gate = checkLoginAllowed(h);
  if (!gate.ok) {
    return {
      error: `시도가 너무 많습니다. ${gate.retryAfter}초 뒤에 다시 시도하세요.`,
    };
  }

  if (!password) {
    return { error: "비밀번호를 입력하세요" };
  }

  if (!verifyPassword(password)) {
    try {
      await logLogin({ type: "manual", success: false, userAgent: ua });
    } catch {
      /* */
    }
    noteLoginFailure(h);
    await failDelay();
    return { error: "비밀번호가 틀렸습니다" };
  }

  noteLoginSuccess(h);

  try {
    await logLogin({ type: "manual", success: true, userAgent: ua });
  } catch {
    /* */
  }

  const now = nowSeconds();
  const sessionTtl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const sessionToken = await encryptSession({
    iat: now,
    exp: now + sessionTtl,
    remember,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    sessionToken,
    sessionCookieOptions(remember),
  );

  if (remember) {
    const rememberPayload: SessionPayload = {
      iat: now,
      exp: now + REMEMBER_TTL,
      remember: true,
    };
    cookieStore.set(
      REMEMBER_COOKIE_NAME,
      await encryptSession(rememberPayload),
      rememberCookieOptions(),
    );
  }

  const safeTo = safePath(to);
  redirect(safeTo);
}
