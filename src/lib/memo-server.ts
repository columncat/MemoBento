import { asc, desc, eq } from "drizzle-orm";

import { db, schema } from "./db";
import {
  MEMO_COLORS,
  MEMO_TYPES,
  NOTEBOOK_KINDS,
  type MemoColor,
  type MemoType,
  type NotebookKind,
  type SystemKey,
  type ViewMode,
} from "./db/schema";
import {
  getLegacyState,
  setLegacyState,
  type LegacyMemo,
  type LegacyPin,
  type LegacyState,
} from "./legacy-store";
import {
  normalizeRecurrence,
  withLegacyAnchor,
  type Recurrence,
} from "./recurrence";
import { trashMemo, trashNotebook } from "./trash";
import type { FileDTO, MemoDTO, NotebookDTO } from "./types";
import { autoIconUrl, hostnameOf } from "./types";
import { uid } from "./uid";

/**
 * 메모함/메모의 단일 진입점.
 *
 * 두 저장소를 하나의 API 로 합친다:
 *   - SQLite (notebooks / memos / files)  — 사용자 메모함 + 모든 파일 메모
 *   - widget_state JSON (legacy-store)    — 시스템 예약 메모함의 텍스트/링크 메모
 *
 * 시스템 메모함에 들어온 메모 중 레거시 포맷으로 표현 가능한 것만 JSON 으로 가고
 * (Corkboard→링크, Memo→텍스트), 나머지(이미지·PDF·파일 등)는 DB 에 저장된다.
 * 덕분에 MailBento 쪽 데이터 구조를 깨지 않으면서 같은 메모함에 파일도 넣을 수 있다.
 */

export const SYSTEM_NOTEBOOKS: {
  id: string;
  systemKey: SystemKey;
  name: string;
  position: number;
  kind: NotebookKind;
  /** 처음 만들 때 접어 둘지. 이후에는 사용자가 정한다. */
  hidden?: boolean;
}[] = [
  { id: "sys-corkboard", systemKey: "corkboard", name: "Corkboard", position: 0, kind: "memo" },
  { id: "sys-memo", systemKey: "memo", name: "Memo", position: 1, kind: "memo" },
  /**
   * 에이전트가 쓰라고 미리 만들어 두는 자리. MailBento 와 무관하게 이 앱의
   * DB 에 그대로 산다. 사람이 늘 보고 싶은 것은 아니라서 접어 둔 채로 만든다 —
   * 접기는 언제든 풀 수 있다.
   */
  { id: "sys-agent-memory", systemKey: "agent-memory", name: "Memory for Agents", position: 900, kind: "memo", hidden: true },
  { id: "sys-agent-schedule", systemKey: "agent-schedule", name: "Schedule for Agents", position: 901, kind: "schedule", hidden: true },
  /**
   * 밖에서 들어온 파일이 먼저 놓이는 자리.
   *
   * 예전에는 Discord 로 온 첨부를 봇의 디스크 폴더에 놓아 두고 여섯 시간 뒤
   * 지웠다. 에이전트가 그 사이에 "어느 메모함에 넣을까요" 를 묻고 답을 받아야
   * 살아남는 구조라, 대화가 거기서 끊기면 파일이 그냥 사라졌다.
   *
   * 이제 받는 즉시 여기 놓인다. 어디로 갈지는 나중에 정하면 되고, 정하지
   * 않아도 잃어버리지 않는다. 앞의 둘과 달리 접어 두지 않는다 — 사용자가 방금
   * 보낸 것이 어디 갔는지 보여야 한다.
   */
  { id: "sys-agent-inbox", systemKey: "agent-inbox", name: "Inbox", position: 899, kind: "memo" },
];

/**
 * 메모함이 받아들이는 메모 종류.
 *
 * 시스템 예약 메모함은 MailBento 의 데이터 구조를 그대로 쓰기 때문에 담을 수
 * 있는 것이 정해져 있다 — Corkboard 는 링크만, Memo 는 텍스트만. 새로 만드는
 * 것도, 다른 메모함에서 옮겨오는 것도 이 규칙을 따른다.
 */
