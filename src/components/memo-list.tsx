"use client";

import { Inbox } from "lucide-react";

import type { MemoDTO, NotebookKind, ViewMode } from "@/lib/types";

import { ChecklistRow, type ChecklistActions } from "./checklist-item";
import { MemoRow, MemoTile, useItemDnd, type MemoActions } from "./memo-item";

export function MemoList({
  memos,
  viewMode,
  kind,
  actions,
  checklistActions,
  emptyHint,
}: {
  memos: MemoDTO[];
  viewMode: ViewMode;
  kind: NotebookKind;
  actions: MemoActions;
  checklistActions: ChecklistActions;
  emptyHint?: string;
}) {
  if (memos.length === 0) {
    // break-keep — 한국어가 좁은 카드(6단)에서 음절 중간에 끊기지 않게
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-4)">
        <Inbox className="mx-auto mb-1.5 h-4 w-4" />
        {emptyHint ?? "메모가 없습니다"}
      </div>
    );
  }

  // 체크리스트·TODO 는 보기 방식과 무관하게 얇은 한 줄로 그린다
  if (kind === "checklist" || kind === "todo") {
    return (
      <ul className="flex flex-col">
        {memos.map((m) => (
          <ChecklistItem
            key={m.id}
            memo={m}
            kind={kind}
            actions={checklistActions}
            memoActions={actions}
          />
        ))}
      </ul>
    );
  }

  if (viewMode === "grid") {
    // 카드 폭과 무관하게 한 행에 3개 고정
    return (
      <ul className="grid grid-cols-3 gap-2">
        {memos.map((m) => (
          <MemoTile key={m.id} memo={m} actions={actions} />
        ))}
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {memos.map((m) => (
        <MemoRow key={m.id} memo={m} actions={actions} />
      ))}
    </ul>
  );
}

/** 훅을 쓰기 위한 얇은 래퍼 — 순서 변경 DnD 는 일반 메모와 같은 규약을 쓴다. */
function ChecklistItem({
  memo,
  kind,
  actions,
  memoActions,
}: {
  memo: MemoDTO;
  kind: NotebookKind;
  actions: ChecklistActions;
  memoActions: MemoActions;
}) {
  const { over, props } = useItemDnd(memo, memoActions);
  return (
    <ChecklistRow
      memo={memo}
      kind={kind}
      actions={actions}
      memoActions={memoActions}
      dnd={{
        ...props,
        // 한 줄 항목에서는 클릭이 편집이므로 열기 동작을 뺀다
        onClick: undefined,
        className: undefined,
        style: over === "self" ? { boxShadow: "inset 0 2px 0 var(--color-accent)" } : undefined,
      }}
    />
  );
}
