import type { NotebookDTO, ViewMode } from "./types";

/**
 * 모든 변경 API 는 갱신된 메모함 전체 목록을 돌려준다.
 * 단일 사용자 앱이고 payload 가 작아(썸네일 바이트 미포함) 상태 동기화가 단순해진다.
 */

async function mutate(
  url: string,
  init: RequestInit,
): Promise<NotebookDTO[]> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as {
    notebooks?: NotebookDTO[];
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.notebooks ?? [];
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  list: () => mutate("/api/notebooks", { method: "GET" }),

  createNotebook: (name: string) =>
    mutate("/api/notebooks", jsonInit("POST", { name })),

  updateNotebook: (id: string, patch: { name?: string; viewMode?: ViewMode }) =>
    mutate(`/api/notebooks/${encodeURIComponent(id)}`, jsonInit("PATCH", patch)),

  deleteNotebook: (id: string) =>
    mutate(`/api/notebooks/${encodeURIComponent(id)}`, { method: "DELETE" }),

  reorderNotebooks: (orderedIds: string[]) =>
    mutate("/api/notebooks/reorder", jsonInit("POST", { orderedIds })),

  createTextMemo: (notebookId: string, text: string) =>
    mutate("/api/memos", jsonInit("POST", { notebookId, type: "text", text })),

  createLinkMemo: (notebookId: string, url: string, title?: string) =>
    mutate(
      "/api/memos",
      jsonInit("POST", { notebookId, type: "link", url, title }),
    ),

  updateMemo: (
    id: string,
    patch: { text?: string; title?: string; url?: string; notebookId?: string },
  ) => mutate(`/api/memos/${encodeURIComponent(id)}`, jsonInit("PATCH", patch)),

  deleteMemo: (id: string) =>
    mutate(`/api/memos/${encodeURIComponent(id)}`, { method: "DELETE" }),

  reorderMemos: (notebookId: string, orderedIds: string[]) =>
    mutate("/api/memos/reorder", jsonInit("POST", { notebookId, orderedIds })),
};

