/**
 * 클라이언트/서버가 함께 쓰는 DTO. node 전용 모듈을 import 하지 않는다.
 * (컴포넌트에서 안전하게 import 가능)
 */

import type {
  FileKind,
  MemoColor,
  MemoType,
  NotebookKind,
  SystemKey,
  ViewMode,
} from "./db/schema";

import type { Recurrence } from "./recurrence";

export type { FileKind, MemoColor, MemoType, NotebookKind, SystemKey, ViewMode };
export type { Recurrence };

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
  /** 브라우저에서 암호화해 올린 파일인가 — 열람하려면 서비스 워커가 필요하다. */
  encrypted: boolean;
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
  /** 체크리스트·TODO 완료 여부. */
  done: boolean;
  /** TODO 기한 (unix ms). 없으면 null. */
  dueAt: number | null;
  /** 반복 일정 규칙 (schedule 메모함). 없으면 null. */
  recurrence: Recurrence | null;
  /** 지정한 글자 색. 없으면 기본색. */
  color: MemoColor | null;
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
  /** 메모함 종류 — 일반 메모 / 체크리스트 / TODO. */
  kind: NotebookKind;
  /**
   * 이 메모함이 받는 메모 종류.
   * 시스템 메모함은 MailBento 자료구조를 그대로 쓰므로 제한된다 —
   * Corkboard 는 링크만, Memo 는 텍스트만.
   */
  accepts: MemoType[];
  memos: MemoDTO[];
}

/** 이 메모함이 파일(이미지/PDF/일반)을 받을 수 있는가. */
export function acceptsFiles(nb: Pick<NotebookDTO, "accepts">): boolean {
  return (
    nb.accepts.includes("image") ||
    nb.accepts.includes("pdf") ||
    nb.accepts.includes("file")
  );
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
  /** 대상 메모함이 받을 수 있는지 dragover 시점에 판정하기 위해 함께 싣는다. */
  type: MemoType;
}

/** 저장된 바이트 그대로의 URL (암호화 파일이면 암호문). */
export function fileUrl(fileId: string, dl = false): string {
  return `/api/files/${encodeURIComponent(fileId)}${dl ? "?dl=1" : ""}`;
}

/**
 * 사람이 볼 수 있는 형태의 URL.
 *
 * 암호화 파일은 서비스 워커가 가로채 복호화하는 `/dl/...` 로 보낸다.
 * 워커가 아직 안 잡혔으면 원본 URL 로 떨어뜨리는데, 그 경우 암호화 파일은
 * 열리지 않으므로 호출부가 swReady 를 보고 안내한다.
 */
export function viewUrl(
  file: Pick<FileDTO, "id" | "name" | "encrypted">,
  opts: { dl?: boolean; swReady?: boolean } = {},
): string {
  const { dl = false, swReady = false } = opts;
  if (!file.encrypted) return fileUrl(file.id, dl);
  if (!swReady) return fileUrl(file.id, dl);
  return `/dl/${encodeURIComponent(file.id)}/${encodeURIComponent(file.name)}${
    dl ? "?dl=1" : ""
  }`;
}

/** 썸네일 URL. 암호화된 썸네일은 서비스 워커가 풀어서 그린다. */
export function thumbUrl(
  file: Pick<FileDTO, "id" | "encrypted">,
  swReady = false,
): string {
  if (file.encrypted && swReady) return `/dl/t/${encodeURIComponent(file.id)}`;
  return `/api/files/${encodeURIComponent(file.id)}/thumb`;
}

/** 메모 표시 이름 — 파일 메모는 title override 없으면 원본 파일명. */
export function memoLabel(memo: MemoDTO): string {
  if (memo.title && memo.title.trim()) return memo.title.trim();
  if (memo.file) return memo.file.name;
  // 링크 메모만 호스트명으로 대신한다. 일정·텍스트 메모에 링크를 붙였다고
  // 표시 이름이 본문에서 호스트명으로 바뀌면 드래그 페이로드와 aria-label 까지
  // 함께 어긋난다.
  if (memo.type === "link" && memo.url) return hostnameOf(memo.url);
  return memo.text?.split("\n")[0]?.slice(0, 60) ?? "";
}

/** 기한이 지났는가 (오늘 이전). */
export function isOverdue(dueAt: number | null, done: boolean): boolean {
  if (!dueAt || done) return false;
  const end = new Date(dueAt);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now();
}

/** 기한을 짧게 — 오늘/내일/어제는 말로, 그 외엔 날짜. */
export function formatDue(dueAt: number): string {
  const d = new Date(dueAt);
  const t = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(t)) / 86400000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === -1) return "어제";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (d.getFullYear() !== t.getFullYear()) return `${d.getFullYear()}.${mm}.${dd}`;
  return `${mm}.${dd}`;
}

/** <input type="date"> 값 (YYYY-MM-DD). */
export function toDateInput(dueAt: number | null): string {
  if (!dueAt) return "";
  const d = new Date(dueAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

/** 지정한 색의 CSS 값. 색이 없으면 undefined (기본색을 그대로 쓴다). */
export function colorVar(color: MemoColor | null): string | undefined {
  return color ? `var(--color-tag-${color})` : undefined;
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
