import { asc, eq, lt } from "drizzle-orm";

import { db, schema } from "./db";
import type { MemoType, ViewMode } from "./db/schema";
import { removeStored } from "./file-store";
import { getLegacyState, setLegacyState } from "./legacy-store";
import { uid } from "./uid";

/**
 * 30일 휴지통.
 *
 * 지운 메모함·메모를 스냅샷으로 담아두고 그 기간 안에는 되살릴 수 있다.
 * 첨부 파일은 만료 전까지 디스크에 그대로 두고 files 행도 남긴다 — 복원하면
 * 같은 파일이 다시 붙는다. 만료되면 그때 파일까지 지운다.
 */

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface TrashEntry {
  id: string;
  kind: "notebook" | "memo";
  label: string;
  notebookName: string | null;
  deletedAt: number;
  /** 자동 삭제까지 남은 일수. */
  daysLeft: number;
  /** 메모라면 원래 메모함이 아직 있는가 (없으면 먼저 메모함을 복원해야 함). */
  restorable: boolean;
}

interface MemoSnapshot {
  /** 레거시(widget_state)에 살던 메모인가. */
  legacy: boolean;
  /** 레거시라면 pins/memos 중 어디였는지. */
  legacyStore?: "pins" | "memos";
  /** 원래 배열에서의 위치 — 복원 시 같은 자리에 넣는다. */
  legacyIndex?: number;
  legacyItem?: unknown;
  row?: {
    id: string;
    notebookId: string;
    type: MemoType;
    text: string | null;
    title: string | null;
    url: string | null;
    iconUrl: string | null;
    fileId: string | null;
    position: number;
    createdAt: number;
  };
}

interface NotebookSnapshot {
  notebook: {
    id: string;
    name: string;
    viewMode: ViewMode;
    position: number;
    createdAt: number;
  };
  memos: NonNullable<MemoSnapshot["row"]>[];
}

// ─────────────────────────────────────────────────────────────
//   담기
// ─────────────────────────────────────────────────────────────

/** 사용자 메모함을 통째로 휴지통에 넣는다 (시스템 메모함은 호출부에서 막는다). */
export function trashNotebook(notebookId: string): void {
  const nb = db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.id, notebookId))
    .get();
  if (!nb) throw new Error("메모함을 찾을 수 없습니다");

  const rows = db
    .select()
    .from(schema.memos)
    .where(eq(schema.memos.notebookId, notebookId))
    .all();

  const snapshot: NotebookSnapshot = {
    notebook: {
      id: nb.id,
      name: nb.name,
      viewMode: nb.viewMode,
      position: nb.position,
      createdAt: nb.createdAt.getTime(),
    },
    memos: rows.map((m) => ({
      id: m.id,
      notebookId: m.notebookId,
      type: m.type,
      text: m.text,
      title: m.title,
      url: m.url,
      iconUrl: m.iconUrl,
      fileId: m.fileId,
      position: m.position,
      createdAt: m.createdAt.getTime(),
    })),
  };

  db.insert(schema.trash)
    .values({
      id: uid(),
      kind: "notebook",
      label: nb.name,
      notebookId: null,
      payload: JSON.stringify(snapshot),
    })
    .run();

  // memos 는 FK CASCADE 로 함께 사라진다. files 행과 디스크는 만료까지 그대로 둔다.
  db.delete(schema.notebooks).where(eq(schema.notebooks.id, notebookId)).run();
}

/** 메모 하나를 휴지통에 넣는다. */
export function trashMemo(
  memoId: string,
  location: { store: "db" | "pins" | "memos"; notebookId: string },
  label: string,
): void {
  let snapshot: MemoSnapshot;

  if (location.store === "db") {
    const m = db
      .select()
      .from(schema.memos)
      .where(eq(schema.memos.id, memoId))
      .get();
    if (!m) throw new Error("메모를 찾을 수 없습니다");
    snapshot = {
      legacy: false,
      row: {
        id: m.id,
        notebookId: m.notebookId,
        type: m.type,
        text: m.text,
        title: m.title,
        url: m.url,
        iconUrl: m.iconUrl,
        fileId: m.fileId,
        position: m.position,
        createdAt: m.createdAt.getTime(),
      },
    };
    db.delete(schema.memos).where(eq(schema.memos.id, memoId)).run();
  } else {
    const state = getLegacyState();
    const list = location.store === "pins" ? state.pins : state.memos;
    const index = list.findIndex((x) => x.id === memoId);
    if (index < 0) throw new Error("메모를 찾을 수 없습니다");
    snapshot = {
      legacy: true,
      legacyStore: location.store,
      legacyIndex: index,
      legacyItem: list[index],
    };
    if (location.store === "pins") {
      state.pins = state.pins.filter((p) => p.id !== memoId);
    } else {
      state.memos = state.memos.filter((m) => m.id !== memoId);
    }
    setLegacyState(state);
  }

  db.insert(schema.trash)
    .values({
      id: uid(),
      kind: "memo",
      label: label.slice(0, 120) || "(제목 없음)",
      notebookId: location.notebookId,
      payload: JSON.stringify(snapshot),
    })
    .run();
}

