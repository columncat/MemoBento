import { resolve } from "node:path";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

import { db, schema } from "./db";
import { env } from "./env";

/**
 * MailBento 위젯 데이터(widget_state) 호환 레이어.
 *
 * MemoBento 의 시스템 예약 메모함 두 개가 이 JSON 을 그대로 읽고 쓴다.
 *   - Corkboard 메모함 ↔ pins   (링크 메모)
 *   - Memo 메모함      ↔ memos  (텍스트 메모)
 *
 * 저장 위치는 두 가지:
 *   1) MAILBENTO_DB_PATH 지정 → 그 SQLite 파일의 widget_state 를 직접 읽고 씀
 *      → MailBento 와 **실시간 양방향 동기화**
 *   2) 미지정 → MemoBento 자체 DB 의 widget_state (스키마 동일)
 *      → /settings 의 백업 JSON 으로 주고받음
 *
 * folders 는 MemoBento 가 쓰지 않지만 저장 시 **그대로 보존**한다
 * (MailBento 의 폴더 위젯 데이터를 지우지 않기 위해).
 */

export interface LegacyPin {
  id: string;
  url: string;
  title: string;
  iconUrl: string;
}

export interface LegacyMemo {
  id: string;
  text: string;
  createdAt: number;
}

export interface LegacyState {
  folders: unknown[];
  pins: LegacyPin[];
  memos: LegacyMemo[];
}

const ROW_ID = 1;

const EMPTY: LegacyState = { folders: [], pins: [], memos: [] };

export function isExternalLegacy(): boolean {
  return !!env.MAILBENTO_DB_PATH?.trim();
}

// ─────────────────────────────────────────────────────────────
//   외부 MailBento DB 연결 (지정된 경우에만)
// ─────────────────────────────────────────────────────────────

let _external: Database.Database | null = null;

function externalDb(): Database.Database {
  if (_external) return _external;
  const path = resolve(env.MAILBENTO_DB_PATH!.trim());
  const conn = new Database(path);
  conn.pragma("busy_timeout = 5000");
  // MailBento DB 라면 이미 존재한다. 경로가 비어 있는 경우를 대비한 방어적 생성
  // (컬럼 정의는 MailBento 스키마와 동일).
  conn.exec(
    `CREATE TABLE IF NOT EXISTS widget_state (
       id integer PRIMARY KEY NOT NULL,
       data text NOT NULL,
       updated_at integer DEFAULT (unixepoch()) NOT NULL
     )`,
  );
  _external = conn;
  return conn;
}

// ─────────────────────────────────────────────────────────────
//   read / write
// ─────────────────────────────────────────────────────────────

export function getLegacyState(): LegacyState {
  let raw: string | null = null;

  if (isExternalLegacy()) {
    try {
      const row = externalDb()
        .prepare("SELECT data FROM widget_state WHERE id = ?")
        .get(ROW_ID) as { data?: string } | undefined;
      raw = row?.data ?? null;
    } catch (err) {
      console.error("[memobento] MailBento DB 읽기 실패:", err);
      return { ...EMPTY };
    }
  } else {
    const row = db
      .select()
      .from(schema.widgetState)
      .where(eq(schema.widgetState.id, ROW_ID))
      .get();
    raw = row?.data ?? null;
  }

  if (!raw) return { ...EMPTY };
  try {
    return normalize(JSON.parse(raw) as Partial<LegacyState>);
  } catch {
    // 손상된 JSON → 빈 상태로 폴백 (덮어쓰지는 않음)
    return { ...EMPTY };
  }
}

export function setLegacyState(next: LegacyState): void {
  const data = JSON.stringify(normalize(next));

  if (isExternalLegacy()) {
    try {
      externalDb()
        .prepare(
          `INSERT INTO widget_state (id, data, updated_at)
           VALUES (?, ?, unixepoch())
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = unixepoch()`,
        )
        .run(ROW_ID, data);
    } catch (err) {
      console.error("[memobento] MailBento DB 쓰기 실패:", err);
    }
    return;
  }

  db.insert(schema.widgetState)
    .values({ id: ROW_ID, data })
    .onConflictDoUpdate({
      target: schema.widgetState.id,
      set: { data, updatedAt: new Date() },
    })
    .run();
}

/** 백업 불러오기 — MailBento 백업 JSON 의 widget 필드를 그대로 받는다. */
export function importLegacyState(input: unknown): LegacyState {
  const state = normalize((input ?? {}) as Partial<LegacyState>);
  setLegacyState(state);
  return state;
}

function normalize(parsed: Partial<LegacyState>): LegacyState {
  return {
    // MemoBento 는 folders 를 쓰지 않지만 MailBento 데이터를 보존하기 위해 통과시킨다.
    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    pins: Array.isArray(parsed.pins)
      ? parsed.pins.filter(isPin).map((p) => ({
          id: String(p.id),
          url: String(p.url),
          title: typeof p.title === "string" ? p.title : "",
          iconUrl: typeof p.iconUrl === "string" ? p.iconUrl : "",
        }))
      : [],
    memos: Array.isArray(parsed.memos)
      ? parsed.memos.filter(isMemo).map((m) => ({
          id: String(m.id),
          text: String(m.text),
          createdAt:
            typeof m.createdAt === "number" && Number.isFinite(m.createdAt)
              ? m.createdAt
              : 0,
        }))
      : [],
  };
}

function isPin(v: unknown): v is LegacyPin {
  return !!v && typeof v === "object" && "id" in v && "url" in v;
}

function isMemo(v: unknown): v is LegacyMemo {
  return !!v && typeof v === "object" && "id" in v && "text" in v;
}