export function acceptedTypes(
  systemKey: SystemKey | null,
  kind: NotebookKind = "memo",
): MemoType[] {
  // MailBento 자료구조를 쓰는 둘만 제한된다. agent-* 는 평범한 메모함이다.
  if (systemKey === "corkboard") return ["link"];
  if (systemKey === "memo") return ["text"];
  // 체크리스트·TODO 는 한 줄짜리 항목만 담는다 (파일·링크는 받지 않음)
  if (kind === "checklist" || kind === "todo" || kind === "schedule") {
    return ["text"];
  }
  return [...MEMO_TYPES];
}

export class InvalidRecurrenceError extends Error {
  constructor() {
    super("반복 주기를 알아볼 수 없습니다");
    this.name = "InvalidRecurrenceError";
  }
}

export class MemoTypeNotAllowedError extends Error {
  constructor(notebookName: string, accepted: MemoType[]) {
    const what = accepted.includes("link") ? "링크" : "텍스트";
    super(`"${notebookName}" 메모함에는 ${what} 항목만 넣을 수 있습니다`);
    this.name = "MemoTypeNotAllowedError";
  }
}

function assertAccepts(
  nb: { name: string; systemKey: SystemKey | null; kind?: NotebookKind },
  type: MemoType,
): void {
  const accepted = acceptedTypes(nb.systemKey, nb.kind ?? "memo");
  if (!accepted.includes(type)) {
    throw new MemoTypeNotAllowedError(nb.name, accepted);
  }
}

/** 이 (메모함, 메모타입) 조합이 레거시 JSON 으로 저장되는가. */
function legacyTargetOf(
  systemKey: SystemKey | null,
  type: MemoType,
): "pins" | "memos" | null {
  if (systemKey === "corkboard" && type === "link") return "pins";
  if (systemKey === "memo" && type === "text") return "memos";
  return null;
}

// ─────────────────────────────────────────────────────────────
//   조회
// ─────────────────────────────────────────────────────────────

export function ensureSystemNotebooks(): void {
  for (const nb of SYSTEM_NOTEBOOKS) {
    db.insert(schema.notebooks)
      .values({
        id: nb.id,
        name: nb.name,
        systemKey: nb.systemKey,
        kind: nb.kind,
        viewMode: "list",
        position: nb.position,
        hidden: nb.hidden ? 1 : 0,
      })
      .onConflictDoNothing()
      .run();

    /*
     * 종류는 여기서 정하는 값이라 어긋나면 되돌린다.
     *
     * 사용자 메모함은 종류를 바꿀 수 없지만 예약 메모함의 종류는 우리가 정의하는
     * 것이다. onConflictDoNothing 만 두면 이미 만들어진 곳에서는 옛 종류가 그대로
     * 남아, 코드가 바뀌어도 화면이 따라오지 않는다.
     * 접힘 여부와 이름은 건드리지 않는다 — 그건 사용자 몫이다.
     */
    const row = getNotebook(nb.id);
    if (row && row.kind !== nb.kind) {
      db.update(schema.notebooks)
        .set({ kind: nb.kind, updatedAt: new Date() })
        .where(eq(schema.notebooks.id, nb.id))
        .run();
    }
  }
}

export function listNotebooks(): NotebookDTO[] {
  ensureSystemNotebooks();

  const rows = db
    .select()
    .from(schema.notebooks)
    // 접어 둔 메모함은 순서와 무관하게 늘 맨 뒤로 간다
    .orderBy(
      asc(schema.notebooks.hidden),
      asc(schema.notebooks.position),
      asc(schema.notebooks.createdAt),
    )
    .all();

  const legacy = getLegacyState();
  const dbMemos = loadDbMemos();

  return rows.map((nb) => {
    const own = dbMemos.get(nb.id) ?? [];
    const memos: MemoDTO[] =
      nb.systemKey === "corkboard"
        ? [...legacy.pins.map((p) => pinToDto(p, nb.id)), ...own]
        : nb.systemKey === "memo"
          ? [...legacy.memos.map((m) => legacyMemoToDto(m, nb.id)), ...own]
          : own;

    return {
      id: nb.id,
      name: nb.name,
      systemKey: nb.systemKey ?? null,
      hidden: nb.hidden === 1,
      viewMode: nb.viewMode,
      position: nb.position,
      kind: nb.kind,
      accepts: acceptedTypes(nb.systemKey ?? null, nb.kind),
      memos,
    };
  });
}

