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

/*
 * stdout 은 MCP 프로토콜 전용이다. 한 줄이라도 딴 글이 섞이면 부르는 쪽이
 * 메시지를 못 읽고 연결이 끊긴다.
 *
 * pdf.js 는 경고를 `console.log` 로 찍는다 (예: 선택 의존성인 canvas 가 없을 때
 * "Cannot polyfill `DOMMatrix`"). pdf.js 는 PDF 를 처음 열 때 동적으로 불러오므로
 * (`pdf.ts`), 그보다 앞인 여기서 stderr 로 돌려 두면 된다. SDK 는
 * `process.stdout.write` 로 쓰므로 이 줄의 영향을 받지 않는다.
 */
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { MemoBentoClient, MemoBentoError } from "./client.js";
import {
  DEFAULT_TEXT_LIMIT,
  findMemo,
  resolveNotebook,
  shapeNotebook,
  type Memo,
  type NotebooksResponse,
} from "./shape.js";
import {
  extOf,
  fetchFile,
  fetchThumb,
  sniffImageMime,
  viewableImageMime,
  MAX_IMAGE_BYTES,
  type FetchedFile,
} from "./download.js";
import { fence } from "./fence.js";
import {
  compactPages,
  readPdfPages,
  DEFAULT_PDF_CHARS,
  MAX_PAGES_PER_CALL,
  MAX_PDF_BYTES,
  MAX_PDF_CHARS,
  MIN_PDF_CHARS,
} from "./pdf.js";
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
      "본문·제목·URL·**파일 이름**에서 문자열을 찾는다. 대소문자를 가리지 않는다. " +
      'fileKind 를 주면 그 종류의 파일 메모만 고른다 ("image" 그림, "pdf", "text" 글 파일, ' +
      '"file" 그 밖). 파일 메모는 제목도 본문도 비어 있어 이름으로만 찾힌다 — ' +
      '"영수증 사진" 처럼 이름을 모르면 query 없이 fileKind 로 후보를 보고 ' +
      "이름·크기·올린 때(createdAt)로 고른다. 파일 내용은 read_file 로 연다.",
    inputSchema: {
      query: z.string().min(1).optional().describe("찾을 문자열. fileKind 를 주면 생략 가능"),
      fileKind: z
        .enum(["image", "pdf", "text", "file"])
        .optional()
        .describe("이 종류의 파일 메모만"),
      notebook: z.string().optional().describe("이 메모함 안에서만"),
      limit: z.number().int().min(1).max(200).optional().describe("기본 30"),
    },
  },
  async ({ query, fileKind, notebook, limit }) => {
    try {
      if (!query && !fileKind) throw new Error("query 나 fileKind 중 하나는 주어야 합니다");
      const res = await list();
      const scope = notebook ? [resolveNotebook(res, notebook)] : res.notebooks;
      const q = query?.toLowerCase();
      const hits: unknown[] = [];
      for (const nb of scope) {
        for (const m of nb.memos) {
          if (fileKind && m.file?.kind !== fileKind) continue;
          if (q) {
            const hay = [m.text, m.title, m.url, m.file?.name]
              .filter(Boolean)
              .join("\n")
              .toLowerCase();
            if (!hay.includes(q)) continue;
          }
          hits.push({
            notebook: { id: nb.id, name: nb.name },
            memo: {
              ...shapeMemoBrief(m.id, m.type, m.text, m.title, m.url, m.file),
              ...(m.file
                ? {
                    file: { name: m.file.name, kind: m.file.kind, size: m.file.size },
                    createdAt: new Date(m.createdAt).toISOString(),
                  }
                : {}),
            },
          });
          if (hits.length >= (limit ?? 30)) break;
        }
        if (hits.length >= (limit ?? 30)) break;
      }
      return ok({ query, fileKind, count: hits.length, hits });
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
  file?: Memo["file"],
) {
  // 파일 메모는 제목도 본문도 비어 있다. 이름이라도 보여야 무엇인지 안다.
  const label = title || text || url || file?.name || "";
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
      "파일 메모는 여기서 만들지 않는다.",
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

/*
 * 폴더가 정해져 있을 때만 붙인다.
 *
 * 예전에는 늘 붙여 두고 부를 때 거절했다. 그러면 쓸 수 없는 도구의 설명과
 * 인자가 매 요청 맥락에 실린다 — 모델이 있지도 않은 폴더를 두고 궁리하게
 * 만들고, 값은 값대로 든다. 쓸 수 있을 때만 보이는 편이 맞다.
 */
if (process.env.MEMOBENTO_UPLOAD_DIR) {
server.registerTool(
  "upload_file",
  {
    title: "파일 메모 넣기",
    description:
      "미리 정해 둔 폴더(MEMOBENTO_UPLOAD_DIR)에 있는 파일을 메모함에 올린다. " +
      "그림·PDF·일반 파일 모두 된다. " +
      "파일을 받을 수 있는 메모함이어야 한다 — Corkboard(링크 전용)나 " +
      "체크리스트·TODO·반복 일정 메모함은 받지 않는다.",
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
}

type MemoFile = NonNullable<Memo["file"]>;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

/** 머리글(글) 하나 + 그림 한 장. 한 결과에 그림은 한 장만 싣는다. */
function withImage(head: Record<string, unknown>, img: FetchedFile) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(head, null, 1) },
      { type: "image" as const, data: img.bytes.toString("base64"), mimeType: img.mimeType },
    ],
  };
}

