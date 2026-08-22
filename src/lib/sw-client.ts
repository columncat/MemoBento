"use client";

/**
 * 예전에 깔아 둔 복호화 서비스 워커를 물러나게 한다.
 *
 * 파일을 암호화해 두던 시절, 열람과 다운로드는 이 워커가 `/dl/…` 을 가로채
 * 브라우저 안에서 풀어 주는 것에 기대고 있었다. 암호화를 걷어냈으니 워커가
 * 할 일이 없다.
 *
 * 지우기만 해서는 안 된다. 서비스 워커는 **브라우저에 남는다** — 서버에서
 * 파일을 없애도 이미 설치된 워커는 계속 돌면서 fetch 를 가로챈다. 그래서
 * 스스로 물러나게 만들고(public/sw.js), 여기서도 한 번 더 등록을 걷어낸다.
 * 둘 중 하나만 있어도 되지만, 창을 다시 열지 않는 사람에게는 이쪽이 먼저 닿는다.
 */
export function unregisterDecryptWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => undefined);
}