/** 컬럼에 든 JSON 을 안전한 규칙으로. 깨졌으면 null. */
function parseRecurrenceColumn(raw: string | null): Recurrence | null {
  if (!raw) return null;
  try {
    const rule = normalizeRecurrence(JSON.parse(raw));
    // anchor 가 없던 시절 규칙은 from 이 기준일을 겸했다 — 그대로 굳혀 준다
    return rule ? withLegacyAnchor(rule) : null;
  } catch {
    return null;
  }
}

/** notebookId → DB 메모 (최신순). */
function loadDbMemos(): Map<string, MemoDTO[]> {
  const rows = db
    .select()
    .from(schema.memos)
    .leftJoin(schema.files, eq(schema.memos.fileId, schema.files.id))
    .orderBy(asc(schema.memos.position), desc(schema.memos.createdAt))
    .all();

  const out = new Map<string, MemoDTO[]>();
  for (const r of rows) {
    const list = out.get(r.memos.notebookId) ?? [];
    list.push({
      id: r.memos.id,
      notebookId: r.memos.notebookId,
      type: r.memos.type,
      text: r.memos.text,
      title: r.memos.title,
      url: r.memos.url,
      iconUrl: r.memos.iconUrl,
      file: r.files ? toFileDto(r.files) : null,
      done: r.memos.done === 1,
      dueAt: r.memos.dueAt ? r.memos.dueAt.getTime() : null,
      recurrence: parseRecurrenceColumn(r.memos.recurrence),
      color: r.memos.color,
      createdAt: r.memos.createdAt.getTime(),
      updatedAt: r.memos.updatedAt.getTime(),
      legacy: false,
    });
    out.set(r.memos.notebookId, list);
  }
  return out;
}

function toFileDto(f: typeof schema.files.$inferSelect): FileDTO {
  return {
    id: f.id,
    name: f.name,
    ext: f.ext,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    hasThumb: !!f.thumbPath,
    encrypted: f.encrypted === 1,
  };
}

function pinToDto(p: LegacyPin, notebookId: string): MemoDTO {
  return {
    id: p.id,
    notebookId,
    type: "link",
    text: null,
    title: p.title || hostnameOf(p.url),
    url: p.url,
    iconUrl: p.iconUrl || autoIconUrl(p.url),
    file: null,
    done: false,
    dueAt: null,
    recurrence: null,
    color: null,
    createdAt: 0,
    updatedAt: 0,
    legacy: true,
  };
}

function legacyMemoToDto(m: LegacyMemo, notebookId: string): MemoDTO {
  return {
    id: m.id,
    notebookId,
    type: "text",
    text: m.text,
    title: null,
    url: null,
    iconUrl: null,
    file: null,
    done: false,
    dueAt: null,
    recurrence: null,
    color: null,
    createdAt: m.createdAt,
    updatedAt: m.createdAt,
    legacy: true,
  };
}

// ─────────────────────────────────────────────────────────────
//   메모함 CRUD
// ─────────────────────────────────────────────────────────────

export function getNotebook(id: string) {
  return db
    .select()
    .from(schema.notebooks)
    .where(eq(schema.notebooks.id, id))
    .get();
}

export function createNotebook(
  name: string,
  kind: NotebookKind = "memo",
  viewMode: ViewMode = "list",
) {
  ensureSystemNotebooks();
  const all = db.select().from(schema.notebooks).all();
  const nextPos = all.reduce((m, n) => Math.max(m, n.position), -1) + 1;
  const id = uid();
  db.insert(schema.notebooks)
    .values({
      id,
      name: name.trim() || "새 메모함",
      kind,
      // 체크리스트·TODO 는 그리드로 볼 이유가 없다
      viewMode: kind === "memo" ? viewMode : "list",
      position: nextPos,
    })
    .run();
  return id;
}

