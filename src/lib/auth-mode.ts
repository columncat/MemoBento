/**
 * 인증을 켤지 끌지 — 미들웨어(edge)와 서버 코드가 함께 보는 하나의 판정.
 *
 * 예전에는 `AUTH_PASSWORD` 가 비어 있으면 그냥 통과시켰다(fail-open). 그러면
 * 설정 파일이 비밀번호 없이 다시 쓰이는 순간 — 예컨대 설치 마법사를 빈 칸으로
 * 다시 돌리면 — 메모함 전체가 **아무 말 없이** 공개된다. 잠금이 풀린 것을
 * 알아챌 방법이 없다는 게 문제였다.
 *
 * 그래서 이제는 반대로 간다. 비밀번호나 세션 키가 없으면 **막는다**
 * ("misconfigured"). 정말로 잠그지 않고 쓰고 싶으면 `AUTH_DISABLED=1` 을
 * 일부러 적어야 한다 — 빠뜨려서 열리는 일은 없고, 열려면 적어야 한다.
 *
 * 비밀번호가 들어 있는데 키만 빠진 경우는 `AUTH_DISABLED=1` 이 있어도 열지
 * 않는다. 잠그려던 설정이 반쯤 깨진 것이지 끄려던 게 아니기 때문이다.
 *
 * DB·bcrypt 를 쓰지 않는다 — edge 미들웨어에서도 불러야 한다.
 */
export type AuthMode = "on" | "off" | "misconfigured";

export function authMode(): AuthMode {
  const password = process.env.AUTH_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (password && secret) return "on";
  if (!password && process.env.AUTH_DISABLED === "1") return "off";
  return "misconfigured";
}

/** 막을 때 보여 줄 문장. 어떤 값이 빠졌는지만 말하고 값 자체는 말하지 않는다. */
export const MISCONFIGURED_MESSAGE =
  "인증이 설정되지 않았습니다 — AUTH_PASSWORD 와 AUTH_SECRET 을 채우거나, " +
  "잠그지 않으려면 AUTH_DISABLED=1 을 명시하세요.";
