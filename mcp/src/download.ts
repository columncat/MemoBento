/**
 * 메모함에 올린 파일을 꺼내 읽는다.
 *
 * 받은 바이트를 그대로 돌려주지는 않는다. 도구 응답은 대화에 실리므로, 볼 수
 * 있는 것만 담고 나머지는 무엇인지만 알려 준다. 5GB 짜리 압축 파일을 base64 로
 * 대화에 넣는 일이 없어야 한다.
 */

import type { MemoBentoClient } from "./client.js";

/**
 * 그림으로 실어 보낼 최대 크기.
 *
 * base64 는 3바이트를 4글자로 부풀린다. 8MB 면 MCP 메시지 하나가 10.7MB 가 된다.
 * Claude Code 2.1.239 에서 그 크기(3200×1800 png 한 장)는 통과하고 모델이 그림을
 * 읽었다. 같은 조건에서 32MB 짜리 메시지는 연결이 끊겼다 — 그래서 한 결과에
 * 그림은 **한 장만** 싣는다.
 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * 그림으로 넘어가는 형식.
 *
 * Claude Code 는 MCP 결과의 그림 가운데 이 넷만 모델에게 그림으로 넘기고, 나머지
 * (bmp·svg·heic·tiff…)는 디스크에 저장한 뒤 경로만 글로 넘긴다. 파일 읽기 도구가
 * 없는 에이전트에게 그 경로는 쓸모가 없다. 그러니 이 밖의 형식은 보내지 않는다.
 */
const VIEWABLE_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface FetchedFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** 파일 이름의 소문자 확장자. 없으면 "". */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const i = base.lastIndexOf(".");
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : "";
}

/** 이름만 보고, 모델에게 그림으로 보낼 수 있는 형식이면 그 MIME. */
export function viewableImageMime(name: string): string | null {
  return IMAGE_MIME_BY_EXT[extOf(name)] ?? null;
}

/** 받은 응답의 MIME 이 그림으로 넘어가는 것인가. */
export function isViewableImage(mime: string): boolean {
  return VIEWABLE_IMAGE.has(mime);
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

function mimeOf(res: Response): string {
  return (res.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
}

/**
 * 바이트 머리로 그림 형식을 가린다. 모르면 null.
 *
 * 확장자도, 서버가 붙인 content-type 도 **이름에서 나온 것**이라 믿지 않는다.
 * 실측: 0바이트 `.png` 가 "원본을 보냈다" 로 성공해 빈 그림 블록이 모델에게 갔고,
 * PDF 바이트를 담은 `.png` 가 image/png 로 그대로 넘어갔다. 앞의 것은 모델이
 * "그림을 받았는데 아무것도 없다" 로 읽는 **없는 값을 있는 값으로 넘기는 자리**다.
 *
 * 모델에게 넘길 수 있는 넷(png·jpeg·gif·webp)만 가린다. 나머지는 어차피 못 넘긴다.
 */
export function sniffImageMime(b: Buffer): string | null {
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6) {
    const head = b.toString("latin1", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (
    b.length >= 12 &&
    b.toString("latin1", 0, 4) === "RIFF" &&
    b.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** 파일 하나를 받아 돌려준다. */
export async function fetchFile(
  client: MemoBentoClient,
  fileId: string,
): Promise<FetchedFile> {
  const res = await client.rawGet(`/api/files/${encodeURIComponent(fileId)}`);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다 (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { name: nameFrom(res, fileId), mimeType: mimeOf(res), bytes };
}

/**
 * 앱이 올릴 때 만들어 둔 미리보기를 받는다. 없으면 null.
 *
 * 미리보기는 **브라우저가 업로드 전에** 그린다 — 긴 변 400px 이하의 webp(안 되면
 * png)이고, PDF 는 첫 쪽이다. 브라우저가 못 여는 형식이거나 앱 화면을 거치지
 * 않고 들어온 파일에는 없다.
 */
export async function fetchThumb(
  client: MemoBentoClient,
  fileId: string,
): Promise<FetchedFile | null> {
  const res = await client.rawGet(`/api/files/${encodeURIComponent(fileId)}/thumb`);
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.ok) throw new Error(`미리보기를 받지 못했습니다 (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { name: "thumbnail", mimeType: mimeOf(res), bytes };
}
