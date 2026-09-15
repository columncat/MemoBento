/**
 * PDF 에서 쪽마다 글자를 뽑는다.
 *
 * ## 왜 PDF 를 통째로 넘기지 않나
 *
 * MCP 응답에는 "문서" 라는 종류가 없다 — 글·그림·소리·자원뿐이다. 예전에는
 * PDF 를 자원(`resource` + `blob`)으로 실었는데, Claude Code(2.1.239 에서 확인)는
 * 그림이 아닌 blob 을 **디스크에 저장하고 저장 경로만 글로 넘긴다.** 파일 읽기
 * 도구가 막힌 에이전트에게는 그 경로가 막다른 길이다. 모델은 PDF 를 한 번도
 * 보지 못했다.
 *
 * 그래서 여기서 글자를 뽑아 **글(`text`)로** 넘긴다. 글로 넘기면 본문을 태그로
 * 감싸 머리글과 가를 수도 있다. 대신 그림·도표·손글씨는 넘어가지 않는다 — 도구 설명에 그렇게 적는다.
 *
 * ## 한 번에 얼마나
 *
 * Claude Code 는 MCP 결과 하나가 약 25,000 토큰(글자 수÷4 로 어림)이나
 * 100,000 자를 넘으면 본문 대신 "파일로 저장했다" 는 안내만 넘긴다. 그 역시
 * 읽을 길이 없다. 그래서 한 번에 싣는 글자를 20,000 자로 막고, 나머지는
 * `nextPages` 로 이어 부르게 한다.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

/** 한 번에 담는 쪽 수 상한. */
export const MAX_PAGES_PER_CALL = 20;
/** 한 번에 싣는 글자 수 — 기본값과 상한. */
export const DEFAULT_PDF_CHARS = 12_000;
export const MAX_PDF_CHARS = 20_000;
export const MIN_PDF_CHARS = 1_000;

/**
 * 이보다 크면 열지 않는다.
 *
 * pdf.js 는 끝의 xref 부터 아무 데나 건너뛰어 읽어서 조각으로 줄 수가 없고,
 * 통째로 메모리에 올려야 한다. 글자만 넘기므로 대화 크기와는 상관이 없다.
 */
export const MAX_PDF_BYTES = 64 * 1024 * 1024;

/** 쪽에 이만큼도 글자가 없으면 "글자 없는 쪽" 으로 본다 (공백 뺀 글자 수). */
const EMPTY_PAGE_CHARS = 5;

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDoc = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;

let pdfjsPromise: Promise<Pdfjs> | null = null;

