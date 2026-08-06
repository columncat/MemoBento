/**
 * 파일을 메모함에 올린다.
 *
 * 앱은 파일을 **조각으로 나눠 암호화해서** 보관한다. 브라우저가 하던 일을
 * 여기서 그대로 한다 — 평문으로 올려 두는 길(`encrypted: false`)도 열려 있지만,
 * 그러면 같은 메모함 안에 암호화된 것과 아닌 것이 섞인다. 나중에 "이 파일은
 * 왜 평문이지" 를 설명할 수 없게 되므로 형식을 맞춘다.
 *
 * 조각 하나 = `IV(12) || 암호문 || 태그(16)`, AES-256-GCM. 브라우저 쪽
 * `crypto-client.ts` 와 같은 규칙이다. WebCrypto 는 태그를 암호문 뒤에 붙여
 * 주고 Node 는 따로 주므로, 여기서 이어 붙여 모양을 맞춘다.
 *
 * 키는 서버가 들고 있고 `/api/files/key` 로 내려준다. 즉 이 암호화는 서버를
 * 못 믿겠다는 뜻이 아니라, 디스크에 그대로 놓이지 않게 하는 것이다.
 */

import { createCipheriv, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

import type { MemoBentoClient } from "./client.js";

/** 앱과 같은 값이어야 한다 (`src/lib/upload-session.ts`). */
const PLAIN_CHUNK = 8 * 1024 * 1024;
const IV_LEN = 12;

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  chunks: number;
}

interface FinishResponse {
  fileId: string;
}

/**
 * 올릴 수 있는 자리인지 확인하고 절대 경로로 바꾼다.
 *
 * `MEMOBENTO_UPLOAD_DIR` 를 정하지 않으면 이 기능은 아예 꺼진다. 정해 두면
 * **그 안에 있는 파일만** 올릴 수 있다. 이 서버는 앱 비밀번호를 들고 있으므로,
 * 아무 경로나 받으면 부르는 쪽이 시키는 대로 호스트의 어떤 파일이든 메모함에
 * 실어 나를 수 있다. 기본값은 "안 됨" 쪽이어야 한다.
 */
export function resolveUploadPath(name: string): string {
  const root = process.env.MEMOBENTO_UPLOAD_DIR?.trim();
  if (!root) {
    throw new Error(
      "파일 업로드가 꺼져 있습니다. 올릴 파일을 둘 폴더를 MEMOBENTO_UPLOAD_DIR 로 정하세요.",
    );
  }
  // 이름만 받는다. 경로를 받으면 ../ 로 빠져나가는 길을 일일이 막아야 한다.
  const leaf = basename(name);
  if (!leaf || leaf === "." || leaf === "..") throw new Error("파일 이름이 잘못되었습니다");

  const rootAbs = resolve(root);
  const target = resolve(rootAbs, leaf);
  // basename 을 거쳤으니 벗어날 수 없지만, 한 번 더 확인한다 — 이 검사가
  // 무너지면 호스트 파일이 통째로 새어 나간다.
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new Error("허용된 폴더 밖입니다");
  }
  return target;
}

async function fileKey(client: MemoBentoClient): Promise<Buffer> {
  const { key } = await client.get<{ key: string }>("/api/files/key");
  const raw = Buffer.from(key, "base64");
  if (raw.length !== 32) throw new Error(`파일 키 길이가 이상합니다 (${raw.length}바이트)`);
  return raw;
}

function encryptChunk(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  // WebCrypto 는 태그를 암호문 뒤에 붙인다. 같은 모양으로 만든다.
  return Buffer.concat([iv, ct, cipher.getAuthTag()]);
}

/** 파일을 8MB 씩 끊어 읽는다. 큰 파일을 통째로 메모리에 올리지 않는다. */
async function* chunksOf(path: string): AsyncGenerator<Buffer> {
  const stream = createReadStream(path, { highWaterMark: PLAIN_CHUNK });
  let held = Buffer.alloc(0);
  for await (const piece of stream) {
    held = Buffer.concat([held, piece as Buffer]);
    while (held.length >= PLAIN_CHUNK) {
      yield held.subarray(0, PLAIN_CHUNK);
      held = held.subarray(PLAIN_CHUNK);
    }
  }
  if (held.length > 0) yield held;
}

export interface UploadResult {
  fileId: string;
  name: string;
  size: number;
  chunks: number;
}

export async function uploadFile(
  client: MemoBentoClient,
  notebookId: string,
  fileName: string,
): Promise<UploadResult> {
  const path = resolveUploadPath(fileName);

  const info = await stat(path).catch(() => null);
  if (!info) throw new Error(`파일이 없습니다: ${basename(path)}`);
  if (!info.isFile()) throw new Error("보통 파일이 아닙니다");
  if (info.size === 0) throw new Error("빈 파일입니다");

  const name = basename(path);
  const init = await client.send<InitResponse>("POST", "/api/upload/init", {
    notebookId,
    name,
    size: info.size,
    encrypted: true,
  });

  const key = await fileKey(client);
  let index = 0;
  try {
    for await (const plain of chunksOf(path)) {
      await client.raw(
        "PUT",
        `/api/upload/chunk?id=${encodeURIComponent(init.uploadId)}&index=${index}`,
        encryptChunk(key, plain),
      );
      index += 1;
    }
  } catch (e) {
    // 반쯤 올라간 조각을 남기지 않는다. 실패는 그대로 올린다.
    await client
      .send("DELETE", `/api/upload/finish?id=${encodeURIComponent(init.uploadId)}`)
      .catch(() => undefined);
    throw e;
  }

  /*
   * 썸네일은 붙이지 않는다.
   *
   * 앱이 받는 썸네일은 브라우저가 만들어 암호화까지 마친 것이다. 여기서
   * 만들려면 이미지 디코더가 필요한데, 이 서버는 의존성이 두 개뿐이고 그
   * 하나를 미리보기 때문에 들이는 것은 값이 맞지 않는다. 썸네일이 없으면
   * 화면에는 종류 아이콘이 뜨고, 열면 원본이 그대로 보인다.
   */
  const done = await client.send<FinishResponse>("POST", "/api/upload/finish", {
    uploadId: init.uploadId,
  });

  return { fileId: done.fileId, name, size: info.size, chunks: index };
}
