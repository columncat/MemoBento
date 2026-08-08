import { apiPath } from "./api-path";
import { readJson } from "./read-json";
import type { MemoColor, NotebookDTO, NotebookKind, ViewMode } from "./types";

/**
 * 모든 변경 API 는 갱신된 메모함 전체 목록을 돌려준다.
 * 단일 사용자 앱이고 payload 가 작아(썸네일 바이트 미포함) 상태 동기화가 단순해진다.
 */

/**
 * 예전에는 파싱 실패를 `{}` 로 뭉갰다.
 *
 * 그 한 줄이 조용한 사고를 만들었다. 세션이 풀리면 미들웨어가 로그인 페이지로
 * 리다이렉트했고, fetch 는 그걸 따라가 **HTML 을 200 으로** 받아 왔다.
 * `res.ok` 는 참이라 오류로 잡히지 않고, 파싱 실패는 `{}` 가 되고, 결국
 * `json.notebooks ?? []` 가 빈 배열을 돌려줬다. 화면은 그 빈 배열을 그대로
 * 상태에 넣었다 — **메모함이 전부 사라진 것처럼 보였다.** 아무 오류도 뜨지
 * 않은 채로.
 *
 * 이제 두 겹으로 막는다. 미들웨어가 API 에는 401 JSON 을 주고, 여기서는
 * 읽지 못한 응답을 조용히 넘기지 않는다.
 */
async function mutate(url: string, init: RequestInit): Promise<NotebookDTO[]> {
  // 하위 경로 배포에서 접두어를 붙인다. 아래 api 객체의 주소는 전부 절대
  // 경로라, 여기서 한 번에 처리하는 편이 호출부마다 손대는 것보다 안전하다.
  const res = await fetch(apiPath(url), { cache: "no-store", ...init });
  const json = await readJson<{ notebooks?: NotebookDTO[] }>(res);
  return json.notebooks ?? [];
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  list: () => mutate("/api/notebooks", { method: "GET" }),

  createNotebook: (name: string, kind: NotebookKind = "memo") =>
    mutate("/api/notebooks", jsonInit("POST", { name, kind })),

  updateNotebook: (
    id: string,
    patch: { name?: string; viewMode?: ViewMode; hidden?: boolean },
  ) =>
    mutate(`/api/notebooks/${encodeURIComponent(id)}`, jsonInit("PATCH", patch)),

  deleteNotebook: (id: string) =>
    mutate(`/api/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" }),

  reorderNotebooks: (orderedIds: string[]) =>
    mutate("/api/notebooks/reorder", jsonInit("POST", { orderedIds })),

  createTextMemo: (notebookId: string, text: string, dueAt?: number | null) =>
    mutate(
      "/api/memos",
      jsonInit("POST", { notebookId, type: "text", text, dueAt }),
    ),

  createLinkMemo: (notebookId: string, url: string, title?: string) =>
    mutate(
      "/api/memos",
      jsonInit("POST", { notebookId, type: "link", url, title }),
    ),

  updateMemo: (
    id: string,
    patch: {
      text?: string;
      title?: string;
      url?: string | null;
      done?: boolean;
      dueAt?: number | null;
      recurrence?: unknown;
      color?: MemoColor | null;
      notebookId?: string;
    },
  ) => mutate(`/api/memos/${encodeURIComponent(id)}`, jsonInit("PATCH", patch)),

  deleteMemo: (id: string) =>
    mutate(`/api/memos/${encodeURIComponent(id)}`, { method: "DELETE" }),

  reorderMemos: (notebookId: string, orderedIds: string[]) =>
    mutate("/api/memos/reorder", jsonInit("POST", { notebookId, orderedIds })),
};

