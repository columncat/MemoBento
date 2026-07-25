import { open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { uploadRoot } from "./file-store";
import { uid } from "./uid";

/**
 * 청크 업로드 세션.
 *
 * 큰 파일을 한 번에 받으면 본문 전체가 메모리에 올라가 NAS(RAM 3.7GB)가 죽는다.
 * 그래서 브라우저가 조각내 보내고, 서버는 조각을 **정해진 오프셋에 그대로 써
 * 넣기만** 한다. 조각 크기가 고정이라 순서가 뒤바뀌거나 재시도해도 안전하다.
 * (Cloudflare 무료 플랜의 요청 본문 100MB 제한도 이 방식으로 우회된다.)
 */

/** 평문 조각 크기. 암호화하면 레코드당 IV 12 + 태그 16 바이트가 더 붙는다. */
export const PLAIN_CHUNK = 8 * 1024 * 1024;
export const GCM_OVERHEAD = 12 + 16;
export const ENC_CHUNK = PLAIN_CHUNK + GCM_OVERHEAD;

export interface UploadSession {
  id: string;
  notebookId: string;
  /** 원본 파일명. */
  name: string;
  /** 평문 기준 전체 크기. */
  size: number;
  /** 저장될 바이트 수 (암호화 오버헤드 포함). */
  storedSize: number;
  encrypted: boolean;
  createdAt: number;
}

function tmpDir(): string {
  return join(uploadRoot(), ".tmp");
}

const partPath = (id: string) => join(tmpDir(), `${id}.part`);
const metaPath = (id: string) => join(tmpDir(), `${id}.json`);

/** 암호화 시 디스크에 쌓이는 총 바이트. */
export function storedSizeFor(plainSize: number, encrypted: boolean): number {
  if (!encrypted) return plainSize;
  if (plainSize === 0) return 0;
  const records = Math.ceil(plainSize / PLAIN_CHUNK);
  return plainSize + records * GCM_OVERHEAD;
}

/** 조각 n 이 저장 파일에서 시작하는 오프셋. */
export function offsetOf(index: number, encrypted: boolean): number {
  return index * (encrypted ? ENC_CHUNK : PLAIN_CHUNK);
}

export async function createSession(input: {
  notebookId: string;
  name: string;
  size: number;
  encrypted: boolean;
}): Promise<UploadSession> {
  await mkdir(tmpDir(), { recursive: true });
  const session: UploadSession = {
    id: uid(),
    notebookId: input.notebookId,
    name: input.name,
    size: input.size,
    storedSize: storedSizeFor(input.size, input.encrypted),
    encrypted: input.encrypted,
    createdAt: Date.now(),
  };
  await writeFile(metaPath(session.id), JSON.stringify(session));
  // 빈 파일 생성 (오프셋 쓰기를 위해)
  await writeFile(partPath(session.id), "");
  return session;
}

export async function loadSession(id: string): Promise<UploadSession | null> {
  if (!/^[a-z0-9]+$/i.test(id)) return null; // 경로 조작 차단
  try {
    return JSON.parse(await readFile(metaPath(id), "utf8")) as UploadSession;
  } catch {
    return null;
  }
}

/** 조각을 제자리에 써 넣는다. 같은 조각을 다시 보내도 결과가 같다. */
export async function writeChunk(
  session: UploadSession,
  index: number,
  bytes: Uint8Array,
): Promise<void> {
  const fh = await open(partPath(session.id), "r+");
  try {
    await fh.write(bytes, 0, bytes.byteLength, offsetOf(index, session.encrypted));
  } finally {
    await fh.close();
  }
}

/** 지금까지 쌓인 바이트 수 (진행률/검증용). */
export async function currentSize(id: string): Promise<number> {
  try {
    return (await stat(partPath(id))).size;
  } catch {
    return 0;
  }
}

/**
 * 세션을 실제 저장 파일로 확정한다.
 * 크기가 예상과 다르면 거절하고 임시 파일을 지운다.
 */
export async function finalize(
  session: UploadSession,
  fileId: string,
  ext: string,
): Promise<{ path: string; storedSize: number }> {
  const actual = await currentSize(session.id);
  if (actual !== session.storedSize) {
    await discard(session.id);
    throw new Error(
      `업로드가 완전하지 않습니다 (${actual}/${session.storedSize} bytes)`,
    );
  }
  const rel = ext ? `${fileId}.${ext}` : fileId;
  await rename(partPath(session.id), join(uploadRoot(), rel));
  await rm(metaPath(session.id), { force: true });
  return { path: rel, storedSize: actual };
}

export async function discard(id: string): Promise<void> {
  await Promise.all([
    rm(partPath(id), { force: true }).catch(() => undefined),
    rm(metaPath(id), { force: true }).catch(() => undefined),
  ]);
}