// ─────────────────────────────────────────────────────────────
//   보기 / 되살리기 / 비우기
// ─────────────────────────────────────────────────────────────

export function listTrash(): TrashEntry[] {
  purgeExpired();

  const rows = db
    .select()
    .from(schema.trash)
    .orderBy(asc(schema.trash.deletedAt))
    .all();

  const names = new Map(
    db
      .select()
      .from(schema.notebooks)
      .all()
      .map((n) => [n.id, n.name]),
  );

  return rows.map((r) => {
    const deletedAt = r.deletedAt.getTime();
    const left = Math.max(
      0,
      Math.ceil((deletedAt + RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    return {
      id: r.id,
      kind: r.kind,
      label: r.label,
      notebookName: r.notebookId ? (names.get(r.notebookId) ?? null) : null,
      deletedAt,
      daysLeft: left,
      restorable: r.kind === "notebook" || !!(r.notebookId && names.has(r.notebookId)),
    };
  });
}

export function restoreFromTrash(trashId: string): void {
  const row = db
    .select()
    .from(schema.trash)
    .where(eq(schema.trash.id, trashId))
    .get();
  if (!row) throw new Error("휴지통 항목을 찾을 수 없습니다");

  if (row.kind === "notebook") {
    const snap = JSON.parse(row.payload) as NotebookSnapshot;
    db.insert(schema.notebooks)
      .values({
        id: snap.notebook.id,
        name: snap.notebook.name,
        viewMode: snap.notebook.viewMode,
        position: snap.notebook.position,
        createdAt: new Date(snap.notebook.createdAt),
      })
      .onConflictDoNothing()
      .run();
    for (const m of snap.memos) {
      db.insert(schema.memos)
        .values({ ...m, createdAt: new Date(m.createdAt) })
        .onConflictDoNothing()
        .run();
    }
  } else {
    const snap = JSON.parse(row.payload) as MemoSnapshot;
    if (snap.legacy) {
      const state = getLegacyState();
      const list = snap.legacyStore === "pins" ? state.pins : state.memos;
      const at = Math.min(snap.legacyIndex ?? list.length, list.length);
      list.splice(at, 0, snap.legacyItem as never);
      if (snap.legacyStore === "pins") state.pins = list as typeof state.pins;
      else state.memos = list as typeof state.memos;
      setLegacyState(state);
    } else if (snap.row) {
      const target = db
        .select()
        .from(schema.notebooks)
        .where(eq(schema.notebooks.id, snap.row.notebookId))
        .get();
      if (!target) {
        throw new Error("원래 메모함이 없습니다 — 메모함을 먼저 복원하세요");
      }
      db.insert(schema.memos)
        .values({ ...snap.row, createdAt: new Date(snap.row.createdAt) })
        .onConflictDoNothing()
        .run();
    }
  }

  db.delete(schema.trash).where(eq(schema.trash.id, trashId)).run();
}

/** 항목 하나를 지금 영구 삭제 (파일까지). */
export async function purgeOne(trashId: string): Promise<void> {
  const row = db
    .select()
    .from(schema.trash)
    .where(eq(schema.trash.id, trashId))
    .get();
  if (!row) return;
  await removeFilesOf(row.kind, row.payload);
  db.delete(schema.trash).where(eq(schema.trash.id, trashId)).run();
}

/** 만료된 항목 정리. 목록을 볼 때마다 한 번씩 돈다. */
export function purgeExpired(): void {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const rows = db
    .select()
    .from(schema.trash)
    .where(lt(schema.trash.deletedAt, cutoff))
    .all();
  for (const r of rows) {
    void removeFilesOf(r.kind, r.payload);
    db.delete(schema.trash).where(eq(schema.trash.id, r.id)).run();
  }
}

/** 스냅샷이 붙들고 있던 파일들을 실제로 지운다. */
async function removeFilesOf(kind: string, payload: string): Promise<void> {
  let fileIds: string[] = [];
  try {
    if (kind === "notebook") {
      const snap = JSON.parse(payload) as NotebookSnapshot;
      fileIds = snap.memos.map((m) => m.fileId).filter((v): v is string => !!v);
    } else {
      const snap = JSON.parse(payload) as MemoSnapshot;
      if (snap.row?.fileId) fileIds = [snap.row.fileId];
    }
  } catch {
    return;
  }

  for (const fid of fileIds) {
    const f = db
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fid))
      .get();
    if (!f) continue;
    await removeStored(f.path, f.thumbPath);
    db.delete(schema.files).where(eq(schema.files.id, fid)).run();
  }
}
