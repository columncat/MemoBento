import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 메모함 표시 방식. 메모함마다 개별 저장된다. */
export const VIEW_MODES = ["list", "grid"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * 시스템 예약 메모함 키.
 * 이 메모함들은 이름/삭제가 잠겨 있고, 내용은 MailBento 의 widget_state
 * (Corkboard 핀 / Memo 노트) 와 직접 동기화된다.
 */
export const SYSTEM_KEYS = ["corkboard", "memo"] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

/** 메모 종류. text/link 는 MailBento Memo/Corkboard 포맷과 1:1 대응. */
export const MEMO_TYPES = ["text", "link", "image", "pdf", "file"] as const;
export type MemoType = (typeof MEMO_TYPES)[number];

/** 첨부 파일 분류 — 확장자로 판별하며 열람 가능 여부를 결정한다. */
export const FILE_KINDS = ["image", "pdf", "text", "file"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const notebooks = sqliteTable("notebooks", {
  /** uid 문자열. 시스템 메모함은 "sys-corkboard" / "sys-memo" 고정. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** null 이면 사용자 메모함 (이름 변경·삭제 가능). */
  systemKey: text("system_key", { enum: SYSTEM_KEYS }),
  viewMode: text("view_mode", { enum: VIEW_MODES }).notNull().default("list"),
  /** 대시보드 그리드 위치 (낮은 숫자가 앞). */
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type NotebookRow = typeof notebooks.$inferSelect;

/**
 * 업로드된 원본 파일. 바이트는 UPLOAD_DIR 아래 디스크에 두고
 * 여기에는 메타데이터만 저장한다 (DB 비대화 방지 + 볼륨 백업으로 함께 보존).
 */
export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  /** 업로드 당시 원본 파일명 (표시용). */
  name: text("name").notNull(),
  /** 소문자 확장자, 점 없음. 빈 문자열 가능. */
  ext: text("ext").notNull().default(""),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  size: integer("size").notNull().default(0),
  kind: text("kind", { enum: FILE_KINDS }).notNull().default("file"),
  /** UPLOAD_DIR 기준 상대 경로. */
  path: text("path").notNull(),
  /** 썸네일 PNG 의 UPLOAD_DIR 기준 상대 경로 (없으면 아이콘 폴백). */
  thumbPath: text("thumb_path"),

  /**
   * 1 = 브라우저에서 AES-GCM 으로 암호화해 올린 파일.
   * 디스크에는 [IV(12) || ciphertext || tag(16)] 레코드가 chunkSize 단위로
   * 이어붙어 있고, 서버는 복호화하지 않는다 (Cloudflare 도 암호문만 본다).
   */
  encrypted: integer("encrypted").notNull().default(0),
  /** 암호화 레코드 하나가 담는 평문 바이트 수. encrypted=0 이면 0. */
  chunkSize: integer("chunk_size").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type FileRow = typeof files.$inferSelect;

export const memos = sqliteTable(
  "memos",
  {
    id: text("id").primaryKey(),
    notebookId: text("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    type: text("type", { enum: MEMO_TYPES }).notNull().default("text"),
    /** text 메모 본문. */
    text: text("text"),
    /** link 메모 제목 / 파일 메모의 표시 이름 (비우면 원본 파일명). */
    title: text("title"),
    /** link 메모 URL. */
    url: text("url"),
    /** link 메모 favicon. */
    iconUrl: text("icon_url"),
    /** image/pdf/file 메모의 첨부. */
    fileId: text("file_id").references(() => files.id, { onDelete: "set null" }),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    notebookIdx: index("memos_notebook_idx").on(t.notebookId),
  }),
);

export type MemoRow = typeof memos.$inferSelect;

/**
 * MailBento 호환 위젯 데이터 (folders / pins / memos) — 단일 행(id=1) JSON.
 * 스키마·컬럼명이 MailBento 와 동일하므로 백업 JSON 이 그대로 호환되고,
 * MAILBENTO_DB_PATH 로 MailBento DB 를 직접 가리키면 실시간 동기화된다.
 */
export const widgetState = sqliteTable("widget_state", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WidgetStateRow = typeof widgetState.$inferSelect;

/**
 * 앱이 보관하는 비밀값 — 지금은 파일 암호화 키 하나.
 * 키는 로그인한 클라이언트에만 내려가고, 암·복호화는 전부 브라우저에서 한다.
 */
export const appSecrets = sqliteTable("app_secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AppSecretRow = typeof appSecrets.$inferSelect;

/** 휴지통에 담기는 것의 종류. */
export const TRASH_KINDS = ["notebook", "memo"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/**
 * 삭제한 메모함·메모를 30일간 보관한다.
 *
 * 스냅샷(JSON)으로 담는 이유는 시스템 메모함의 메모가 MailBento 의
 * widget_state 에 살기 때문이다. 거기엔 "삭제됨" 표시를 넣을 자리가 없으므로
 * (넣으면 MailBento 가 그대로 읽어버린다) 지울 때 통째로 떠서 여기 옮긴다.
 * 첨부 파일은 만료 전까지 디스크에 그대로 두고 files 행도 남긴다 — 복원하면
 * 그대로 다시 붙는다.
 */
export const trash = sqliteTable("trash", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: TRASH_KINDS }).notNull(),
  /** 목록에 보여줄 이름. */
  label: text("label").notNull(),
  /** 메모라면 원래 있던 메모함 id (복원 대상). */
  notebookId: text("notebook_id"),
  /** 복원에 필요한 전체 스냅샷 JSON. */
  payload: text("payload").notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type TrashRow = typeof trash.$inferSelect;

/** 로그인 기록 — INSERT 전용 (앱에 DELETE 엔드포인트 없음). */
export const loginLog = sqliteTable("login_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  /** "manual" = 비밀번호 입력 로그인, "auto" = remember 쿠키로 자동 로그인. */
  type: text("type", { enum: ["manual", "auto"] }).notNull(),
  /** 0 = 실패 (비번 틀림 등), 1 = 성공. */
  success: integer("success").notNull(),
  userAgent: text("user_agent"),
});

export type LoginLog = typeof loginLog.$inferSelect;
