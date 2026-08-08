"use client";

import { useSyncExternalStore } from "react";

/**
 * 복호화 서비스 워커 등록 상태.
 *
 * 암호화해 올린 파일은 이 워커가 잡고 있어야 열람·다운로드가 된다.
 * 워커가 잡히기 전에는 파일 URL 을 원본(암호문)으로 두고, UI 가 "준비 중"
 * 이라고 알린다.
 */

let ready = false;
let reason: string | null = null;
const listeners = new Set<() => void>();
let started = false;

function emit() {
  listeners.forEach((l) => l());
}

function setReady(v: boolean) {
  if (ready === v) return;
  ready = v;
  if (v) reason = null;
  emit();
}

function setReason(v: string) {
  if (reason === v) return;
  reason = v;
  emit();
}

/** 워커를 못 쓰는 이유. 쓸 수 있으면 null. */
export function swReason(): string | null {
  return ready ? null : reason;
}

export function registerDecryptWorker(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  if (!("serviceWorker" in navigator)) {
    setReason("이 브라우저는 서비스 워커를 지원하지 않아 암호화 파일을 열 수 없습니다");
    return;
  }

  // 서비스 워커는 보안 컨텍스트에서만 등록된다. https 나 localhost 가 아니면
  // (예: http://192.168.x.x 로 접속) 등록 자체가 되지 않아 복호화가 통째로
  // 멈춘다 — 증상은 "썸네일이 깨지고 PDF 가 그냥 받아진다" 로 나타난다.
  if (!window.isSecureContext) {
    setReason(
      "https 가 아닌 주소로 접속해서 복호화 워커를 쓸 수 없습니다 (암호화 파일 열람 불가)",
    );
    return;
  }

  /*
   * 하위 경로 배포에서는 워커도 그 아래에 있어야 한다.
   *
   * 서비스 워커의 스코프는 스크립트가 놓인 자리를 넘을 수 없다. `/memo` 아래
   * 앱이 `/sw.js` 를 부르면 그 주소에는 아무것도 없고, 스코프를 `/` 로 달라고
   * 하면 브라우저가 거절한다. 둘 다 접두어를 붙여야 한다.
   *
   * 접두어가 붙으면 워커가 가로채는 자리도 `/memo/dl/…` 이 되므로 워커 안의
   * 판정도 함께 바꿔야 한다 (public/sw.js 참고).
   */
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  navigator.serviceWorker
    .register(`${base}/sw.js`, { scope: `${base}/` })
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      // controller 가 잡혀야 fetch 가 가로채진다
      if (navigator.serviceWorker.controller) {
        setReady(true);
        return;
      }
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => setReady(!!navigator.serviceWorker.controller),
        { once: true },
      );
    })
    .catch((e) => {
      console.warn("[memobento] 서비스 워커 등록 실패:", e);
      setReason("복호화 워커를 등록하지 못했습니다");
    });
}

export function useSwReady(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => ready,
    () => false,
  );
}
