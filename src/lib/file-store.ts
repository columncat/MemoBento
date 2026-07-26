import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

import { env } from "./env";

/** UPLOAD_DIR 의 절대 경로. */
export function uploadRoot(): string {
  return resolve(env.UPLOAD_DIR);
}

export async function ensureUploadDir(): Promise<string> {
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  return root;
}

/**
 * DB 에 저장된 상대 경로를 절대 경로로 바꾼다.
 * UPLOAD_DIR 밖을 가리키면(경로 탈출) null — 방어적으로 항상 검사한다.
 */
export function resolveStored(relPath: string): string | null {
  if (!relPath || isAbsolute(relPath) || relPath.includes("\0")) return null;
  const root = uploadRoot();
  const abs = resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

/** 파일명으로 쓸 수 없는 문자를 제거. 저장 경로는 uid 기반이라 표시용 보조 안전장치. */
export function safeSegment(s: string): string {
  return s.replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

/**
 * 브라우저가 암호화해 보낸 썸네일 레코드를 그대로 저장한다.
 * 서버는 내용을 알지 못한다 — 미리보기 이미지도 평문으로 남기지 않기 위함.
 */
export async function writeEncryptedThumb(
  id: string,
  base64Record: string,
): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Record, "base64");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > 4_000_000) return null;

  const root = await ensureUploadDir();
  const rel = `${id}.thumb.enc`;
  await writeFile(join(root, rel), bytes);
  return rel;
}

/** 원본 + 썸네일 삭제. 이미 없어도 조용히 통과. */
export async function removeStored(
  ...relPaths: (string | null | undefined)[]
): Promise<void> {
  await Promise.all(
    relPaths.map(async (rel) => {
      if (!rel) return;
      const abs = resolveStored(rel);
      if (!abs) return;
      await rm(abs, { force: true }).catch(() => {
        /* 무시 */
      });
    }),
  );
}

export interface StoredStream {
  body: ReadableStream;
  /** 이번 응답으로 보내는 바이트 수. */
  size: number;
  /** 파일 전체 크기. */
  totalSize: number;
  /** Range 요청이면 실제로 보내는 구간 (없으면 전체). */
  range: { start: number; end: number } | null;
}

/**
 * 저장된 파일을 스트림으로 연다. 없으면 null.
 * `range` 를 주면 그 구간만 읽는다 (이어받기·탐색용).
 */
export async function openStored(
  relPath: string,
  range?: { start: number; end: number } | null,
): Promise<StoredStream | null> {
  const abs = resolveStored(relPath);
  if (!abs) return null;
  let totalSize: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return null;
    totalSize = st.size;
  } catch {
    return null;
  }

  let size = totalSize;
  let opts: { start?: number; end?: number } = {};
  if (range) {
    const start = Math.max(0, range.start);
    const end = Math.min(totalSize - 1, range.end);
    if (start > end) return null;
    opts = { start, end };
    size = end - start + 1;
    range = { start, end };
  }

  const nodeStream = createReadStream(abs, opts);
  const body = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        controller.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
        );
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
  return { body, size, totalSize, range: range ?? null };
}

/** `Range: bytes=start-end` 파싱. 지원하지 않는 형태면 null. */
export function parseRange(
  header: string | null,
  totalSize: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    // 마지막 N 바이트
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { start: Math.max(0, totalSize - n), end: totalSize - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

