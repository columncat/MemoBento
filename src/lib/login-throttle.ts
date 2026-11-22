/**
 * 로그인 시도 제한.
 *
 * `/api/login` 은 폼이 아니라 JSON 입구라 스크립트로 두드리기 쉽다. 화면
 * 로그인(서버 액션)도 액션 ID 만 알면 똑같이 스크립트로 부를 수 있으므로
 * 같은 통을 쓴다 — 한쪽만 막으면 다른 쪽으로 돌아 들어온다. 실패마다
 * 700ms 를 재우는 것만으로는 부족하다 — **동시에** 던지면 지연이 겹쳐서 사라진다.
 * 초당 수백 번이 가능해지고, 그러면 짧은 비밀번호는 금방 뚫린다.
 *
 * 그래서 지연이 아니라 **횟수**로 막는다. 창 안에서 정해진 횟수를 넘기면 그
 * 창이 끝날 때까지 전부 거절한다. 동시 요청도 같은 카운터를 지나므로 병렬로
 * 우회할 수 없다.
 *
 * 프로세스 메모리에 둔다. 단일 컨테이너이고, 재시작하면 풀리는 편이 잠금에
 * 갇히는 것보다 낫다 — 이건 한 사람이 쓰는 앱이다.
 */

/** 창 길이. */
const WINDOW_MS = 10 * 60 * 1000;
/** 창 안에서 허용할 실패 횟수. */
const MAX_FAILS = 10;

interface Bucket {
  fails: number;
  /** 창이 끝나는 시각. */
  until: number;
}

/*
 * 전역에 하나만 둔다.
 *
 * 이 모듈은 `/api/login` 라우트와 로그인 서버 액션 두 곳에서 불린다. Next 가
 * 두 진입점을 따로 묶으면 모듈이 두 벌 생길 수 있고, 그러면 통도 둘이 되어
 * 한쪽에서 막힌 시도가 다른 쪽에서 새로 시작된다. globalThis 에 걸어 두면
 * 몇 벌로 묶이든 같은 Map 을 본다.
 */
const g = globalThis as typeof globalThis & {
  __memobentoLoginBuckets?: Map<string, Bucket>;
};
const buckets = (g.__memobentoLoginBuckets ??= new Map<string, Bucket>());

/** `Request.headers` 와 `next/headers` 의 `headers()` 둘 다 받으려고 이 정도만 요구한다. */
export interface HeaderSource {
  get(name: string): string | null;
}

/**
 * 누구의 시도로 셀지.
 *
 * X-Forwarded-For 의 **첫** 칸을 쓰면 안 된다 — 그 칸은 클라이언트가 적어
 * 보낸 그대로다. Cloudflare 는 받은 XFF 를 지우지 않고 뒤에 덧붙이므로,
 * 매번 다른 값을 적어 보내면 시도마다 새 통이 생겨 횟수 제한이 무의미해진다.
 *
 * 그래서 순서는:
 *  1. `cf-connecting-ip` — Cloudflare 가 매번 **덮어쓴다.** 클라이언트가 적어
 *     보내도 엣지에서 지워진다. 포트가 loopback 에만 열려 있으면 이 앱에 닿는
 *     것은 cloudflared 뿐이라 이 값을 믿을 수 있다.
 *  2. `x-real-ip` — 앞에 다른 프록시를 둔 배포용.
 *  3. XFF 의 **마지막** 칸 — 우리 바로 앞 프록시가 붙인 것이라 위조가 어렵다.
 *  4. 그것도 없으면 "unknown" 한 통 — 주소를 못 가르는 상황에서는 전부 한 통에
 *     넣는 편이 안전하다(같은 도커망의 스크립트들이 여기 모인다).
 */
function keyOf(h: HeaderSource): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops[hops.length - 1] || "unknown";
}

/** 지금 이 요청을 받아도 되는지. 막혔으면 남은 초. */
export function checkLoginAllowed(
  h: HeaderSource,
): { ok: true } | { ok: false; retryAfter: number } {
  const k = keyOf(h);
  const b = buckets.get(k);
  if (!b) return { ok: true };
  if (Date.now() >= b.until) {
    buckets.delete(k);
    return { ok: true };
  }
  if (b.fails < MAX_FAILS) return { ok: true };
  return { ok: false, retryAfter: Math.ceil((b.until - Date.now()) / 1000) };
}

export function noteLoginFailure(h: HeaderSource): void {
  const k = keyOf(h);
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || now >= b.until) {
    buckets.set(k, { fails: 1, until: now + WINDOW_MS });
    return;
  }
  b.fails += 1;
}

/** 성공하면 창을 지운다. 옳은 비밀번호를 아는 쪽을 계속 막을 이유가 없다. */
export function noteLoginSuccess(h: HeaderSource): void {
  buckets.delete(keyOf(h));
}

/**
 * 실패에 딸리는 지연. JSON 입구와 화면 로그인(서버 액션)이 같은 값을 쓴다.
 * 횟수 제한이 본 방어이고, 이건 한 통 안에서의 속도를 깎는 보조다.
 */
export const FAIL_DELAY_MS = 700;

export function failDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
}
