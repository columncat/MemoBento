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
