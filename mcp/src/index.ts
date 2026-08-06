#!/usr/bin/env node
/**
 * MemoBento MCP 서버 (stdio).
 *
 * MemoBento 를 돌리는 호스트에서, 또는 그 호스트에 닿을 수 있는 곳에서 돌린다.
 * 앱의 HTTP API 를 그대로 쓰므로 DB 파일을 직접 만지지 않는다 — 휴지통·순서·
 * MailBento 동기화 같은 규칙이 서버 쪽에 있고, 우회하면 그게 다 깨진다.
 *
 * 설정은 환경변수로 받는다.
 *   MEMOBENTO_URL       기본 http://127.0.0.1:3001
 *   MEMOBENTO_PASSWORD  인증이 켜진 서버라면 필수
 *   MEMOBENTO_TIMEOUT_MS 기본 15000
 *   MEMOBENTO_UPLOAD_DIR 파일을 올릴 수 있게 할 폴더. 비우면 업로드가 꺼진다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MemoBentoClient, MemoBentoError } from "./client.js";
import {
  DEFAULT_TEXT_LIMIT,
  findMemo,
  resolveNotebook,
  shapeNotebook,
  type NotebooksResponse,
} from "./shape.js";
import { uploadFile } from "./upload.js";

const NOTEBOOK_KINDS = ["memo", "checklist", "todo", "schedule"] as const;
const VIEW_MODES = ["list", "grid"] as const;
const MEMO_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

const client = new MemoBentoClient({
  baseUrl: process.env.MEMOBENTO_URL ?? "http://127.0.0.1:3001",
  password: process.env.MEMOBENTO_PASSWORD || undefined,
  timeoutMs: Number(process.env.MEMOBENTO_TIMEOUT_MS ?? 15000),
});

const server = new McpServer({ name: "memobento", version: "0.1.0" });

/** 도구 결과는 전부 JSON 텍스트 한 덩어리로 돌려준다. */
function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

function fail(e: unknown) {
  const msg =
    e instanceof MemoBentoError || e instanceof Error ? e.message : String(e);
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
}

/** 모든 변경 API 가 메모함 전체를 돌려주므로, 매번 새로 읽을 필요가 없다. */
const list = () => client.get<NotebooksResponse>("/api/notebooks");

// ── 읽기 ────────────────────────────────────────────────────────

