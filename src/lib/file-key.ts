import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db, schema } from "./db";

/**
 * 파일 암호화 키.
 *
 * 암·복호화는 전부 **브라우저**에서 한다. 서버는 키를 로그인한 클라이언트에
 * 내려주기만 하고, 디스크에는 암호문만 남는다. 따라서 Cloudflare 터널을 지나는
 * 바이트도, NAS 디스크에 놓이는 바이트도 평문이 아니다.
 *
 * 키가 이 DB 안에 있으므로 **디스크를 통째로 가져간 공격자**에게는 무력하다.
 * 이 장치의 목적은 저장 매체 도난 방어가 아니라 **전송 구간(중계자 포함) 노출
 * 차단**이다. 대신 백업/복구는 data 볼륨 하나로 끝난다.
 */

const KEY_NAME = "file_encryption_key";

/** base64 로 인코딩된 32바이트 키. 없으면 만들어 저장한다. */
export function getOrCreateFileKey(): string {
  const row = db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, KEY_NAME))
    .get();
  if (row?.value) return row.value;

  const value = randomBytes(32).toString("base64");
  db.insert(schema.appSecrets)
    .values({ key: KEY_NAME, value })
    .onConflictDoNothing()
    .run();

  // 동시에 두 요청이 들어와도 먼저 쓴 값을 쓴다
  const saved = db
    .select()
    .from(schema.appSecrets)
    .where(eq(schema.appSecrets.key, KEY_NAME))
    .get();
  return saved?.value ?? value;
}
