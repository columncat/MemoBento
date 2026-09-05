import type { FileKind, MemoType } from "./db/schema";

/**
 * 파일 분류는 **확장자**로 판별한다 (브라우저가 보내는 MIME 은 신뢰하지 않음).
 * image / pdf / text 는 메모 아이템 클릭 시 앱 안에서 열람 가능,
 * file 은 클릭 즉시 다운로드.
 */

export const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
  "ico",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

export const PDF_EXT = new Set(["pdf"]);

export const TEXT_EXT = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "env",
  "properties",
  "xml",
  "svgz",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "pl",
  "lua",
  "r",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "bat",
  "cmd",
  "ps1",
  "dockerfile",
  "gitignore",
  "editorconfig",
  "srt",
  "vtt",
  "ass",
  "tex",
  "bib",
  "diff",
  "patch",
]);

/** 파일명에서 소문자 확장자 추출 (점 없음). 없으면 "". */
export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) {
    // ".gitignore" 처럼 점으로 시작하는 이름은 전체를 확장자로 본다
    return base.startsWith(".") ? base.slice(1).toLowerCase() : "";
  }
  return base.slice(i + 1).toLowerCase();
}

export function kindOf(filename: string): FileKind {
  const ext = extOf(filename);
  if (IMAGE_EXT.has(ext)) return "image";
  if (PDF_EXT.has(ext)) return "pdf";
  if (TEXT_EXT.has(ext)) return "text";
  return "file";
}

/** 파일 분류 → 메모 타입. text 파일도 메모 타입은 "file" (본문 메모와 구분). */
export function memoTypeForKind(kind: FileKind): MemoType {
  if (kind === "image") return "image";
  if (kind === "pdf") return "pdf";
  return "file";
}

/**
 * 소리·영상 확장자 → MIME.
 *
 * `kindOf` 는 이것들을 그대로 `file` 로 둔다. 앱 안에서 여는 것은 이미지·PDF·
 * 텍스트뿐이고, 여기에 새 분류를 만들면 `files.kind` 에 들어가는 값이 늘어나
 * 이미 저장된 행과 어긋난다. 이 목록은 **Content-Type 을 제대로 붙이려는
 * 것**이다 — 확장자를 모르면 `application/octet-stream` 이 나가는데, 그러면
 * `<audio>`/`<video>` 가 소스를 아예 거절하는 브라우저가 있다. VoiceBento 가
 * `/api/files/[id]` 로 바로 소리를 트므로 이게 곧 재생 여부를 가른다.
 *
 * `ts` 는 일부러 뺐다 — MPEG-TS 이기도 하지만 여기서는 TypeScript 가 압도적으로
 * 흔하고, `TEXT_EXT` 가 이미 가져가 있다.
 */
const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  /*
   * `m4b` 는 `m4a` 와 같은 MP4 컨테이너다 (파인더가 "Apple MPEG-4 오디오북"
   * 이라 적는 것). 여기 없으면 `application/octet-stream` 이 나가고,
   * `mediaKindOf` 도 null 을 줘서 목록에서는 종이 아이콘이 되고 **누르는
   * 순간 통째로 내려받는다** — 그러지 않으려고 소리·영상을 갈라 둔 것인데
   * 확장자 하나가 빠져 그 갈래를 못 타고 있었다.
   *
   * VoiceBento 의 `MEDIA_EXTS` 가 이미 `m4b` 를 받아 준다. 저쪽이 받아
   * 이 메모함에 놓는 것을 이쪽이 모르면 그 파일은 여기서 정체 모를 덩어리가
   * 된다 — 두 목록은 함께 움직여야 한다.
   */
  m4b: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  amr: "audio/amr",
  caf: "audio/x-caf",
};

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  m2ts: "video/mp2t",
  "3gp": "video/3gpp",
  ogv: "video/ogg",
};

export const AUDIO_EXT = new Set(Object.keys(AUDIO_MIME));
export const VIDEO_EXT = new Set(Object.keys(VIDEO_MIME));

/**
 * 소리인가 영상인가 — 둘 다 아니면 null.
 * 분류(`FileKind`)를 늘리지 않고 아이콘만 갈아 끼우려고 따로 둔다.
 */
export function mediaKindOf(filename: string): "audio" | "video" | null {
  const ext = extOf(filename);
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  md: "text/markdown",
  xml: "application/xml",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  tar: "application/x-tar",
  ...AUDIO_MIME,
  ...VIDEO_MIME,
};

/**
 * 응답에 쓸 Content-Type. 확장자 우선, 없으면 업로드 MIME, 그것도 없으면 octet-stream.
 * text 계열은 UTF-8 을 명시해 브라우저가 깨진 글자로 렌더하지 않게 한다.
 */
export function contentTypeFor(filename: string, uploadedMime?: string): string {
  const ext = extOf(filename);
  const known = MIME_BY_EXT[ext];
  if (known) {
    return known.startsWith("text/") ? `${known}; charset=utf-8` : known;
  }
  if (kindOf(filename) === "text") return "text/plain; charset=utf-8";
  if (uploadedMime && uploadedMime !== "application/octet-stream") {
    return uploadedMime;
  }
  return "application/octet-stream";
}

/**
 * inline(Content-Disposition: inline)으로 내려도 되는 타입인가.
 * 그 외에는 attachment 로 강제해 브라우저가 렌더하지 않게 한다.
 *
 * 주의: SVG/HTML 처럼 스크립트를 품을 수 있는 타입도 여기서는 inline 이지만,
 * 파일 라우트가 모든 응답에 `Content-Security-Policy: sandbox` 와
 * `X-Content-Type-Options: nosniff` 를 붙여 스크립트 실행을 차단한다.
 */
export function isInlineSafe(filename: string): boolean {
  const kind = kindOf(filename);
  return kind === "image" || kind === "pdf" || kind === "text";
}

/**
 * 업로드 파일 응답에 붙일 CSP.
 *
 * 기본은 `sandbox` — 불투명 오리진 + 스크립트 금지라, SVG/HTML 을 직접 열어도
 * 우리 오리진의 쿠키·DOM 에 손댈 수 없다.
 *
 * PDF 만 예외로 `allow-scripts` 를 준다. 브라우저 내장 PDF 뷰어가 스크립트로
 * 동작하기 때문에 순수 `sandbox` 로는 빈 화면이 된다. `allow-same-origin` 은
 * 여전히 빼므로 오리진은 불투명하게 유지된다 (PDF 안의 스크립트가 우리 쪽을
 * 건드릴 수 없음).
 */
export function cspFor(filename: string): string {
  return kindOf(filename) === "pdf" ? "sandbox allow-scripts" : "sandbox";
}