export class NotebookLockedError extends Error {
  constructor() {
    super("시스템 예약 메모함은 이름을 바꾸거나 삭제할 수 없습니다");
    this.name = "NotebookLockedError";
  }
}

export function updateNotebook(
  id: string,
  patch: { name?: string; viewMode?: ViewMode; hidden?: boolean },
): void {
  const nb = getNotebook(id);
  if (!nb) throw new Error("메모함을 찾을 수 없습니다");

  // 시스템 메모함은 이름만 잠긴다. 보기 방식과 접기는 바꿀 수 있다.
  if (patch.name !== undefined && nb.systemKey) throw new NotebookLockedError();

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("이름을 비울 수 없습니다");
    set.name = name;
  }
  if (patch.viewMode !== undefined) set.viewMode = patch.viewMode;
  if (patch.hidden !== undefined) {
    set.hidden = patch.hidden ? 1 : 0;
    if (patch.hidden) {
      // 접으면 맨 뒤로 보낸다. 나중에 펼쳤을 때 목록 한가운데로 튀어나오지
      // 않고 뒤쪽에 그대로 남아 있게.
      const max = db
        .select({ p: schema.notebooks.position })
        .from(schema.notebooks)
        .orderBy(desc(schema.notebooks.position))
        .limit(1)
        .get();
      set.position = (max?.p ?? 0) + 1;
    }
  }

  db.update(schema.notebooks)
    .set(set)
    .where(eq(schema.notebooks.id, id))
    .run();
}

/**
 * 메모함 삭제 — 실제로 지우지 않고 30일 휴지통으로 옮긴다.
 * 첨부 파일도 만료 전까지 남으므로 복원하면 그대로 붙는다.
 */
export function deleteNotebook(id: string): void {
  const nb = getNotebook(id);
  if (!nb) throw new Error("메모함을 찾을 수 없습니다");
  if (nb.systemKey) throw new NotebookLockedError();
  trashNotebook(id);
}

export function reorderNotebooks(orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    db.update(schema.notebooks)
      .set({ position: i, updatedAt: new Date() })
      .where(eq(schema.notebooks.id, id))
      .run();
  });
}

// ─────────────────────────────────────────────────────────────
//   메모 CRUD
// ─────────────────────────────────────────────────────────────

export interface CreateMemoInput {
  notebookId: string;
  type: MemoType;
  text?: string | null;
  title?: string | null;
  url?: string | null;
  iconUrl?: string | null;
  fileId?: string | null;
  /** TODO 기한 (unix ms). 만들면서 바로 넣는다 — 만들고 고치면 요청이 둘이 된다. */
  dueAt?: number | null;
}

export function createMemo(input: CreateMemoInput): string {
  const nb = getNotebook(input.notebookId);
  if (!nb) throw new Error("메모함을 찾을 수 없습니다");
  assertAccepts(
    { name: nb.name, systemKey: nb.systemKey ?? null, kind: nb.kind },
    input.type,
  );

  const target = legacyTargetOf(nb.systemKey ?? null, input.type);

  if (target === "pins") {
    const url = (input.url ?? "").trim();
    if (!url) throw new Error("URL 이 필요합니다");
    const state = getLegacyState();
    const id = uid();
    // MailBento Corkboard 와 동일하게 뒤에 추가
    state.pins = [
      ...state.pins,
      {
        id,
        url,
        title: (input.title ?? "").trim() || hostnameOf(url),
        iconUrl: input.iconUrl?.trim() || autoIconUrl(url),
      },
    ];
    setLegacyState(state);
    return id;
  }

  if (target === "memos") {
    const text = (input.text ?? "").trim();
    if (!text) throw new Error("내용이 비어 있습니다");
    const state = getLegacyState();
    const id = uid();
    // MailBento Memo 와 동일하게 앞에 추가 (최신이 위)
    state.memos = [{ id, text, createdAt: Date.now() }, ...state.memos];
    setLegacyState(state);
    return id;
  }

  // 새 메모는 맨 앞에. position 을 전부 0 으로 두면 정렬이 불안정해진다.
  const minPos = db
    .select()
    .from(schema.memos)
    .where(eq(schema.memos.notebookId, input.notebookId))
    .all()
    .reduce((m, r) => Math.min(m, r.position), 0);

  const id = uid();
  db.insert(schema.memos)
    .values({
      id,
      notebookId: input.notebookId,
      type: input.type,
      text: input.text ?? null,
      title: input.title ?? null,
      url: input.url ?? null,
      iconUrl: input.iconUrl ?? null,
      fileId: input.fileId ?? null,
      dueAt: input.dueAt != null ? new Date(input.dueAt) : null,
      position: minPos - 1,
    })
    .run();
  return id;
}