server.registerTool(
  "list_notebooks",
  {
    title: "메모함 목록",
    description:
      "메모함과 그 안의 메모를 읽는다. notebook 을 주면 그 하나만, 안 주면 전부. " +
      "메모가 많으면 includeMemos=false 로 목록만 먼저 보는 편이 낫다.",
    inputSchema: {
      notebook: z
        .string()
        .optional()
        .describe("메모함 id 또는 정확한 이름. 없으면 전부"),
      includeMemos: z.boolean().optional().describe("기본 true"),
      textLimit: z
        .number()
        .int()
        .optional()
        .describe(`메모 본문을 몇 자까지 실을지. 기본 ${DEFAULT_TEXT_LIMIT}, 0 이면 자르지 않음`),
    },
  },
  async ({ notebook, includeMemos, textLimit }) => {
    try {
      const res = await list();
      const opts = { memos: includeMemos ?? true, textLimit: textLimit ?? DEFAULT_TEXT_LIMIT };
      if (notebook) {
        return ok(shapeNotebook(resolveNotebook(res, notebook), opts));
      }
      return ok({ notebooks: res.notebooks.map((n) => shapeNotebook(n, opts)) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "search_memos",
  {
    title: "메모 검색",
    description:
      "본문·제목·URL 에서 문자열을 찾는다. 대소문자를 가리지 않는다.",
    inputSchema: {
      query: z.string().min(1),
      notebook: z.string().optional().describe("이 메모함 안에서만"),
      limit: z.number().int().min(1).max(200).optional().describe("기본 30"),
    },
  },
  async ({ query, notebook, limit }) => {
    try {
      const res = await list();
      const scope = notebook ? [resolveNotebook(res, notebook)] : res.notebooks;
      const q = query.toLowerCase();
      const hits: unknown[] = [];
      for (const nb of scope) {
        for (const m of nb.memos) {
          const hay = [m.text, m.title, m.url].filter(Boolean).join("\n").toLowerCase();
          if (!hay.includes(q)) continue;
          hits.push({
            notebook: { id: nb.id, name: nb.name },
            memo: shapeMemoBrief(m.id, m.type, m.text, m.title, m.url),
          });
          if (hits.length >= (limit ?? 30)) break;
        }
        if (hits.length >= (limit ?? 30)) break;
      }
      return ok({ query, count: hits.length, hits });
    } catch (e) {
      return fail(e);
    }
  },
);

function shapeMemoBrief(
  id: string,
  type: string,
  text: string | null,
  title: string | null,
  url: string | null,
) {
  const label = title ?? text ?? url ?? "";
  return { id, type, preview: label.length > 120 ? `${label.slice(0, 120)}…` : label };
}

// ── 메모함 ──────────────────────────────────────────────────────

server.registerTool(
  "create_notebook",
  {
    title: "메모함 만들기",
    description:
      "종류는 만들 때 정해지고 나중에 바꿀 수 없다. " +
      "memo=텍스트·링크·파일, checklist=체크 한 줄, todo=체크+기한, schedule=반복 일정.",
    inputSchema: {
      name: z.string().trim().min(1).max(60),
      kind: z.enum(NOTEBOOK_KINDS).optional().describe("기본 memo"),
    },
  },
  async ({ name, kind }) => {
    try {
      const res = await client.send<NotebooksResponse>("POST", "/api/notebooks", {
        name,
        kind: kind ?? "memo",
      });
      // 방금 만든 것은 목록 맨 끝에 붙는다
      const made = res.notebooks.filter((n) => n.name === name).pop();
      return ok({ created: made ? shapeNotebook(made) : null });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "update_notebook",
  {
    title: "메모함 고치기",
    description:
      "이름·보기 방식·접기를 바꾼다. 시스템 메모함(Corkboard / Memo / " +
      "Memory for Agents / Schedule for Agents)은 이름이 잠겨 있어 403 이 난다. " +
      "접기는 시스템 메모함에서도 바꿀 수 있다.",
    inputSchema: {
      notebook: z.string().describe("메모함 id 또는 정확한 이름"),
      name: z.string().trim().min(1).max(60).optional(),
      viewMode: z.enum(VIEW_MODES).optional(),
      hidden: z
        .boolean()
        .optional()
        .describe(
          "접어 두기. 목록 맨 뒤로 가고 화면에서 내용이 가려진다 — 보안 기능이 아니고 내용은 그대로 읽힌다",
        ),
    },
  },
  async ({ notebook, name, viewMode, hidden }) => {
    try {
      if (name === undefined && viewMode === undefined && hidden === undefined) {
        throw new Error("name · viewMode · hidden 중 하나는 주어야 합니다");
      }
      const target = resolveNotebook(await list(), notebook);
      const res = await client.send<NotebooksResponse>(
        "PATCH",
        `/api/notebooks/${encodeURIComponent(target.id)}`,
        {
          ...(name !== undefined ? { name } : {}),
          ...(viewMode ? { viewMode } : {}),
          ...(hidden !== undefined ? { hidden } : {}),
        },
      );
      const after = res.notebooks.find((n) => n.id === target.id);
      return ok({ updated: after ? shapeNotebook(after, { memos: false }) : null });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "delete_notebook",
  {
    title: "메모함 지우기",
    description:
      "안의 메모·첨부와 함께 휴지통으로 간다(30일). 즉시 사라지지 않으므로 " +
      "restore_trash 로 되살릴 수 있다. 시스템 메모함은 잠겨 있어 403 이 난다.",
    inputSchema: {
      notebook: z.string().describe("메모함 id 또는 정확한 이름"),
    },
  },
  async ({ notebook }) => {
    try {
      const target = resolveNotebook(await list(), notebook);
      await client.send("DELETE", `/api/notebooks/${encodeURIComponent(target.id)}`);
      return ok({ deleted: { id: target.id, name: target.name }, note: "휴지통에 30일 보관" });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "reorder_notebooks",
  {
    title: "메모함 순서",
    description: "화면에 놓이는 순서. 목록에 없는 id 를 주면 거절된다.",
    inputSchema: { orderedIds: z.array(z.string().min(1)).min(1) },
  },
  async ({ orderedIds }) => {
    try {
      const res = await client.send<NotebooksResponse>(
        "POST",
        "/api/notebooks/reorder",
        { orderedIds },
      );
      return ok({ order: res.notebooks.map((n) => ({ id: n.id, name: n.name })) });
    } catch (e) {
      return fail(e);
    }
  },
);

// ── 메모 ────────────────────────────────────────────────────────

server.registerTool(
  "create_memo",
  {
    title: "메모 추가",
    description:
      "텍스트 또는 링크 메모를 넣는다. 체크리스트·TODO 항목도 텍스트 메모다(dueAt 로 기한). " +
      "파일 첨부는 브라우저에서 암호화해 조각으로 올리는 구조라 여기서는 다루지 않는다.",
    inputSchema: {
      notebook: z.string().describe("메모함 id 또는 정확한 이름"),
      type: z.enum(["text", "link"]).optional().describe("기본 text"),
      text: z.string().trim().max(20000).optional().describe("type=text 일 때"),
      url: z.string().trim().optional().describe("type=link 일 때"),
      title: z.string().trim().max(200).optional().describe("링크 표시 이름"),
      dueAt: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("TODO 기한 (unix ms). 날짜만 정할 때는 그날 정오를 쓰면 표준시가 밀려도 날짜가 안 바뀐다"),
    },
  },
  async ({ notebook, type, text, url, title, dueAt }) => {
    try {
      const target = resolveNotebook(await list(), notebook);
      const kind = type ?? "text";
      if (kind === "text" && !text) throw new Error("type=text 에는 text 가 필요합니다");
      if (kind === "link" && !url) throw new Error("type=link 에는 url 이 필요합니다");
      const before = new Set(target.memos.map((m) => m.id));
      const res = await client.send<NotebooksResponse>("POST", "/api/memos", {
        notebookId: target.id,
        ...(kind === "text"
          ? { type: "text", text, ...(dueAt !== undefined ? { dueAt } : {}) }
          : { type: "link", url, ...(title ? { title } : {}) }),
      });
      const after = res.notebooks.find((n) => n.id === target.id);
      const made = after?.memos.find((m) => !before.has(m.id));
      return ok({
        notebook: { id: target.id, name: target.name },
        created: made ? shapeMemoBrief(made.id, made.type, made.text, made.title, made.url) : null,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "update_memo",
  {
    title: "메모 고치기",
    description:
      "준 항목만 바꾼다. url 을 빈 문자열이나 null 로 주면 링크가 떨어진다. " +
      "notebookId 를 주면 다른 메모함으로 옮긴다 — 받을 수 없는 종류면 거절된다.",
    inputSchema: {
      memoId: z.string().min(1),
      text: z.string().max(20000).optional(),
      title: z.string().max(200).optional(),
      url: z.string().nullable().optional(),
      done: z.boolean().optional().describe("체크리스트·TODO 완료 여부"),
      dueAt: z.number().int().nullable().optional().describe("null 이면 기한 해제"),
      color: z.enum(MEMO_COLORS).nullable().optional(),
      notebookId: z.string().min(1).optional().describe("옮길 메모함 id"),
      recurrence: z
        .unknown()
        .optional()
        .describe(
          "반복 일정 규칙. 예: {freq:'weekly',interval:1,weekdays:[1,3],timeMinutes:1080}. null 이면 해제",
        ),
    },
  },
  async ({ memoId, ...patch }) => {
    try {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length === 0) throw new Error("바꿀 항목이 없습니다");
      const res = await client.send<NotebooksResponse>(
        "PATCH",
        `/api/memos/${encodeURIComponent(memoId)}`,
        Object.fromEntries(entries),
      );
      const found = findMemo(res, memoId);
      return ok({
        notebook: found ? { id: found.notebook.id, name: found.notebook.name } : null,
        updated: found
          ? shapeMemoBrief(
              found.memo.id,
              found.memo.type,
              found.memo.text,
              found.memo.title,
              found.memo.url,
            )
          : null,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "upload_file",
  {
    title: "파일 메모 넣기",
    description:
      "미리 정해 둔 폴더(MEMOBENTO_UPLOAD_DIR)에 있는 파일을 메모함에 올린다. " +
      "그림·PDF·일반 파일 모두 된다. 앱과 같은 방식으로 조각내 암호화해 보관한다. " +
      "파일을 받을 수 있는 메모함이어야 한다 — Corkboard(링크 전용)나 " +
      "체크리스트·TODO·반복 일정 메모함은 받지 않는다. " +
      "이 폴더가 설정돼 있지 않으면 이 도구는 쓸 수 없다.",
    inputSchema: {
      notebook: z.string().describe("메모함 id 또는 정확한 이름"),
      file: z.string().min(1).describe("그 폴더 안의 파일 이름 (경로 말고 이름만)"),
    },
  },
  async ({ notebook, file }) => {
    try {
      const target = resolveNotebook(await list(), notebook);
      const r = await uploadFile(client, target.id, file);
      return ok({
        notebook: { id: target.id, name: target.name },
        uploaded: { name: r.name, size: r.size, fileId: r.fileId },
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "delete_memo",
  {
    title: "메모 지우기",
    description: "휴지통으로 보낸다(30일). restore_trash 로 되살릴 수 있다.",
    inputSchema: { memoId: z.string().min(1) },
  },
  async ({ memoId }) => {
    try {
      await client.send("DELETE", `/api/memos/${encodeURIComponent(memoId)}`);
      return ok({ deleted: memoId, note: "휴지통에 30일 보관" });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "reorder_memos",
  {
    title: "메모 순서",
    description:
      "한 메모함 안의 순서. 반복 일정·TODO 는 화면에서 기한 순으로 다시 정렬되므로 " +
      "여기서 정한 순서는 기한 없는 항목들 사이에서만 눈에 띈다.",
    inputSchema: {
      notebook: z.string().describe("메모함 id 또는 정확한 이름"),
      orderedIds: z.array(z.string().min(1)).min(1),
    },
  },
  async ({ notebook, orderedIds }) => {
    try {
      const target = resolveNotebook(await list(), notebook);
      const res = await client.send<NotebooksResponse>("POST", "/api/memos/reorder", {
        notebookId: target.id,
        orderedIds,
      });
      const after = res.notebooks.find((n) => n.id === target.id);
      return ok({
        notebook: { id: target.id, name: target.name },
        order: after?.memos.map((m) => m.id) ?? [],
      });
    } catch (e) {
      return fail(e);
    }
  },
);

// ── 휴지통 ──────────────────────────────────────────────────────

interface TrashResponse {
  trash: {
    id: string;
    kind: string;
    label: string;
    notebookName?: string;
    deletedAt: number;
    daysLeft: number;
    restorable: boolean;
  }[];
}

server.registerTool(
  "list_trash",
  {
    title: "휴지통",
    description: "지운 메모함·메모. 30일이 지나면 사라진다.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await client.get<TrashResponse>("/api/trash"));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "restore_trash",
  {
    title: "되살리기",
    description: "휴지통 항목을 원래 자리로 돌려놓는다.",
    inputSchema: { id: z.string().min(1).describe("list_trash 의 id") },
  },
  async ({ id }) => {
    try {
      await client.send("POST", "/api/trash", { id, action: "restore" });
      return ok({ restored: id });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "purge_trash",
  {
    title: "영구 삭제",
    description: "되돌릴 수 없다. 첨부 파일도 디스크에서 지워진다.",
    inputSchema: { id: z.string().min(1).describe("list_trash 의 id") },
  },
  async ({ id }) => {
    try {
      await client.send("POST", "/api/trash", { id, action: "purge" });
      return ok({ purged: id, note: "되돌릴 수 없음" });
    } catch (e) {
      return fail(e);
    }
  },
);

// ── 기동 ────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout 은 프로토콜 전용이다. 사람이 볼 것은 전부 stderr 로.
  console.error(`[memobento-mcp] ${client.baseUrl} 에 연결 준비`);
}

main().catch((e) => {
  console.error("[memobento-mcp] 기동 실패:", e);
  process.exit(1);
});
