/**
 * 메모함에 올린 파일을 꺼내 읽는다.
 *
 * 받은 바이트를 그대로 돌려주지는 않는다. 도구 응답은 대화에 실리므로, 볼 수
 * 있는 것(그림·PDF)만 담고 나머지는 무엇인지만 알려 준다. 5GB 짜리 압축 파일을
 * base64 로 대화에 넣는 일이 없어야 한다.
 */

import type { MemoBentoClient } from "./client.js";

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

/**
 * 응답 헤더에서 파일 이름을 읽는다.
 *
 * 예전에는 서버가 `X-MB-Name` 을 따로 붙였다. 암호화 파일은 내용이 무엇인지
 * 헤더로 알려 줘야 했기 때문이다. 이제는 평범한 파일이라 표준 헤더에 다 있다.
 */
function nameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* 아래로 */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(cd);
  return plain ? plain[1] : fallback;
}

/** 파일 하나를 받아 돌려준다. */
export async function fetchFile(
  client: MemoBentoClient,
  fileId: string,
): Promise<FetchedFile> {
  const res = await client.rawGet(`/api/files/${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다 (${res.status})`);

  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = (res.headers.get("content-type") || "application/octet-stream")
    .split(";")[0]
    .trim();
  return { name: nameFrom(res, fileId), mimeType, bytes };
}
