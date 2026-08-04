"use client";

import { viewUrl, type FileDTO } from "./types";

/**
 * 파일 내려받기.
 *
 * `<a download>` 은 쓰지 않는다. 그 요청은 브라우저의 다운로드 관리자가 직접
 * 내보내며 **서비스 워커를 거치지 않는다**. 복호화 경로인 `/dl/...` 이 워커를
 * 지나치고 서버까지 가는데 서버에는 그런 라우트가 없어 404 가 되고,
 * 크롬은 "사이트에서 사용할 수 없는 파일" 로 끝낸다. 화면에서 여는 것(`<img>`,
 * `<iframe>`, `fetch`)은 멀쩡한데 다운로드만 실패하던 이유다.
 *
 * **내비게이션은 워커가 가로챈다.** 그래서 숨은 iframe 을 그 주소로 보낸다.
 * 워커가 `Content-Disposition: attachment` 로 답하므로 브라우저가 그대로
 * 내려받고, 화면은 그 자리에 남는다. 최상위 이동을 쓰지 않는 것은 워커가
 * 없을 때 404 페이지로 앱을 밀어내지 않기 위해서다.
 */

/** 다운로드가 시작될 때까지 iframe 을 붙여 둔다. 응답이 오면 그 뒤로는 브라우저 몫. */
const KEEP_MS = 60_000;

export type DownloadResult = { ok: true } | { ok: false; reason: string };

export function downloadBlocker(
  file: Pick<FileDTO, "encrypted">,
  swReady: boolean,
): string | null {
  if (file.encrypted && !swReady) {
    // 여기서 막지 않으면 암호문이 그대로 저장된다. 파일은 받아지는데 열리지
    // 않으므로 실패가 눈에 띄지 않는다 — 조용히 깨지는 쪽이 더 나쁘다.
    return "복호화 준비 중입니다. 잠시 후 다시 눌러 주세요";
  }
  return null;
}

export function startDownload(
  file: Pick<FileDTO, "id" | "name" | "encrypted">,
  swReady: boolean,
): DownloadResult {
  const blocked = downloadBlocker(file, swReady);
  if (blocked) return { ok: false, reason: blocked };

  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.style.display = "none";
  frame.src = viewUrl(file, { dl: true, swReady });
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), KEEP_MS);
  return { ok: true };
}
