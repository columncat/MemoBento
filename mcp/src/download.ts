/**
 * 메모함에 올린 파일을 꺼내 읽는다.
 *
 * 파일은 조각마다 AES-256-GCM 으로 잠겨 있다 (`upload.ts` 의 반대). 키는 서버가
 * 들고 있고 `/api/files/key` 로 내려주므로, 사람이 브라우저에서 여는 것과 같은
 * 방법으로 푼다.
 *
 * 푼 바이트를 그대로 돌려주지는 않는다. 도구 응답은 대화에 실리므로, 볼 수
 * 있는 것(그림·PDF)만 담고 나머지는 무엇인지만 알려 준다. 5GB 짜리 압축 파일을
 * base64 로 대화에 넣는 일이 없어야 한다.
 */

import { createDecipheriv } from "node:crypto";

import type { MemoBentoClient } from "./client.js";

const IV_LEN = 12;
const TAG_LEN = 16;
const GCM_OVERHEAD = IV_LEN + TAG_LEN;

/**
 * 대화에 실을 수 있는 최대 크기.
 *
 * base64 는 3바이트를 4글자로 부풀린다. 8MB 면 11MB 남짓의 글자가 되고, 그것이
 * 그대로 맥락을 차지한다. 사진 한 장이나 몇 쪽짜리 문서는 넉넉히 들어간다.
 */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

export interface FetchedFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** 이 형식을 모델이 직접 볼 수 있는가. */
export function viewableKind(mime: string): "image" | "pdf" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return null;
}

async function fileKey(client: MemoBentoClient): Promise<Buffer> {
  const { key } = await client.get<{ key: string }>("/api/files/key");
  const raw = Buffer.from(key, "base64");
  if (raw.length !== 32) throw new Error(`파일 키 길이가 이상합니다 (${raw.length}바이트)`);
  return raw;
}

/**
 * 레코드 하나 풀기. `IV(12) || 암호문 || 태그(16)`.
 *
 * 브라우저(`public/sw.js`)와 같은 규칙이다. 여기서 어긋나면 사람이 여는 것과
 * 에이전트가 읽는 것이 달라지는데, 그런 어긋남은 한참 뒤에야 드러난다.
 */
function decryptRecord(key: Buffer, record: Buffer): Buffer {
  if (record.length <= GCM_OVERHEAD) throw new Error("잘린 암호문");
  const iv = record.subarray(0, IV_LEN);
  const tag = record.subarray(record.length - TAG_LEN);
  const ct = record.subarray(IV_LEN, record.length - TAG_LEN);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

/** 파일 하나를 받아 (필요하면 풀어서) 돌려준다. */
export async function fetchFile(
  client: MemoBentoClient,
  fileId: string,
): Promise<FetchedFile> {
  const res = await client.rawGet(`/api/files/${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다 (${res.status})`);

  const enc = Buffer.from(await res.arrayBuffer());
  const encrypted = res.headers.get("X-MB-Encrypted") === "1";
  const mimeType =
    res.headers.get("X-MB-Type") ||
    (res.headers.get("Content-Type") || "application/octet-stream").split(";")[0];
  const rawName = res.headers.get("X-MB-Name") || fileId;
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    /* 그대로 둔다 */
  }

  if (!encrypted) return { name, mimeType, bytes: enc };

  const chunkSize = Number(res.headers.get("X-MB-Chunk-Size") || 0);
  if (!chunkSize) throw new Error("복호화 정보를 읽을 수 없습니다");

  const key = await fileKey(client);
  const recordSize = chunkSize + GCM_OVERHEAD;
  const parts: Buffer[] = [];
  for (let off = 0; off < enc.length; off += recordSize) {
    parts.push(decryptRecord(key, enc.subarray(off, Math.min(off + recordSize, enc.length))));
  }
  return { name, mimeType, bytes: Buffer.concat(parts) };
}
