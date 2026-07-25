import type { MemoDragPayload } from "./types";

/**
 * 진행 중인 메모 드래그의 출처.
 *
 * dragover 중에는 DataTransfer 의 **값을 읽을 수 없고 타입 목록만** 보이기 때문에,
 * "지금 끌고 있는 메모가 원래 어느 메모함 것인지"를 알려면 별도 보관이 필요하다.
 * 제자리 드롭일 때 오버레이를 띄우지 않는 용도로만 쓴다 (실제 이동 판정은
 * drop 시점에 DataTransfer 값으로 다시 확인한다).
 */
let active: MemoDragPayload | null = null;

export function beginMemoDrag(payload: MemoDragPayload): void {
  active = payload;
}

export function endMemoDrag(): void {
  active = null;
}

export function activeMemoDrag(): MemoDragPayload | null {
  return active;
}
