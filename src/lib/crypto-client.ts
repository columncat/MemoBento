/**
 * 브라우저 쪽 파일 암호화.
 *
 * 조각마다 독립적인 AES-256-GCM 레코드를 만든다:
 *   record = IV(12) || ciphertext || tag(16)
 *
 * 조각을 나눠 두는 이유는 두 가지다. (1) 5GB 파일을 메모리에 통째로 올리지
 * 않고 흘려보내려면 단위가 필요하고, (2) 내려받을 때도 같은 단위로 스트리밍
 * 복호화해야 하기 때문이다. AES-GCM 은 하드웨어 가속(AES-NI)을 타므로
 * 전송 속도에 의미 있는 손해가 없다.
 */

export const IV_LEN = 12;
export const TAG_LEN = 16;
export const GCM_OVERHEAD = IV_LEN + TAG_LEN;

let keyPromise: Promise<CryptoKey> | null = null;

/** 서버에서 키를 받아 CryptoKey 로 캐시한다 (탭당 1회). */
export function getFileKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const res = await fetch("/api/files/key", { cache: "no-store" });
      if (!res.ok) throw new Error("암호화 키를 가져오지 못했습니다");
      const { key } = (await res.json()) as { key: string };
      const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })().catch((e) => {
      keyPromise = null; // 다음 시도에서 다시 받도록
      throw e;
    });
  }
  return keyPromise;
}

/** 평문 조각 하나 → 레코드 하나. */
export async function encryptChunk(
  key: CryptoKey,
  plain: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plain as unknown as ArrayBuffer,
    ),
  );
  const out = new Uint8Array(IV_LEN + ct.byteLength);
  out.set(iv, 0);
  out.set(ct, IV_LEN);
  return out;
}

/** 레코드 하나 → 평문 조각. (뷰어에서 작은 파일을 직접 풀 때 사용) */
export async function decryptChunk(
  key: CryptoKey,
  record: Uint8Array,
): Promise<Uint8Array> {
  // subarray 는 ArrayBufferLike 로 넓어져 BufferSource 와 어긋난다 — 복사해 좁힌다
  const iv = new Uint8Array(record.subarray(0, IV_LEN));
  const ct = new Uint8Array(record.subarray(IV_LEN));
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ct,
    ),
  );
}
