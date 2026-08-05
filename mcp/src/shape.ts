/**
 * 응답 다듬기.
 *
 * 앱의 API 는 어떤 변경이든 **메모함 전체 목록**을 돌려준다. 화면에는 알맞지만
 * 도구 결과로 그대로 흘리면 메모 하나 고칠 때마다 수천 토큰이 대화에 쌓인다.
 * 그래서 여기서 필요한 것만 남긴다. 비어 있는 필드는 아예 뺀다.
 */

export interface Memo {
  id: string;
  notebookId: string;
  type: string;
  text: string | null;
  title: string | null;
  url: string | null;
  file: { name: string; size: number; kind: string; encrypted: boolean } | null;
  done: boolean;
  dueAt: number | null;
  recurrence: unknown;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  legacy: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  kind: string;
  systemKey: string | null;
  viewMode: string;
  position: number;
  hidden: boolean;
  accepts: string[];
  memos: Memo[];
}

export interface NotebooksResponse {
  notebooks: Notebook[];
}

/** 본문이 아주 긴 메모는 잘라서 싣는다. 전문이 필요하면 이 값을 올린다. */
export const DEFAULT_TEXT_LIMIT = 400;

function clip(s: string | null, limit: number): string | null {
  if (s === null) return null;
  if (limit <= 0 || s.length <= limit) return s;
  return `${s.slice(0, limit)}… (총 ${s.length}자)`;
}

/** 빈 값을 걷어낸 얕은 객체. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

export function shapeMemo(m: Memo, textLimit = DEFAULT_TEXT_LIMIT) {
  return compact({
    id: m.id,
    type: m.type,
    text: clip(m.text, textLimit),
    title: m.title,
    url: m.url,
    file: m.file
      ? { name: m.file.name, size: m.file.size, kind: m.file.kind }
      : null,
    done: m.done,
    dueAt: m.dueAt,
    recurrence: m.recurrence,
    color: m.color,
    updatedAt: m.updatedAt,
    // 시스템 메모함(MailBento 공유) 메모라는 표시. 되돌릴 때 규칙이 다르다.
    legacy: m.legacy,
  });
}

export function shapeNotebook(
  nb: Notebook,
  opts: { memos?: boolean; textLimit?: number } = {},
) {
  const { memos = true, textLimit = DEFAULT_TEXT_LIMIT } = opts;
  return compact({
    id: nb.id,
    name: nb.name,
    kind: nb.kind,
    viewMode: nb.viewMode,
    position: nb.position,
    accepts: nb.accepts,
    memoCount: nb.memos.length,
    // 접어 둔 메모함. 화면에서만 가려지고 내용은 그대로 읽힌다.
    hidden: nb.hidden,
    // 값이 있으면 이름 변경·삭제가 잠긴 메모함이다
    systemKey: nb.systemKey,
    memos: memos ? nb.memos.map((m) => shapeMemo(m, textLimit)) : undefined,
  });
}

export function findNotebook(
  res: NotebooksResponse,
  id: string,
): Notebook | undefined {
  return res.notebooks.find((n) => n.id === id);
}

/** 이름이나 id 로 메모함 하나를 고른다. 이름은 대소문자를 가리지 않는다. */
export function resolveNotebook(
  res: NotebooksResponse,
  ref: string,
): Notebook {
  const byId = res.notebooks.find((n) => n.id === ref);
  if (byId) return byId;
  const lower = ref.trim().toLowerCase();
  const named = res.notebooks.filter((n) => n.name.toLowerCase() === lower);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    throw new Error(
      `"${ref}" 라는 이름의 메모함이 ${named.length}개 있습니다. id 로 지정하세요: ${named
        .map((n) => n.id)
        .join(", ")}`,
    );
  }
  throw new Error(
    `"${ref}" 에 해당하는 메모함이 없습니다. 있는 것: ${
      res.notebooks.map((n) => `${n.name}(${n.id})`).join(", ") || "(없음)"
    }`,
  );
}

export function findMemo(
  res: NotebooksResponse,
  memoId: string,
): { memo: Memo; notebook: Notebook } | undefined {
  for (const nb of res.notebooks) {
    const memo = nb.memos.find((m) => m.id === memoId);
    if (memo) return { memo, notebook: nb };
  }
  return undefined;
}
