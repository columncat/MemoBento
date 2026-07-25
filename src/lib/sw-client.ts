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
const listeners = new Set<() => void>();
let started = false;

function setReady(v: boolean) {
  if (ready === v) return;
  ready = v;
  listeners.forEach((l) => l());
}

export function registerDecryptWorker(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  if (!("serviceWorker" in navigator)) {
    console.warn("[memobento] 이 브라우저는 서비스 워커를 지원하지 않습니다 — 암호화 파일 열람 불가");
    return;
  }

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
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