/** 미리보기를 받아 그림으로 넘길 수 있으면 돌려준다. 없거나 못 넘기면 null. */
async function thumbFor(file: MemoFile): Promise<FetchedFile | null> {
  if (file.hasThumb === false) return null;
  // 미리보기는 대신 보내는 것일 뿐이다. 그걸 못 받았다고 도구 전체를 실패시키지
  // 않는다 — 부르는 쪽이 "원본을 못 연 이유" 를 들을 수 있어야 한다.
  const thumb = await fetchThumb(client, file.id).catch(() => null);
  if (!thumb || thumb.bytes.length > MAX_IMAGE_BYTES) return null;
  // 미리보기도 바이트로 가린다 — 서버가 붙인 타입보다 내용이 먼저다.
  const real = sniffImageMime(thumb.bytes);
  return real ? { ...thumb, mimeType: real } : null;
}

/**
 * 그림.
 *
 * 원본을 넘길 수 있으면 원본을, 아니면 앱이 만든 미리보기를, 그것도 없으면
 * 못 연다는 말을 돌려준다. **무엇을 보냈는지 늘 적는다** — 400px 미리보기를
 * 원본인 줄 알고 "글씨가 없다" 고 답하면 틀린 답이 된다.
 */
async function readImage(file: MemoFile, head: Record<string, unknown>) {
  const mime = viewableImageMime(file.name);
  let why: string;
  if (mime && file.size <= MAX_IMAGE_BYTES) {
    const got = await fetchFile(client, file.id);
    // 이름·content-type 이 아니라 **바이트**로 가린다 (download.ts 의 sniffImageMime).
    const real = sniffImageMime(got.bytes);
    if (real) {
      return withImage({ ...head, mimeType: real, sent: "original" }, { ...got, mimeType: real });
    }
    why =
      got.bytes.length === 0
        ? "빈 파일이다 (0바이트)"
        : `이름은 그림(${mime})인데 내용이 png·jpeg·gif·webp 그림이 아니다`;
  } else if (mime) {
    why = `원본이 ${mb(file.size)} 로 그림 상한 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 를 넘는다`;
  } else {
    why = `${extOf(file.name) || "확장자 없는"} 형식은 그림으로 넘길 수 없다 (png·jpeg·gif·webp 만 된다)`;
  }

  const thumb = await thumbFor(file);
  if (thumb) {
    return withImage(
      {
        ...head,
        mimeType: thumb.mimeType,
        sent: "thumbnail",
        note:
          `${why}. 대신 앱이 올릴 때 만든 미리보기(긴 변 400px 이하)를 보낸다. 원본이 아니다 — ` +
          "작은 글씨는 안 보일 수 있고, 안 보이면 그렇다고 말해라.",
      },
      thumb,
    );
  }
  return ok({
    ...head,
    read: false,
    note:
      `${why}. 미리보기도 없어 열지 못했다. ` +
      `png·jpeg·gif·webp 로 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 이하로 다시 올리면 읽을 수 있다.`,
  });
}

/**
 * PDF — 쪽마다 뽑은 글자.
 *
 * 왜 PDF 자체를 넘기지 않는지는 `pdf.ts` 머리에 적었다.
 */
