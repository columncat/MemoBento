"use client";

import { CalendarDays, Check, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  formatDue,
  isOverdue,
  toDateInput,
  type MemoDTO,
  type NotebookKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import type { MemoActions } from "./memo-item";

export interface ChecklistActions {
  /** 완료 토글. */
  onToggle: (memo: MemoDTO, done: boolean) => void;
  /** 기한 설정 / 해제 (TODO 전용). */
  onDue: (memo: MemoDTO, dueAt: number | null) => void;
  /** 본문 수정. */
  onRename: (memo: MemoDTO, text: string) => void;
}

/**
 * 체크리스트 / TODO 항목 한 줄.
 *
 * 일반 메모 행보다 훨씬 얇다 — 썸네일도, 부제도 없이 체크박스와 한 줄 텍스트만
 * 둔다. TODO 면 오른쪽에 기한 칩이 붙고, 지난 기한은 붉게 표시한다.
 */
export function ChecklistRow({
  memo,
  kind,
  actions,
  memoActions,
  dnd,
}: {
  memo: MemoDTO;
  kind: NotebookKind;
  actions: ChecklistActions;
  memoActions: MemoActions;
  /** 순서 변경용 DnD props (memo-item 과 동일 규약). */
  dnd: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text ?? "");
  const dateRef = useRef<HTMLInputElement | null>(null);
  const overdue = isOverdue(memo.dueAt, memo.done);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (memo.text ?? "")) actions.onRename(memo, next);
    else setDraft(memo.text ?? "");
  };

  return (
    <li
      {...dnd}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-(--color-surface-hi)",
        memo.done && "opacity-60",
      )}
    >
      {/* 체크박스 */}
      <button
        type="button"
        role="checkbox"
        aria-checked={memo.done}
        onClick={(e) => {
          e.stopPropagation();
          actions.onToggle(memo, !memo.done);
        }}
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded border transition",
          memo.done
            ? "border-(--color-accent) bg-(--color-accent) text-(--color-bg)"
            : "border-(--color-border) hover:border-(--color-accent)",
        )}
        aria-label={memo.done ? "완료 취소" : "완료"}
      >
        {memo.done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* 본문 — 클릭하면 그 자리에서 고친다 */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(memo.text ?? "");
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-0.5 text-[13px] text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none"
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setDraft(memo.text ?? "");
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 cursor-text truncate text-[13px] text-(--color-fg-2)",
            memo.done && "line-through",
          )}
          title={memo.text ?? ""}
        >
          {memo.text}
        </span>
      )}

      {/* 기한 (TODO 전용) */}
      {kind === "todo" && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // showPicker 를 지원하면 달력을 바로 띄운다
              const el = dateRef.current;
              if (!el) return;
              if (typeof el.showPicker === "function") el.showPicker();
              else el.focus();
            }}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition",
              memo.dueAt
                ? overdue
                  ? "bg-(--color-danger)/15 text-(--color-danger)"
                  : "bg-(--color-bg-2) text-(--color-fg-3)"
                : "text-(--color-fg-4) opacity-0 group-hover:opacity-100",
            )}
            title={memo.dueAt ? "기한 변경" : "기한 지정"}
          >
            <CalendarDays className="h-3 w-3" />
            {memo.dueAt ? formatDue(memo.dueAt) : "기한"}
          </button>
          <input
            ref={dateRef}
            type="date"
            value={toDateInput(memo.dueAt)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value;
              actions.onDue(memo, v ? new Date(v + "T12:00:00").getTime() : null);
            }}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
            tabIndex={-1}
            aria-label="기한"
          />
        </div>
      )}

      {kind === "todo" && memo.dueAt && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onDue(memo, null);
          }}
          className="shrink-0 rounded px-1 text-[10px] text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 hover:text-(--color-fg-2)"
          title="기한 해제"
        >
          ✕
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          memoActions.onDelete(memo);
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
        aria-label="삭제"
        title="삭제"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
}
