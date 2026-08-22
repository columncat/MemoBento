import { createDecipheriv } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import { db, schema } from "./db";
import { resolveStored, uploadRoot } from "./file-store";

/**
 * 예전에 암호화해 둔 파일을 평문으로 되돌린다. **한 번만 도는 이관이다.**
 *
 * 파일은 조각마다 독립적인 AES-256-GCM 레코드로 저장돼 있었다:
 *   record = IV(12) ‖ ciphertext ‖ tag(16)
 * 조각 하나가 담는 평문은 `files.chunkSize` 바이트다.
 *
 * 암·복호화를 걷어내기로 했으므로, 코드를 지우기 **전에** 디스크에 있는 것을
 * 먼저 풀어야 한다. 순서를 뒤집으면 지금 있는 파일이 전부 못 읽는 바이트
 * 덩어리가 된다.
 *
 * 한 파일이라도 어긋나면 그 파일만 손대지 않고 넘어간다. 반쯤 쓴 것으로
 * 원본을 덮는 것이 가장 나쁘다 — 그러면 되돌릴 방법도 사라진다. 실패한 것은
 * `encrypted=1` 로 남으므로 다음 기동에 다시 시도한다.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const GCM_OVERHEAD = IV_LEN + TAG_LEN;

/** 키는 이관하는 동안만 필요하다. 다 풀고 나면 아무도 읽지 않는다. */
function fileKey(): Buffer | null {
  const row = db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, "file_encryption_key"))
    .get();
  return row?.value ? Buffer.from(row.value, "base64") : null;
}

/**
 * 암호문 파일 하나를 풀어 같은 자리에 놓는다.
 *
 * **마지막 레코드는 짧다.** 조각 크기는 나누는 단위일 뿐이고, 마지막 조각에는
 * 남은 만큼만 들어간다. 그래서 전체 크기가 `조각+28` 로 나눠떨어지리라 보면
 * 8MiB 보다 작은 파일은 전부 어긋난 것으로 읽힌다 — 처음에 그렇게 짰다가
 * 열한 개가 통째로 걸렸다.
 *
 * 평문 크기(`files.size`)를 알고 있으니 레코드 수를 셀 수 있다. 그 수와 실제
 * 파일 크기가 맞아떨어지는지로 형식을 확인한다.
 */
async function decryptInPlace(
  key: Buffer,
  relPath: string,
  chunkSize: number,
  plainSize: number,
): Promise<number> {
  const abs = resolveStored(relPath);
  if (!abs) throw new Error(`경로가 이상합니다: ${relPath}`);
  const total = (await stat(abs)).size;
  if (chunkSize <= 0) throw new Error("조각 크기를 모릅니다");

  const records = plainSize === 0 ? 0 : Math.ceil(plainSize / chunkSize);
  const expected = plainSize + records * GCM_OVERHEAD;
  if (total !== expected) {
    throw new Error(`크기가 맞지 않습니다 (${total}, ${expected} 이어야 함)`);
  }

  const tmpRel = `${relPath}.plain`;
  const tmpAbs = join(uploadRoot(), tmpRel);
  const src = await open(abs, "r");
  const dst = await open(tmpAbs, "w");
  let written = 0;
  try {
    const buf = Buffer.allocUnsafe(chunkSize + GCM_OVERHEAD);
    let off = 0;
    for (let i = 0; i < records; i += 1) {
      const plainLen = Math.min(chunkSize, plainSize - i * chunkSize);
      const recordSize = plainLen + GCM_OVERHEAD;
      const { bytesRead } = await src.read(buf, 0, recordSize, off);
      if (bytesRead !== recordSize) throw new Error("레코드를 다 읽지 못했습니다");
      off += recordSize;
      const iv = buf.subarray(0, IV_LEN);
      const body = buf.subarray(IV_LEN, recordSize - TAG_LEN);
      const tag = buf.subarray(recordSize - TAG_LEN);
      const d = createDecipheriv("aes-256-gcm", key, iv);
      d.setAuthTag(tag);
      // final() 이 여기서 던지면 태그가 안 맞는 것이다 — 위에서 잡아 건너뛴다.
      const plain = Buffer.concat([d.update(body), d.final()]);
      await dst.write(plain, 0, plain.length, written);
      written += plain.length;
    }
  } catch (e) {
    await dst.close().catch(() => undefined);
    await src.close().catch(() => undefined);
    await rm(tmpAbs, { force: true });
    throw e;
  }
  await dst.close();
  await src.close();
  // 다 풀린 것을 확인한 뒤에야 원본 자리로 옮긴다.
  await rename(tmpAbs, abs);
  return written;
}

/**
 * 남아 있는 암호문을 전부 푼다.
 *
 * 서버가 뜰 때 한 번 부른다. 남은 것이 없으면 세는 쿼리 하나로 끝난다.
 */
export function decryptStoredFiles(): void {
  const rows = db.select().from(schema.files).where(eq(schema.files.encrypted, 1)).all();
  if (rows.length === 0) return;

  const key = fileKey();
  if (!key) {
    console.error(
      `[memobento] 암호화된 파일이 ${rows.length}개 남았는데 키가 없습니다. 손대지 않습니다.`,
    );
    return;
  }

  console.log(`[memobento] 암호화된 파일 ${rows.length}개를 평문으로 되돌립니다…`);
  let done = 0;
  let failed = 0;

  void (async () => {
    for (const row of rows) {
      try {
        await decryptInPlace(key, row.path, row.chunkSize, row.size);
        // 썸네일도 같은 형식이다. 없거나 실패해도 본체를 되돌리는 것을 막지 않는다.
        if (row.thumbPath) {
          try {
            // 썸네일은 크기를 따로 적어 두지 않았다. 한 레코드에 담기는
            // 크기라, 파일에서 태그·IV 만큼 빼면 평문 길이가 나온다.
            const abs = resolveStored(row.thumbPath);
            const thumbTotal = abs ? (await stat(abs)).size : 0;
            await decryptInPlace(
              key,
              row.thumbPath,
              row.chunkSize,
              Math.max(0, thumbTotal - GCM_OVERHEAD),
            );
          } catch (e) {
            console.warn(
              `[memobento] 썸네일 ${row.thumbPath} 은 못 풀었습니다:`,
              e instanceof Error ? e.message : e,
            );
            db.update(schema.files)
              .set({ thumbPath: null })
              .where(eq(schema.files.id, row.id))
              .run();
          }
        }
        db.update(schema.files)
          .set({ encrypted: 0, chunkSize: 0 })
          .where(eq(schema.files.id, row.id))
          .run();
        done += 1;
      } catch (e) {
        failed += 1;
        console.error(
          `[memobento] ${row.name} (${row.id}) 을 못 풀었습니다 — 그대로 둡니다:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    console.log(
      `[memobento] 되돌리기 끝 — 성공 ${done}개` + (failed ? `, 실패 ${failed}개` : ""),
    );
  })();
}