export interface MemoLocation {
  store: "db" | "pins" | "memos";
  notebookId: string;
}

/** 메모 id 가 어느 저장소에 있는지 찾는다. */
export function locateMemo(id: string): MemoLocation | null {
  const row = db
    .select()
    .from(schema.memos)
    .where(eq(schema.memos.id, id))
    .get();
  if (row) return { store: "db", notebookId: row.notebookId };

  const state = getLegacyState();
  if (state.pins.some((p) => p.id === id)) {
    return { store: "pins", notebookId: "sys-corkboard" };
  }
  if (state.memos.some((m) => m.id === id)) {
    return { store: "memos", notebookId: "sys-memo" };
  }
  return null;
}

export interface UpdateMemoInput {
  text?: string;
  title?: string;
  /** 링크 URL. null 또는 빈 문자열이면 해제. */
  url?: string | null;
  /** 체크리스트·TODO 완료 표시. */
  done?: boolean;
  /** TODO 기한 (unix ms). null 이면 해제. */
  dueAt?: number | null;
  /** 반복 일정 규칙. null 이면 해제. */
  recurrence?: unknown;
  /** 글자 색. null 이면 기본색으로 되돌린다. */
  color?: MemoColor | null;
  /** 다른 메모함으로 이동. */
  notebookId?: string;
}

export function updateMemo(id: string, patch: UpdateMemoInput): void {
  const loc = locateMemo(id);
  if (!loc) throw new Error("메모를 찾을 수 없습니다");

  const moving =
    patch.notebookId !== undefined && patch.notebookId !== loc.notebookId;

  if (loc.store === "db") {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.text !== undefined) set.text = patch.text;
    if (patch.title !== undefined) set.title = patch.title.trim() || null;
    if (patch.url !== undefined) {
      const url = patch.url?.trim() || null;
      set.url = url;
      set.iconUrl = url ? autoIconUrl(url) : null;
    }
    if (patch.done !== undefined) set.done = patch.done ? 1 : 0;
    if (patch.dueAt !== undefined) {
      set.dueAt = patch.dueAt === null ? null : new Date(patch.dueAt);
    }
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.recurrence !== undefined) {
      if (patch.recurrence === null) {
        set.recurrence = null;
      } else {
        // 알아볼 수 없는 규칙은 거절한다. 조용히 null 로 두면 잘못된 요청 한 번에
        // 멀쩡하던 반복 설정이 지워진다.
        const rule = normalizeRecurrence(patch.recurrence);
        if (!rule) throw new InvalidRecurrenceError();
        set.recurrence = JSON.stringify(rule);
      }
    }
    db.update(schema.memos).set(set).where(eq(schema.memos.id, id)).run();
    if (moving) moveDbMemo(id, patch.notebookId!);
    return;
  }

  // 레거시(JSON) 메모 편집 — 저장 즉시 MailBento 쪽에도 반영된다.
  const state = getLegacyState();
  if (loc.store === "pins") {
    state.pins = state.pins.map((p) =>
      p.id === id
        ? {
            ...p,
            title: patch.title !== undefined ? patch.title.trim() : p.title,
            // Corkboard 핀은 URL 이 본체라 빈 값으로 지울 수 없다 — 기존 값 유지
            url: patch.url?.trim() || p.url,
            iconUrl: patch.url?.trim() ? autoIconUrl(patch.url.trim()) : p.iconUrl,
          }
        : p,
    );
  } else {
    state.memos = state.memos.map((m) =>
      m.id === id
        ? { ...m, text: patch.text !== undefined ? patch.text : m.text }
        : m,
    );
  }
  setLegacyState(state);

  if (moving) moveLegacyMemo(id, loc, patch.notebookId!);
}

