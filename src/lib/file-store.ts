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

/** 원본 바이트를 UPLOAD_DIR 에 쓰고 상대 경로를 돌려준다. */
export async function writeOriginal(
  id: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  const root = await ensureUploadDir();
  const rel = ext ? `${id}.${safeSegment(ext)}` : id;
  await writeFile(join(root, rel), bytes);
  return rel;
}

/** 클라이언트가 만든 썸네일 data URL 을 PNG 로 저장. 실패하면 null. */
export async function writeThumbFromDataUrl(
  id: string,
  dataUrl: string,
): Promise<string | null> {
  const m = /^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/i.exec(
    dataUrl.trim(),
  );
  if (!m) return null;
  const ext = m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(m[2], "base64");
  } catch {
    return null;
  }
  // 썸네일이 비정상적으로 크면(=원본을 그대로 보낸 경우) 저장하지 않는다.
  if (bytes.length === 0 || bytes.length > 2_000_000) return null;

  const root = await ensureUploadDir();
  const rel = `${id}.thumb.${ext}`;
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
  size: number;
}

/** 저장된 파일을 스트림으로 연다. 없으면 null. */
export async function openStored(relPath: string): Promise<StoredStream | null> {
  const abs = resolveStored(relPath);
  if (!abs) return null;
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return null;
    size = st.size;
  } catch {
    return null;
  }
  const nodeStream = createReadStream(abs);
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
  return { body, size };
}

export const maxUploadBytes = () => env.MAX_UPLOAD_MB * 1024 * 1024;
