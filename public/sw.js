/*
 * 물러나는 것 말고는 아무것도 하지 않는다.
 *
 * 예전에는 이 워커가 `/dl/…` 을 가로채 암호화된 파일을 브라우저 안에서 풀어
 * 줬다. 암호화를 걷어냈으므로 할 일이 없다.
 *
 * 파일을 지우는 것만으로는 부족하다. 이미 설치된 워커는 브라우저 안에 남아
 * 계속 fetch 를 가로채므로, 새 판이 스스로 등록을 지우고 잡고 있던 창들을
 * 놓아 주어야 한다. 이 파일은 그 일이 끝나면 아무도 받아 가지 않는다.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      // 잡고 있던 창들을 새로고침 없이 놓아 준다.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url).catch(() => {});
    })(),
  );
});
