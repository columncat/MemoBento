"use client";

import { CalendarDays, CalendarOff, Check, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  formatDue,
  isOverdue,
  type MemoDTO,
  type NotebookKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { DuePanel } from "./due-picker";
import { DragHandle, type MemoActions } from "./memo-item";

const ctlBtn =
  "grid h-5 w-5 place-items-center rounded text-(--color-fg-4) transition hover:bg-(--color-bg-2) hover:text-(--color-fg-2)";

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
  handleProps,
}: {
  memo: MemoDTO;
  kind: NotebookKind;
  actions: ChecklistActions;
  memoActions: MemoActions;
  /** 순서 변경용 DnD props (memo-item 과 동일 규약). */
  dnd: Record<string, unknown>;
  /** 끌기를 시작하는 손잡이 props. */
  handleProps: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text ?? "");
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const dueBtnRef = useRef<HTMLButtonElement | null>(null);
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
        "group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 transition hover:bg-(--color-surface-hi)",
        memo.done && "opacity-60",
      )}
    >
      {/* 손잡이는 얇게, 체크박스 바로 옆에. 넓게 잡으면 한 줄짜리 항목에서
          손잡이가 본문만큼 자리를 먹는다. */}
      <DragHandle handleProps={handleProps} className="mr-0.5 h-4 w-2" />

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
            "min-w-0 flex-1 cursor-text truncate text-[13px] select-text text-(--color-fg-2)",
            memo.done && "line-through",
          )}
          title={memo.text ?? ""}
        >
          {memo.text}
        </span>
      )}

      {/* 기한 라벨 — 자리를 차지한다. 마우스를 올리면 이 자리에 컨트롤이 뜬다. */}
      {kind === "todo" && memo.dueAt && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] group-hover:invisible",
            overdue
              ? "bg-(--color-danger)/15 text-(--color-danger)"
              : "bg-(--color-bg-2) text-(--color-fg-3)",
          )}
        >
          <CalendarDays className="h-3 w-3" />
          {formatDue(memo.dueAt)}
        </span>
      )}

      {/*
        컨트롤은 흐름 밖에 둔다. 숨어 있을 때 자리를 먹지 않아야 본문이 줄 끝까지
        쓴다 — 예전에는 라벨과 버튼 둘이 늘 자리를 차지해 한 줄짜리 항목에서
        본문이 그만큼 잘렸다. 배경을 줄 호버 색과 같게 맞춰 글자 위에 겹쳐도
        읽히지 않게 한다.

        고치는 중에는 띄우지 않는다. 입력칸 오른쪽 끝을 가린다.
      */}
      {!editing && (
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-(--color-surface-hi) pl-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {kind === "todo" && (
            <span className="relative">
              <button
                ref={dueBtnRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDuePickerOpen((v) => !v);
                }}
                className={ctlBtn}
                aria-label={memo.dueAt ? "기한 변경" : "기한 지정"}
                title={memo.dueAt ? "기한 변경" : "기한 지정"}
              >
                <CalendarDays className="h-3 w-3" />
              </button>
              {/*
                `<input type="date">` 로는 시각을 정할 수 없다. 날짜만 필요한
                항목이 많지만 "화요일 10시" 같은 것도 흔해서 같은 패널을 쓴다.
              */}
              {duePickerOpen && (
                <DuePanel
                  value={memo.dueAt}
                  anchor={dueBtnRef.current}
                  align="right"
                  onCancel={() => setDuePickerOpen(false)}
                  onPick={(next) => {
                    actions.onDue(memo, next);
                    setDuePickerOpen(false);
                  }}
                />
              )}
            </span>
          )}

          {kind === "todo" && memo.dueAt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onDue(memo, null);
              }}
              className={ctlBtn}
              aria-label="기한 해제"
              title="기한 해제"
            >
              <CalendarOff className="h-3 w-3" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              memoActions.onDelete(memo);
            }}
            className={cn(ctlBtn, "hover:bg-(--color-danger)/20 hover:text-(--color-danger)")}
            aria-label="삭제"
            title="삭제"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

    </li>
  );
}
