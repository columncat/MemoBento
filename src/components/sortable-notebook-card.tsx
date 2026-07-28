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

  const {
    role: _role,
    tabIndex: _tabIndex,
    ...dragAria
  } = attributes;

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
        // role / tabIndex 는 빼고 넘긴다. 손잡이가 머리말 자체라, 버튼을
        // 여럿 품은 <header> 에 role="button" 을 씌우면 그 안의 버튼들이
        // 보조기술에서 묻힌다. 실제 끌기는 포인터 리스너가 맡는다.
        dragHandleProps={
          {
            ...dragAria,
            ...listeners,
          } as unknown as React.HTMLAttributes<HTMLElement>
        }
      />
    </div>
  );
}