async function readPdf(
  file: MemoFile,
  head: Record<string, unknown>,
  pages: string | undefined,
  maxChars: number | undefined,
) {
  if (file.size > MAX_PDF_BYTES) {
    return ok({
      ...head,
      read: false,
      note: `${mb(file.size)} 로 PDF 상한 ${MAX_PDF_BYTES / 1024 / 1024}MB 를 넘어 열지 않았다.`,
    });
  }
  const cap = maxChars ?? DEFAULT_PDF_CHARS;
  const r = await readPdfPages(
    `${file.id}:${file.size}`,
    // pdf.js 는 Node 의 Buffer 를 받지 않는다. Uint8Array 로 옮긴다.
    async () => new Uint8Array((await fetchFile(client, file.id)).bytes),
    pages,
    cap,
  );

  const shown = compactPages(r.pages.map((p) => p.n));
  const thumb = !r.textFound && r.pages.some((p) => p.n === 1) ? await thumbFor(file) : null;

  const notes: string[] = [];
  if (!r.textFound) {
    notes.push(
      `p.${shown} 에서 뽑을 글자가 없다. 글자층이 없는 스캔본으로 보인다 — ` +
        "내용을 지어내지 말고, 글자를 읽을 수 없다고 말해라.",
    );
    if (thumb) notes.push("1쪽 미리보기(긴 변 400px 이하)를 함께 보낸다. 원본이 아니라 작은 글씨는 안 보일 수 있다.");
  } else if (r.emptyPages.length > 0) {
    notes.push(`p.${compactPages(r.emptyPages)} 에는 글자가 거의 없다 (그림·도표뿐이거나 스캔한 쪽).`);
  }
  if (r.cutPage !== null) notes.push(`p.${r.cutPage} 이 길어 앞 ${cap}자 남짓만 실었다.`);
  if (r.nextPages) notes.push(`안 읽은 쪽이 남았다. 필요하면 pages: "${r.nextPages}" 로 다시 불러라.`);
  // 태그 이름을 꺾쇠째 적지 않는다. 머리글에 여는 태그가 하나 더 보이면 울타리가 헷갈린다.
  notes.push("그림·도표·손글씨는 담기지 않는다. 아래 file-text 안이 PDF 에서 뽑은 글자다.");

  const header = JSON.stringify(
    {
      ...head,
      totalPages: r.totalPages,
      pages: shown,
      nextPages: r.nextPages,
      textFound: r.textFound,
      note: notes.join(" "),
    },
    null,
    1,
  );
  const body = r.textFound
    ? `\n\n${fence(r.pages.map((p) => `--- p.${p.n} ---\n${p.text}`).join("\n\n"), "file-text")}`
    : "";

  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [
    { type: "text", text: header + body },
  ];
  if (thumb) {
    content.push({ type: "image", data: thumb.bytes.toString("base64"), mimeType: thumb.mimeType });
  }
  return { content };
}

server.registerTool(
  "read_file",
  {
    title: "파일 메모 읽기",
    description:
      "메모함에 **이미 들어 있는** 파일 메모를 연다. memoId 는 search_memos(파일 이름으로, " +
      "또는 fileKind 로 추려서)나 list_notebooks 가 준 id 다. " +
      `그림(png·jpeg·gif·webp, ${MAX_IMAGE_BYTES / 1024 / 1024}MB 까지)은 그림으로 돌려준다. ` +
      "더 크거나 다른 형식(heic·bmp·svg·tiff 등)이거나 내용이 그림이 아니면, 앱이 올릴 때 " +
      '만들어 둔 미리보기(긴 변 400px 이하)가 있을 때만 그것을 대신 보내고 sent:"thumbnail" 로 ' +
      "알린다 — 작은 글씨는 안 보일 수 있다. heic 처럼 브라우저가 못 여는 형식이나 채팅으로 " +
      "들어온 파일에는 미리보기가 없어 read:false 와 이유가 온다. " +
      `PDF(${MAX_PDF_BYTES / 1024 / 1024}MB 까지)는 쪽마다 뽑은 **글자**를 돌려준다 — PDF 속 ` +
      '그림·도표·손글씨는 안 온다. pages 로 쪽을 짚는다("1-5", "7", "2,5-8", "10-"), 안 주면 1쪽부터. ' +
      `한 번에 ${MAX_PAGES_PER_CALL}쪽·maxChars 자까지 담고 totalPages 와 nextPages(안 읽은 쪽, ` +
      "끝이면 null)를 준다. 긴 문서는 pages 에 nextPages 를 넘겨 이어 읽는다. " +
      "textFound:false 면 글자층이 없는 스캔본이다 — 내용을 지어내지 마라. " +
      "그 밖의 파일(zip·docx·소리 등)은 이름·크기만 온다.",
    inputSchema: {
      memoId: z.string().min(1).describe("파일이 붙어 있는 메모의 id"),
      pages: z
        .string()
        .optional()
        .describe('PDF 만. 예: "1-5", "7", "2,5-8", "10-"(끝까지). 없으면 1쪽부터'),
      maxChars: z
        .number()
        .int()
        .min(MIN_PDF_CHARS)
        .max(MAX_PDF_CHARS)
        .optional()
        .describe(`PDF 만. 한 번에 실을 글자 수. 기본 ${DEFAULT_PDF_CHARS}`),
    },
  },
  async ({ memoId, pages, maxChars }) => {
    try {
      const found = findMemo(await list(), memoId);
      if (!found) {
        throw new Error(
          `그런 메모가 없습니다: ${memoId}. search_memos 나 list_notebooks 가 준 id 를 쓰세요`,
        );
      }
      const { memo, notebook } = found;
      if (!memo.file) throw new Error("이 메모에는 파일이 없습니다 (텍스트나 링크 메모입니다)");

      const head = {
        notebook: notebook.name,
        file: memo.file.name,
        size: memo.file.size,
        kind: memo.file.kind,
      };
      if (memo.file.kind === "pdf") return await readPdf(memo.file, head, pages, maxChars);
      if (memo.file.kind === "image") return await readImage(memo.file, head);

      return ok({
        ...head,
        read: false,
        note: "그림이나 PDF 가 아니라 내용은 볼 수 없다. 이름과 크기만 알려 준다.",
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