/** DB 메모를 다른 메모함으로. 대상이 시스템 메모함이면 레거시 JSON 으로 승격한다. */
function moveDbMemo(id: string, toNotebookId: string): void {
  const target = getNotebook(toNotebookId);
  if (!target) throw new Error("대상 메모함을 찾을 수 없습니다");

  const row = db
    .select()
    .from(schema.memos)
    .where(eq(schema.memos.id, id))
    .get();
  if (!row) return;
  assertAccepts(
    { name: target.name, systemKey: target.systemKey ?? null, kind: target.kind },
    row.type,
  );

  const legacyTarget = legacyTargetOf(target.systemKey ?? null, row.type);
  if (!legacyTarget) {
    db.update(schema.memos)
      .set({ notebookId: toNotebookId, updatedAt: new Date() })
      .where(eq(schema.memos.id, id))
      .run();
    return;
  }

  const state = getLegacyState();
  if (legacyTarget === "pins" && row.url) {
    state.pins = [
      ...state.pins,
      {
        id: row.id,
        url: row.url,
        title: row.title || hostnameOf(row.url),
        iconUrl: row.iconUrl || autoIconUrl(row.url),
      },
    ];
  } else if (legacyTarget === "memos" && row.text) {
    state.memos = [
      { id: row.id, text: row.text, createdAt: row.createdAt.getTime() },
      ...state.memos,
    ];
  } else {
    // 레거시로 옮길 수 없는 형태 → DB 에 둔 채로 소속만 변경
    db.update(schema.memos)
      .set({ notebookId: toNotebookId, updatedAt: new Date() })
      .where(eq(schema.memos.id, id))
      .run();
    return;
  }
  setLegacyState(state);
  db.delete(schema.memos).where(eq(schema.memos.id, id)).run();
}

/** 레거시 메모를 다른 메모함으로. 목적지가 일반 메모함이면 DB 로 내린다. */
function moveLegacyMemo(
  id: string,
  from: MemoLocation,
  toNotebookId: string,
): void {
  const target = getNotebook(toNotebookId);
  if (!target) throw new Error("대상 메모함을 찾을 수 없습니다");

  const state = getLegacyState();
  const pin = state.pins.find((p) => p.id === id);
  const note = state.memos.find((m) => m.id === id);
  const type: MemoType = from.store === "pins" ? "link" : "text";

  // 목적지에서도 같은 레거시 배열에 속한다면 이동할 필요가 없다.
  if (legacyTargetOf(target.systemKey ?? null, type) === from.store) return;
  assertAccepts(
    { name: target.name, systemKey: target.systemKey ?? null, kind: target.kind },
    type,
  );

  // JSON → DB
  if (from.store === "pins") {
    if (!pin) return;
    state.pins = state.pins.filter((p) => p.id !== id);
    setLegacyState(state);
    db.insert(schema.memos)
      .values({
        id: pin.id,
        notebookId: toNotebookId,
        type: "link",
        title: pin.title,
        url: pin.url,
        iconUrl: pin.iconUrl,
      })
      .run();
  } else {
    if (!note) return;
    state.memos = state.memos.filter((m) => m.id !== id);
    setLegacyState(state);
    db.insert(schema.memos)
      .values({
        id: note.id,
        notebookId: toNotebookId,
        type: "text",
        text: note.text,
        createdAt: new Date(note.createdAt || Date.now()),
      })
      .run();
  }
}

