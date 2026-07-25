"use client";

import { Inbox } from "lucide-react";

import type { MemoDTO, ViewMode } from "@/lib/types";

import { MemoRow, MemoTile, type MemoActions } from "./memo-item";

export function MemoList({
  memos,
  viewMode,
  actions,
  emptyHint,
}: {
  memos: MemoDTO[];
  viewMode: ViewMode;
  actions: MemoActions;
  emptyHint?: string;
}) {
  if (memos.length === 0) {
    return (
      // break-keep — 한국어가 좁은 카드(6단)에서 음절 중간에 끊기지 않게
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-4)">
        <Inbox className="mx-auto mb-1.5 h-4 w-4" />
        {emptyHint ?? "메모가 없습니다"}
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
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