function loadPdfjs(): Promise<Pdfjs> {
  /*
   * legacy 빌드를 쓴다. 기본 빌드는 브라우저의 최신 기능을 전제한다.
   * Node 에서는 워커를 같은 스레드에서 돌리는 가짜 워커로 뜬다 — 번들러가 없으니
   * 그 워커 파일도 제자리에서 그대로 찾아진다.
   */
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

/**
 * CMap·기본 글꼴 디렉터리. Node 에서는 URL 이 아니라 **파일 경로**로 읽는다.
 *
 * 한글·한자 PDF 는 글자를 유니코드가 아니라 "이 글꼴의 몇 번째 글자" 로 담는
 * 일이 흔하고, 그 번호를 글자로 옮기는 표가 CMap 이다. 없으면 그런 문서만 글자가
 * 통째로 빠진다 — 라틴 문자는 멀쩡해서 한동안 눈치채지 못한다.
 */
function assetDir(name: "cmaps" | "standard_fonts"): string | undefined {
  try {
    const pkg = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
    const dir = join(dirname(pkg), name);
    return existsSync(dir) ? dir + sep : undefined;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────
//   쪽 짚기
// ─────────────────────────────────────────────────────────────

/**
 * `"1-5"`, `"7"`, `"2,5-8"`, `"10-"`(끝까지) 를 쪽 번호 목록으로.
 *
 * 문서 범위를 넘는 쪽은 잘라 낸다. 남는 것이 없으면 던진다 — 빈 결과를 성공처럼
 * 돌려주면 모델은 "그 쪽에 아무것도 없다" 로 읽는다.
 */
export function parsePages(spec: string, total: number): number[] {
  const out = new Set<number>();
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(part);
    if (!m) {
      throw new Error(`pages 를 읽지 못했습니다: "${spec}". 예: "1-5", "7", "2,5-8", "10-"`);
    }
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : m[2] === "" ? total : Number(m[2]);
    if (from < 1 || to < from) {
      throw new Error(`pages 의 범위가 이상합니다: "${part}"`);
    }
    for (let n = from; n <= Math.min(to, total); n += 1) out.add(n);
  }
  if (out.size === 0) {
    throw new Error(`이 PDF 는 ${total}쪽까지입니다. pages "${spec}" 에 해당하는 쪽이 없습니다`);
  }
  return [...out].sort((a, b) => a - b);
}

/** `[5,6,7,10]` → `"5-7,10"`. */
export function compactPages(pages: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1;
    parts.push(i === j ? String(pages[i]) : `${pages[i]}-${pages[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

// ─────────────────────────────────────────────────────────────
//   한 쪽의 글자 — 줄 복원
//
//   아래 INVISIBLE · toLines · orderByColumn 과 조각 거르기는 PaperBento 의
//   `src/lib/pdf-text.ts` (extractPdfText) 에서 가져왔다. 같은 pdf.js 판
//   (4.10.38)에 맞춰 둔 것이라 한쪽을 고치면 다른 쪽도 본다.
// ─────────────────────────────────────────────────────────────

interface Piece {
  x: number;
  y: number;
  w: number;
  size: number;
  str: string;
}

/**
 * 눈에 안 보이게 심어 두는 글자들. 제로폭 공백·양방향 재정의 문자로 문장을
 * 쪼개 두면 사람 눈에는 안 보이고 모델에게는 그대로 간다.
 */
const INVISIBLE = new RegExp(
  `[${(
    [
      [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0xad, 0xad],
      [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff],
    ] as const
  )
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
    .join("")}]`,
  "g",
);

/** 이보다 작은 글자는 버린다. 1pt 글자는 숨긴 문장의 흔한 형태다. */
const MIN_FONT_SIZE = 4;

/** 한 쪽의 조각을 줄로 되돌린다. PDF 안에는 "줄" 이 없고 좌표만 있다. */
function toLines(pieces: Piece[]): string[] {
  if (pieces.length === 0) return [];
  // PDF 의 y 는 아래에서 위로 자라므로 내림차순이 위에서부터다.
  const sorted = [...pieces].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Piece[][] = [];
  let current: Piece[] = [sorted[0]];
  let baseline = sorted[0].y;
  for (const p of sorted.slice(1)) {
    // 위첨자·아래첨자는 기준선이 조금 어긋난다. 글자 크기에 비례해 봐준다.
    const tol = Math.max(2, p.size * 0.4);
    if (Math.abs(p.y - baseline) <= tol) {
      current.push(p);
    } else {
      lines.push(current);
      current = [p];
      baseline = p.y;
    }
  }
  lines.push(current);

  return lines
    .map((line) => {
      const ordered = [...line].sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const p of ordered) {
        // PDF 는 공백을 글자로 담지 않고 좌표를 건너뛰는 것으로 표현하는 일이 흔하다.
        if (prevEnd > Number.NEGATIVE_INFINITY && p.x - prevEnd > p.size * 0.2) out += " ";
        out += p.str;
        prevEnd = p.x + p.w;
      }
      return out.replace(/[ \t]{2,}/g, " ").trim();
    })
    .filter((s) => s.length > 0);
}

/** 2단 조판이면 열을 갈라 왼쪽을 먼저 읽는다. y 로만 묶으면 좌우 열이 섞인다. */
function orderByColumn(pieces: Piece[], pageWidth: number): Piece[][] {
  if (pieces.length < 6) return [pieces];
  const center = pageWidth / 2;
  const slack = pageWidth * 0.02;
  const crossing: Piece[] = [];
  const left: Piece[] = [];
  const right: Piece[] = [];
  for (const p of pieces) {
    if (p.x < center - slack && p.x + p.w > center + slack) crossing.push(p);
    else if (p.x + p.w / 2 < center) left.push(p);
    else right.push(p);
  }
  const n = pieces.length;
  const twoColumn =
    crossing.length / n < 0.12 &&
    left.length >= 3 &&
    right.length >= 3 &&
    left.length / n > 0.15 &&
    right.length / n > 0.15;
  if (!twoColumn) return [pieces];
  return [crossing, left, right].filter((b) => b.length > 0);
}

async function pageText(doc: PdfDoc, n: number): Promise<string> {
  const page = await doc.getPage(n);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: false });
    const pieces: Piece[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue; // marked-content 표식은 글자가 아니다
      const t = item.transform as number[];
      const size = Math.hypot(t[1], t[3]) || Math.abs(t[3]);
      // 아주 작거나 쪽 밖에 있는 글자는 사람 눈에 없는 글자다.
      if (!(size >= MIN_FONT_SIZE) || size > 200) continue;
      const x = t[4];
      const y = t[5];
      if (x < -50 || x > viewport.width + 50) continue;
      if (y < -50 || y > viewport.height + 50) continue;
      const str = item.str.replace(INVISIBLE, "");
      if (!str.trim()) continue;
      pieces.push({ x, y, w: item.width ?? 0, size, str });
    }
    return orderByColumn(pieces, viewport.width)
      .map((bucket) => toLines(bucket).join("\n"))
      .filter((s) => s.trim().length > 0)
      .join("\n");
  } finally {
    page.cleanup();
  }
}

// ─────────────────────────────────────────────────────────────
//   문서 하나 — 이어 부르기를 위해 잠깐 들고 있는다
// ─────────────────────────────────────────────────────────────

/*
 * 긴 문서는 nextPages 로 여러 번 불린다. 그때마다 수십 MB 를 다시 받고 다시
 * 여는 것은 낭비라, **마지막으로 연 문서 하나만** 들고 있는다. 이 서버는 대화
 * 하나 동안 떠 있다가 내려가므로 오래 쌓이지 않는다.
 *
 * **쓰는 중인 문서는 닫지 않는다.** 전에는 다른 PDF 를 여는 순간 앞의 것을
 * 닫았다. 그런데 모델은 도구를 나란히 부른다 — 한 호출이 쪽을 뽑는 도중에 다른
 * PDF 호출이 들어오면 앞 문서가 발밑에서 닫혀 그 호출이 실패한다. 그래서 문서마다
 * 쓰는 호출 수를 세고, 밀려난 문서는 **마지막 호출이 끝날 때** 닫는다.
 */
interface Entry {
  key: string;
  doc: PdfDoc;
  texts: Map<number, string>;
  /** 이 문서를 지금 쓰고 있는 호출 수. */
  users: number;
  /** 다른 문서에 자리를 내줬다. 쓰는 호출이 없어지면 닫는다. */
  stale: boolean;
  destroyed: boolean;
}

let cached: Entry | null = null;
/** 같은 문서를 동시에 두 번 받지 않게, 여는 중인 약속을 나눠 쓴다. */
const opening = new Map<string, Promise<Entry>>();

function retire(e: Entry): void {
  e.stale = true;
  if (e.users === 0 && !e.destroyed) {
    e.destroyed = true;
    void e.doc.destroy().catch(() => undefined);
  }
}

async function acquire(key: string, load: () => Promise<Uint8Array>): Promise<Entry> {
  let e: Entry;
  if (cached?.key === key && !cached.destroyed) {
    e = cached;
  } else {
    let p = opening.get(key);
    if (!p) {
      p = openFresh(key, load);
      opening.set(key, p);
      // `finally` 로 걸면 실패한 약속에서 파생된 약속이 처리되지 않은 거절로 남는다.
      const forget = () => {
        opening.delete(key);
      };
      p.then(forget, forget);
    }
    e = await p;
    if (e.destroyed) return acquire(key, load);
    if (cached !== e) {
      const old = cached;
      cached = e;
      if (old) retire(old);
    }
  }
  e.users += 1;
  return e;
}

function release(e: Entry): void {
  e.users -= 1;
  if (e.stale && e.users === 0 && !e.destroyed) {
    e.destroyed = true;
    void e.doc.destroy().catch(() => undefined);
  }
}

async function openFresh(key: string, load: () => Promise<Uint8Array>): Promise<Entry> {
  const pdfjs = await loadPdfjs();
  const data = await load();
  const task = pdfjs.getDocument({
    data,
    // 글자만 뽑는다. 글꼴 적재와 eval 은 필요 없다.
    disableFontFace: true,
    isEvalSupported: false,
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetDir("standard_fonts"),
    verbosity: 0,
  });
  let doc: PdfDoc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = e instanceof Error ? e.name : "";
    if (name === "PasswordException") {
      throw new Error("암호가 걸린 PDF 라 열 수 없습니다");
    }
    throw new Error(`PDF 를 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { key, doc, texts: new Map(), users: 0, stale: false, destroyed: false };
}

export interface PdfPages {
  totalPages: number;
  /** 실제로 담은 쪽. */
  pages: { n: number; text: string }[];
  /** 아직 안 읽은 쪽 (`pages` 에 그대로 넘기면 이어진다). 끝이면 null. */
  nextPages: string | null;
  /** 한 쪽이 상한보다 길어 앞부분만 담았으면 그 쪽 번호. */
  cutPage: number | null;
  /** 담은 쪽 가운데 글자가 거의 없는 쪽. */
  emptyPages: number[];
  /** 담은 쪽을 통틀어 글자가 있었는가. false 면 스캔본으로 보인다. */
  textFound: boolean;
}

/**
 * 짚은 쪽의 글자를 상한 안에서 담는다.
 *
 * @param key   같은 파일인지 가를 값 (파일 id·크기).
 * @param load  바이트를 받아 오는 함수. 캐시에 없을 때만 부른다.
 * @param spec  쪽 짚기. 없으면 1쪽부터.
 */
export async function readPdfPages(
  key: string,
  load: () => Promise<Uint8Array>,
  spec: string | undefined,
  maxChars: number,
): Promise<PdfPages> {
  const entry = await acquire(key, load);
  try {
    // `return await` 여야 한다 — 그냥 돌려주면 뽑기가 끝나기 전에 finally 가 돌아
    // 문서를 내주고, 다른 호출이 그 문서를 닫을 수 있다.
    return await collect(entry.doc, entry.texts, spec, maxChars);
  } finally {
    release(entry);
  }
}

async function collect(
  doc: PdfDoc,
  texts: Map<number, string>,
  spec: string | undefined,
  maxChars: number,
): Promise<PdfPages> {
  const total = doc.numPages;
  const wanted = spec?.trim()
    ? parsePages(spec, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  const pages: { n: number; text: string }[] = [];
  let used = 0;
  let cutPage: number | null = null;
  let stopAt = wanted.length; // wanted 에서 담지 못한 첫 자리

  for (let i = 0; i < wanted.length; i += 1) {
    const n = wanted[i];
    if (pages.length >= MAX_PAGES_PER_CALL) {
      stopAt = i;
      break;
    }
    let text = texts.get(n);
    if (text === undefined) {
      text = await pageText(doc, n);
      texts.set(n, text);
    }
    const cost = `--- p.${n} ---\n`.length + text.length + 2;
    if (used + cost > maxChars) {
      if (pages.length > 0) {
        stopAt = i;
        break;
      }
      // 첫 쪽부터 상한을 넘는다 — 앞부분만 담고 다음 쪽으로 넘어간다.
      text = text.slice(0, Math.max(0, maxChars - 40));
      cutPage = n;
      pages.push({ n, text });
      stopAt = i + 1;
      break;
    }
    pages.push({ n, text });
    used += cost;
  }

  const rest = wanted.slice(stopAt);
  const solid = (s: string) => s.replace(/\s+/g, "").length;
  return {
    totalPages: total,
    pages,
    nextPages: rest.length ? compactPages(rest) : null,
    cutPage,
    emptyPages: pages.filter((p) => solid(p.text) < EMPTY_PAGE_CHARS).map((p) => p.n),
    textFound: pages.some((p) => solid(p.text) >= EMPTY_PAGE_CHARS),
  };
}