/**
 * 메모함 안에서 메모 순서 바꾸기.
 * 시스템 메모함이면 레거시 배열 자체를 재정렬하므로 MailBento 에도 그대로 반영된다.
 * orderedIds 에 없는 항목은 뒤에 원래 순서대로 붙인다.
 */
export function reorderMemos(notebookId: string, orderedIds: string[]): void {
  const nb = getNotebook(notebookId);
  if (!nb) throw new Error("메모함을 찾을 수 없습니다");

  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const sortByRank = <T extends { id: string }>(items: T[]): T[] =>
    items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => {
        const ra = rank.get(a.item.id);
        const rb = rank.get(b.item.id);
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1; // 지정된 것이 앞
        if (rb != null) return 1;
        return a.i - b.i; // 둘 다 미지정이면 원래 순서 유지
      })
      .map((x) => x.item);

  if (nb.systemKey === "corkboard" || nb.systemKey === "memo") {
    const state = getLegacyState();
    if (nb.systemKey === "corkboard") state.pins = sortByRank(state.pins);
    else state.memos = sortByRank(state.memos);
    setLegacyState(state);
    return;
  }

  orderedIds.forEach((id, i) => {
    db.update(schema.memos)
      .set({ position: i, updatedAt: new Date() })
      .where(eq(schema.memos.id, id))
      .run();
  });
}

/** 메모 삭제 — 30일 휴지통으로 옮긴다. */
export function deleteMemo(id: string): void {
  const loc = locateMemo(id);
  if (!loc) throw new Error("메모를 찾을 수 없습니다");

  // 목록에 보여줄 이름을 먼저 뽑아둔다 (옮기고 나면 못 읽는다)
  const label = labelOf(id, loc);
  trashMemo(id, loc, label);
}

/** 휴지통 목록에 쓸 표시 이름. */
function labelOf(id: string, loc: MemoLocation): string {
  if (loc.store === "db") {
    const row = db.select().from(schema.memos).where(eq(schema.memos.id, id)).get();
    if (!row) return "";
    if (row.title) return row.title;
    if (row.text) return row.text.split("\n")[0];
    if (row.url) return hostnameOf(row.url);
    if (row.fileId) {
      const f = db.select().from(schema.files).where(eq(schema.files.id, row.fileId)).get();
      if (f) return f.name;
    }
    return "";
  }
  const state = getLegacyState();
  if (loc.store === "pins") {
    const p = state.pins.find((x) => x.id === id);
    return p ? p.title || hostnameOf(p.url) : "";
  }
  const m = state.memos.find((x) => x.id === id);
  return m ? m.text.split("\n")[0] : "";
}

// ─────────────────────────────────────────────────────────────
//   백업 / 복원
// ─────────────────────────────────────────────────────────────

export interface BackupPayload {
  app: "memobento";
  type: "backup";
  version: 1;
  exportedAt: string;
  notebooks: {
    id: string;
    name: string;
    systemKey: SystemKey | null;
    /** 메모함 종류. 구버전 백업에는 없다 — 그때는 전부 일반 메모함이었다. */
    kind?: NotebookKind;
    viewMode: ViewMode;
    position: number;
    memos: {
      id: string;
      type: MemoType;
      text: string | null;
      title: string | null;
      url: string | null;
      iconUrl: string | null;
      /** 파일 메타데이터만. 바이트는 data 볼륨에 그대로 남는다. */
      file: FileDTO | null;
      /** 체크리스트·TODO 완료 여부. 구버전 백업에는 없다. */
      done?: boolean;
      /** TODO 기한. 구버전 백업에는 없다. */
      dueAt?: number | null;
      /** 반복 일정 규칙. 구버전 백업에는 없다. */
      recurrence?: Recurrence | null;
      /** 글자 색. 구버전 백업에는 없다. */
      color?: MemoColor | null;
      position?: number;
      createdAt: number;
    }[];
  }[];
  /** MailBento 백업과 동일한 형식 — 그대로 주고받을 수 있다. */
  widget: LegacyState;
}

