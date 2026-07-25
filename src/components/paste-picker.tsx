"use client";

import { ClipboardPaste, Lock, X } from "lucide-react";
import { useEffect, useMemo } from "react";

import {
  acceptsFiles,
  looksLikeUrl,
  type MemoType,
  type NotebookDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type PendingPaste =
  | { kind: "files"; files: File[] }
  | { kind: "text"; text: string };

/**
 * 붙여넣기(Ctrl+V) 시 뜨는 플로팅 선택창 — 어느 메모함에 넣을지 고른다.
 * (드래그&드롭은 떨어뜨린 메모함이 곧 대상이라 이 창이 필요 없다)
 */
export function PastePicker({
  pending,
  notebooks,
  onPick,
  onCancel,
}: {
  pending: PendingPaste | null;
  notebooks: NotebookDTO[];
  onPick: (notebookId: string) => void;
  onCancel: () => void;
}) {
  /** 붙여넣은 것을 받을 수 있는 메모함만 고를 수 있다. */
  const targets = useMemo(() => {
    if (!pending) return [];
    if (pending.kind === "files") return notebooks.filter(acceptsFiles);
    const needed: MemoType = looksLikeUrl(pending.text) ? "link" : "text";
    return notebooks.filter(
      (n) => n.accepts.includes(needed) || n.accepts.includes("text"),
    );
  }, [pending, notebooks]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      // 1~9 로 빠르게 선택
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= Math.min(9, targets.length)) {
        onPick(targets[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, targets, onPick, onCancel]);

  if (!pending) return null;

  const summary =
    pending.kind === "files"
      ? pending.files.length === 1
        ? pending.files[0].name
        : `파일 ${pending.files.length}개`
      : looksLikeUrl(pending.text)
        ? pending.text
        : pending.text.replace(/\s+/g, " ").slice(0, 80);

  const typeLabel =
    pending.kind === "files"
      ? "붙여넣은 파일"
      : looksLikeUrl(pending.text)
        ? "붙여넣은 링크"
        : "붙여넣은 텍스트";

  return (
    <>
      {/* 바깥 클릭으로 취소 */}
      <div className="fixed inset-0 z-40" onClick={onCancel} aria-hidden />

      <div
        role="dialog"
        aria-label="붙여넣을 메모함 선택"
        className="fixed bottom-6 left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 rounded-[var(--radius-app)] bg-(--color-surface) p-4 shadow-2xl ring-1 ring-(--color-border)"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-(--color-accent-soft)">
              <ClipboardPaste className="h-4 w-4 text-(--color-accent-strong)" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-(--color-fg)">
                어느 메모함에 넣을까요?
              </div>
              <div className="truncate text-[11px] text-(--color-fg-4)">
                {typeLabel} · {summary}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            aria-label="취소"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {targets.length === 0 && (
          <p className="rounded-lg border border-dashed border-(--color-border) px-3 py-4 text-center text-xs break-keep text-(--color-fg-4)">
            이걸 받을 수 있는 메모함이 없습니다 — 먼저 메모함을 만드세요
          </p>
        )}

        <ul className="scrollbar-thin flex max-h-[40vh] flex-col gap-1 overflow-y-auto">
          {targets.map((nb, i) => (
            <li key={nb.id}>
              <button
                type="button"
                onClick={() => onPick(nb.id)}
                className="flex w-full items-center gap-2.5 rounded-lg bg-(--color-bg-2) px-3 py-2 text-left ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) hover:ring-(--color-accent)/50"
              >
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px]",
                    i < 9
                      ? "bg-(--color-surface) text-(--color-fg-3)"
                      : "text-transparent",
                  )}
                >
                  {i < 9 ? i + 1 : ""}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-(--color-fg)">
                  {nb.name}
                </span>
                {nb.systemKey && (
                  <Lock className="h-3 w-3 shrink-0 text-(--color-fg-4)" />
                )}
                <span className="shrink-0 font-mono text-[10.5px] text-(--color-fg-4)">
                  {nb.memos.length}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="mt-2.5 text-center text-[10.5px] text-(--color-fg-4)">
          숫자키로 빠르게 선택 · Esc 취소
        </p>
      </div>
    </>
  );
}
