"use client";

import { Check, StickyNote } from "lucide-react";

import { formatDue, type MemoDTO, type NotebookDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 에이전트 답변 안에 박히는 메모 조각.
 *
 * 에이전트는 id 만 말한다. 내용도 체크 상태도 화면이 이미 들고 있는 목록에서
 * 꺼내 쓴다 — 새 API 를 열지 않아도 되고, 목록 쪽 체크박스와 언제나 같은 값을
 * 본다. 에이전트가 몇 분 전에 읽은 옛 상태를 그대로 읊는 일이 생기지 않는다.
 *
 * 체크는 사람이 누를 때만 나간다. 에이전트가 할 수 있는 것은 "이 메모를
 * 보여 달라" 까지다.
 */

interface Props {
  notebooks: NotebookDTO[];
  memoId: string;
  /** true 면 한 줄을 통째로 쓰는 카드, false 면 문장 안에 끼는 작은 조각. */
  block: boolean;
  onToggle?: (memo: MemoDTO, done: boolean) => void;
}

function locate(
  notebooks: NotebookDTO[],
  id: string,
): { notebook: NotebookDTO; memo: MemoDTO } | null {
  for (const notebook of notebooks) {
    const memo = notebook.memos.find((m) => m.id === id);
    if (memo) return { notebook, memo };
  }
  return null;
}

function labelOf(m: MemoDTO): string {
  return (m.text || m.title || m.file?.name || m.url || "").trim() || "(빈 메모)";
}

export function MemoRef({ notebooks, memoId, block, onToggle }: Props) {
  const found = locate(notebooks, memoId);

  if (!found) {
    return (
      <span className="rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-4)">
        지워졌거나 없는 메모
      </span>
    );
  }

  const { notebook, memo } = found;
  const label = labelOf(memo);
  /*
   * 레거시 메모(Corkboard·Memo 의 옛 자료)는 done 을 담을 자리가 아예 없어
   * PATCH 가 조용히 무시한다. 눌러도 아무 일이 없는 체크박스를 그리느니
   * 처음부터 그리지 않는다.
   */
  const checkable =
    (notebook.kind === "checklist" || notebook.kind === "todo") && !memo.legacy;

  if (!block) {
    return (
      <span className="inline-flex max-w-full items-baseline gap-1 rounded bg-(--color-bg) px-1.5 py-0.5 text-[12px] text-(--color-fg-2) ring-1 ring-(--color-border-soft)">
        {checkable && (
          <Check
            className={cn(
              "h-3 w-3 shrink-0 self-center",
              memo.done ? "text-(--color-accent)" : "opacity-25",
            )}
            strokeWidth={3}
          />
        )}
        <span className={cn("truncate", memo.done && "line-through opacity-60")}>
          {label}
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-(--color-bg) px-3 py-2 ring-1 ring-(--color-border-soft)">
      {checkable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={memo.done}
          disabled={!onToggle}
          onClick={() => onToggle?.(memo, !memo.done)}
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition",
            memo.done
              ? "border-(--color-accent) bg-(--color-accent) text-(--color-bg)"
              : "border-(--color-border) hover:border-(--color-accent)",
            !onToggle && "cursor-default opacity-50",
          )}
          aria-label={memo.done ? "완료 취소" : "완료"}
        >
          {memo.done && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
      ) : (
        <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-(--color-fg-4)" />
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[13px] leading-relaxed break-words whitespace-pre-wrap",
            memo.done ? "text-(--color-fg-4) line-through" : "text-(--color-fg-2)",
          )}
        >
          {label}
        </p>
        <p className="mt-0.5 text-[11px] text-(--color-fg-4)">
          {notebook.name}
          {memo.dueAt != null && ` · ${formatDue(memo.dueAt)}`}
        </p>
      </div>
    </div>
  );
}