export function exportBackup(): BackupPayload {
  return {
    app: "memobento",
    type: "backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    notebooks: listNotebooks().map((nb) => ({
      id: nb.id,
      name: nb.name,
      systemKey: nb.systemKey,
      kind: nb.kind,
      viewMode: nb.viewMode,
      position: nb.position,
      memos: nb.memos
        .filter((m) => !m.legacy) // 레거시 메모는 widget 필드로 나감 (중복 방지)
        .map((m, i) => ({
          id: m.id,
          type: m.type,
          text: m.text,
          title: m.title,
          url: m.url,
          iconUrl: m.iconUrl,
          file: m.file,
          done: m.done,
          dueAt: m.dueAt,
          recurrence: m.recurrence,
          color: m.color,
          position: i,
          createdAt: m.createdAt,
        })),
    })),
    widget: getLegacyState(),
  };
}

/**
 * 메모함 구조를 파일 내용으로 교체한다.
 * 파일 바이트는 건드리지 않으므로, 같은 data 볼륨이면 첨부가 그대로 복원된다.
 */
export function importNotebooks(input: BackupPayload["notebooks"]): number {
  // 시스템 메모함은 남기고 사용자 메모함만 교체
  const existing = db.select().from(schema.notebooks).all();
  for (const nb of existing) {
    if (!nb.systemKey) {
      db.delete(schema.notebooks).where(eq(schema.notebooks.id, nb.id)).run();
    }
  }
  db.delete(schema.memos).run();
  ensureSystemNotebooks();

  let count = 0;
  input.forEach((nb, i) => {
    let id = nb.id;
    if (nb.systemKey) {
      const sys = SYSTEM_NOTEBOOKS.find((s) => s.systemKey === nb.systemKey);
      if (!sys) return;
      id = sys.id;
      db.update(schema.notebooks)
        .set({ viewMode: nb.viewMode, position: nb.position ?? i })
        .where(eq(schema.notebooks.id, id))
        .run();
    } else {
      // 구버전 백업에는 kind 가 없다 — 그때는 전부 일반 메모함이었다.
      // 알 수 없는 값이 오면 되돌릴 수 없으므로 화이트리스트로 거른다.
      const kind: NotebookKind =
        nb.kind && (NOTEBOOK_KINDS as readonly string[]).includes(nb.kind)
          ? nb.kind
          : "memo";
      // 메모함을 만들 때와 같은 규칙 — 한 줄짜리 종류는 그리드가 없다
      const viewMode = kind === "memo" ? nb.viewMode : "list";
      db.insert(schema.notebooks)
        .values({ id, name: nb.name, kind, viewMode, position: nb.position ?? i })
        .onConflictDoUpdate({
          target: schema.notebooks.id,
          set: { name: nb.name, kind, viewMode, position: nb.position ?? i },
        })
        .run();
      count++;
    }

    (nb.memos ?? []).forEach((m, mi) => {
      // 첨부는 files 행이 남아 있을 때만 연결한다 (다른 인스턴스로 옮긴 경우 방지)
      const fileId = m.file?.id ?? null;
      const fileExists =
        fileId &&
        !!db.select().from(schema.files).where(eq(schema.files.id, fileId)).get();
      db.insert(schema.memos)
        .values({
          id: m.id,
          notebookId: id,
          type: m.type,
          text: m.text ?? null,
          title: m.title ?? null,
          url: m.url ?? null,
          iconUrl: m.iconUrl ?? null,
          fileId: fileExists ? fileId : null,
          done: m.done ? 1 : 0,
          dueAt: m.dueAt != null ? new Date(m.dueAt) : null,
          // 알아볼 수 없는 규칙은 버린다 — 손댄 백업이 그대로 들어오지 않게
          recurrence: m.recurrence
            ? (() => {
                const r = normalizeRecurrence(m.recurrence);
                return r ? JSON.stringify(r) : null;
              })()
            : null,
          color:
            m.color && (MEMO_COLORS as readonly string[]).includes(m.color)
              ? m.color
              : null,
          position: m.position ?? mi,
          createdAt: new Date(m.createdAt || Date.now()),
        })
        .onConflictDoNothing()
        .run();
    });
  });
  return count;
}
