/**
 * 클라이언트/서버가 함께 쓰는 DTO. node 전용 모듈을 import 하지 않는다.
 * (컴포넌트에서 안전하게 import 가능)
 */

import type {
  FileKind,
  MemoType,
  SystemKey,
  ViewMode,
} from "./db/schema";

export type { FileKind, MemoType, SystemKey, ViewMode };

export interface FileDTO {
  id: string;
  /** 원본 파일명. */
  name: string;
  /** 소문자 확장자 (점 없음). */
  ext: string;
  mimeType: string;
  size: number;
  /** 확장자로 판별한 분류 — 열람 가능 여부를 결정. */
  kind: FileKind;
  /** 썸네일 이미지 존재 여부. true 면 /api/files/{id}/thumb 사용 가능. */
  hasThumb: boolean;
}

export interface MemoDTO {
  id: string;
  notebookId: string;
  type: MemoType;
  /** text 메모 본문. */
  text: string | null;
  /** link 메모 제목 / 파일 메모 표시 이름. */
  title: string | null;
  url: string | null;
  iconUrl: string | null;
  file: FileDTO | null;
  createdAt: number;
  updatedAt: number;
  /** true = MailBento widget_state 에 저장되는 메모 (시스템 메모함과 동기화). */
  legacy: boolean;
}

export interface NotebookDTO {
  id: string;
  name: string;
  /** null 이면 사용자 메모함. 값이 있으면 이름 변경·삭제 잠김. */
  systemKey: SystemKey | null;
  viewMode: ViewMode;
  position: number;
  memos: MemoDTO[];
}

/**
 * 메모를 다른 메모함으로 끌어 옮길 때 쓰는 DataTransfer 타입.
 * 파일 드롭과 구분하기 위해 전용 MIME 을 쓴다 (값은 dragover 중엔 못 읽고
 * 타입 목록만 보이므로, 판별은 이 문자열의 존재 여부로 한다).
 */
export const MEMO_DND_TYPE = "application/x-memobento-memo";

export interface MemoDragPayload {
  id: string;
  notebookId: string;
}

/** 파일 원본 URL. dl=true 면 다운로드(attachment). */
export function fileUrl(fileId: string, dl = false): string {
  return `/api/files/${encodeURIComponent(fileId)}${dl ? "?dl=1" : ""}`;
}

/** 썸네일 URL. */
export function thumbUrl(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/thumb`;
}

/** 메모 표시 이름 — 파일 메모는 title override 없으면 원본 파일명. */
export function memoLabel(memo: MemoDTO): string {
  if (memo.title && memo.title.trim()) return memo.title.trim();
  if (memo.file) return memo.file.name;
  if (memo.url) return hostnameOf(memo.url);
  return memo.text?.split("\n")[0]?.slice(0, 60) ?? "";
}

/** 클릭 시 모달로 열람 가능한 메모인가 (이미지 / PDF / plaintext 파일 / 텍스트). */
export function isViewable(memo: MemoDTO): boolean {
  if (memo.type === "text") return true;
  if (memo.type === "link") return false; // 링크는 새 탭으로 이동
  return memo.file ? memo.file.kind !== "file" : false;
}

/** URL 의 hostname 추출 (실패하면 url 그대로). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Google favicon 서비스로 favicon URL 자동 생성. */
export function autoIconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${hostnameOf(url)}&sz=128`;
}

/** 문자열이 단일 URL 로 보이는지 (붙여넣기 → 링크 메모 판별). */
export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  // "example.com/path" 형태도 허용
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t);
}

/** 링크 메모용으로 정규화한 URL (실패하면 null). */
export function normalizeUrl(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).toString();
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
