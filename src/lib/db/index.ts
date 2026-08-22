import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { env } from "../env";
import * as schema from "./schema";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * 지연 초기화 — DB 연결/마이그레이션은 첫 쿼리(런타임) 때 1회만 수행한다.
 * `next build` 의 page-data 수집 단계에서 모듈이 import 되어도 DB 파일을 열지 않으므로,
 * 병렬 빌드 워커가 WAL 설정(쓰기)으로 충돌해 "database is locked" 가 나던 문제를 막는다.
 */
let _db: DB | null = null;

function init(): DB {
  const dbPath = resolve(env.DATABASE_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000"); // 동시 접근 시 즉시 실패 대신 대기
  sqlite.pragma("foreign_keys = ON");

  const drizzleDb = drizzle(sqlite, { schema });

  try {
    const migrationsFolder =
      process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "drizzle");
    migrate(drizzleDb, { migrationsFolder });
  } catch (err) {
    console.error("[memobento] migration failed:", err);
  }

  /*
   * 예전에 암호화해 둔 파일을 평문으로 되돌리는 이관.
   *
   * 한 박자 미뤄 부른다. 지금은 `_db` 가 아직 채워지지 않아서, 이 안에서 db 를
   * 건드리면 init() 이 자기를 다시 부른다. 마이크로태스크는 이 함수가 끝나고
   * 대입까지 마친 뒤에 돈다.
   *
   * `instrumentation.ts` 를 쓰지 않는 이유는, 그 파일이 미들웨어(edge) 번들에도
   * 딸려 들어가 better-sqlite3 를 못 찾기 때문이다.
   */
  queueMicrotask(() => {
    void import("../decrypt-files")
      .then((m) => m.decryptStoredFiles())
      .catch((e) => console.error("[memobento] 파일 되돌리기 시작 실패:", e));
  });

  return drizzleDb;
}

function getDb(): DB {
  // Node 는 단일 스레드 + init() 은 동기이므로 경쟁 조건 없음.
  if (!_db) _db = init();
  return _db;
}

/** import 시점엔 연결하지 않고, 실제 사용(프로퍼티 접근) 때 초기화하는 프록시. */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
}) as DB;

export { schema };
