"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Loader2,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { confirmMemoDelete } from "@/lib/preferences";
import { downloadBlocker, startDownload } from "@/lib/download";
import { useSwReady } from "@/lib/sw-client";
import {
  formatBytes,
  memoLabel,
  viewUrl,
  type MemoDTO,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

import { MemoIcon } from "./memo-item";

/** 텍스트 파일 미리보기 상한 — 이보다 크면 앞부분만 보여준다. */
const TEXT_PREVIEW_LIMIT = 512 * 1024;

interface Props {
  memo: MemoDTO | null;
  onClose: () => void;
  onSave: (
    memo: MemoDTO,
    patch: { text?: string; title?: string; url?: string },
  ) => Promise<void>;
  onDelete: (memo: MemoDTO) => Promise<void>;
}

export function MemoViewer({ memo, onClose, onSave, onDelete }: Props) {
  const [draftText, setDraftText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swReady = useSwReady();

  useEffect(() => {
    setDraftText(memo?.text ?? "");
    setDraftTitle(memo?.title ?? "");
    setDraftUrl(memo?.url ?? "");
    setError(null);
  }, [memo]);

  if (!memo) {
    return (
      <Dialog.Root open={false} onOpenChange={() => undefined}>
        <Dialog.Portal />
      </Dialog.Root>
    );
  }

  const dirty =
    (memo.type === "text" && draftText !== (memo.text ?? "")) ||
    (memo.type !== "text" && draftTitle !== (memo.title ?? "")) ||
    (memo.type === "link" && draftUrl !== (memo.url ?? ""));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: { text?: string; title?: string; url?: string } = {};
      if (memo.type === "text") patch.text = draftText;
      else patch.title = draftTitle;
      if (memo.type === "link") patch.url = draftUrl;
      await onSave(memo, patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmMemoDelete("이 메모를 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(memo);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        {/* pointerdown 전파 차단 — 포털 이벤트가 뒤쪽 dnd-kit 센서를 깨우지 않도록 */}
        <Dialog.Overlay
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[min(1040px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)"
        >
          {/* 헤더 */}
          <div className="flex items-start justify-between gap-4 border-b border-(--color-border-soft) px-6 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border)">
                <MemoIcon memo={memo} className="h-4 w-4 text-(--color-fg-3)" />
              </div>
              <div className="min-w-0 flex-1">
                <Dialog.Title asChild>
                  {memo.type === "text" ? (
                    <h2
                      className="text-[18px] leading-tight"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      메모
                    </h2>
                  ) : (
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder={memoLabel(memo)}
                      className="w-full rounded-md bg-transparent text-[18px] leading-tight text-(--color-fg) outline-none placeholder:text-(--color-fg-3) focus:bg-(--color-bg-2) focus:px-2 focus:py-0.5 focus:ring-1 focus:ring-(--color-accent)/60"
                      style={{ fontFamily: "var(--font-serif)" }}
                    />
                  )}
                </Dialog.Title>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-(--color-fg-4)">
                  {memo.file && (
                    <span className="font-mono">
                      {memo.file.name} · {formatBytes(memo.file.size)}
                    </span>
                  )}
                  {memo.createdAt > 0 && (
                    <span className="font-mono">
                      {formatDateTime(memo.createdAt)}
                    </span>
                  )}
                  {memo.legacy && (
                    <span className="rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] text-(--color-accent-strong)">
                      MailBento 동기화
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {memo.file && (
                <a
                  href={viewUrl(memo.file, { dl: true, swReady })}
                  onClick={(e) => {
                    e.preventDefault();
                    startDownload(memo.file!, swReady);
                  }}
                  aria-disabled={!!downloadBlocker(memo.file, swReady)}
                  title={downloadBlocker(memo.file, swReady) ?? undefined}
                  className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
                >
                  <Download className="h-3.5 w-3.5" />
                  다운로드
                </a>
              )}
              {memo.type === "link" && memo.url && (
                <a
                  href={memo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  열기
                </a>
              )}
              <Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          {/* 본문 */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <ViewerBody
              memo={memo}
              draftText={draftText}
              onDraftText={setDraftText}
              draftUrl={draftUrl}
              onDraftUrl={setDraftUrl}
            />
          </div>

          {/* 푸터 */}
          <div className="flex items-center justify-between gap-3 border-t border-(--color-border-soft) px-6 py-3">
            <div className="min-w-0 flex-1 text-xs text-(--color-danger)">
              {error}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3.5 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger) disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                삭제
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy || !dirty}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition",
                  dirty
                    ? "bg-(--color-accent) text-(--color-bg) hover:bg-(--color-accent-strong)"
                    : "bg-(--color-bg-2) text-(--color-fg-4) ring-1 ring-(--color-border-soft)",
                  busy && "opacity-50",
                )}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                저장
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ViewerBody({
  memo,
  draftText,
  onDraftText,
  draftUrl,
  onDraftUrl,
}: {
  memo: MemoDTO;
  draftText: string;
  onDraftText: (v: string) => void;
  draftUrl: string;
  onDraftUrl: (v: string) => void;
}) {
  const swReady = useSwReady();

  if (memo.type === "text") {
    return (
      <textarea
        value={draftText}
        onChange={(e) => onDraftText(e.target.value)}
        rows={14}
        className="scrollbar-thin block min-h-[280px] w-full resize-y bg-transparent p-6 text-sm leading-relaxed text-(--color-fg-2) outline-none"
        placeholder="메모 내용"
      />
    );
  }

  if (memo.type === "link") {
    return (
      <div className="flex flex-col gap-3 p-6">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
            URL
          </span>
          <input
            value={draftUrl}
            onChange={(e) => onDraftUrl(e.target.value)}
            className="w-full rounded-lg bg-(--color-bg-2) px-3 py-2 font-mono text-sm text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)/60"
          />
        </label>
        <p className="text-[11px] text-(--color-fg-4)">
          제목은 위쪽 입력란에서 바꿀 수 있습니다.
        </p>
      </div>
    );
  }

  const file = memo.file;
  if (!file) {
    return (
      <div className="px-6 py-12 text-center text-xs text-(--color-fg-4)">
        첨부 파일이 없습니다
      </div>
    );
  }

  if (file.kind === "image") {
    return (
      <div className="thumb-checker grid min-h-[320px] place-items-center p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={viewUrl(file, { swReady })}
          alt={file.name}
          className="max-h-[68vh] max-w-full object-contain"
        />
      </div>
    );
  }

  if (file.kind === "pdf") {
    return (
      <iframe
        src={viewUrl(file, { swReady })}
        title={file.name}
        className="h-[70vh] w-full border-0 bg-white"
      />
    );
  }

  if (file.kind === "text") {
    return <TextFileBody file={file} swReady={swReady} />;
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <MemoIcon memo={memo} className="h-8 w-8 text-(--color-fg-4)" />
      <p className="text-sm text-(--color-fg-3)">
        앱 안에서 열람할 수 없는 형식입니다
      </p>
      <a
        href={viewUrl(file, { dl: true, swReady })}
        onClick={(e) => {
          e.preventDefault();
          startDownload(file, swReady);
        }}
        aria-disabled={!!downloadBlocker(file, swReady)}
        title={downloadBlocker(file, swReady) ?? undefined}
        className="rounded-full bg-(--color-accent) px-4 py-2 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong)"
      >
        다운로드 ({formatBytes(file.size)})
      </a>
      {downloadBlocker(file, swReady) && (
        <p className="text-xs text-(--color-warn)">
          {downloadBlocker(file, swReady)}
        </p>
      )}
    </div>
  );
}

function TextFileBody({
  file,
  swReady,
}: {
  file: NonNullable<MemoDTO["file"]>;
  swReady: boolean;
}) {
  const url = viewUrl(file, { swReady });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setText(null);
    setError(null);
    setTruncated(false);

    fetch(url, { signal: ac.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (body.length > TEXT_PREVIEW_LIMIT) {
          setText(body.slice(0, TEXT_PREVIEW_LIMIT));
          setTruncated(true);
        } else {
          setText(body);
        }
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "불러오기 실패");
      });

    return () => ac.abort();
  }, [url]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-(--color-danger)">
        <AlertCircle className="h-6 w-6" />
        <span className="text-xs">{error}</span>
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="flex items-center justify-center gap-2 px-6 py-12 text-xs text-(--color-fg-4)">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중…
      </div>
    );
  }

  return (
    <>
      <pre className="m-0 max-h-[68vh] overflow-auto p-6 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-(--color-fg-2)">
        {text}
      </pre>
      {truncated && (
        <p className="px-6 pb-4 text-[11px] text-(--color-fg-4)">
          파일이 커서 앞부분만 표시했습니다 — 전체 내용은 다운로드하세요.
        </p>
      )}
    </>
  );
}
