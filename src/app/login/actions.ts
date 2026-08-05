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
  const ua = (await headers()).get("user-agent") ?? "unknown";

  if (!password) {
    return { error: "비밀번호를 입력하세요" };
  }

  if (!verifyPassword(password)) {
    try {
      await logLogin({ type: "manual", success: false, userAgent: ua });
    } catch {
      /* */
    }
    return { error: "비밀번호가 틀렸습니다" };
  }

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
