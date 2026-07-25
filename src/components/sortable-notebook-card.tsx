"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { NotebookDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { MemoActions } from "./memo-item";
import { NotebookCard, type NotebookHandlers } from "./notebook-card";

export function SortableNotebookCard({
  notebook,
  memoActions,
  handlers,
}: {
  notebook: NotebookDTO;
  memoActions: MemoActions;
  handlers: NotebookHandlers;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: notebook.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-60")}
    >
      <NotebookCard
        notebook={notebook}
        memoActions={memoActions}
        handlers={handlers}
        dragHandleProps={
          { ...attributes, ...listeners } as unknown as React.HTMLAttributes<HTMLButtonElement>
        }
      />
    </div>
  );
}
