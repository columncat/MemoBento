"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import type { NotebookDTO } from "@/lib/types";

import type { MemoActions } from "./memo-item";
import { NotebookCard, type NotebookHandlers } from "./notebook-card";

/** 메모함 하나를 넓게 펼쳐보는 모달. 카드와 완전히 같은 기능을 쓴다. */
export function NotebookModal({
  notebook,
  memoActions,
  handlers,
  onClose,
}: {
  notebook: NotebookDTO | null;
  memoActions: MemoActions;
  handlers: NotebookHandlers;
  onClose: () => void;
}) {
  if (!notebook) return null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 z-40 flex h-[86vh] w-[min(1200px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] shadow-2xl"
        >
          <Dialog.Title className="sr-only">{notebook.name}</Dialog.Title>
          <Dialog.Close className="absolute top-3 right-3 z-10 grid h-8 w-8 place-items-center rounded-md bg-(--color-surface)/80 text-(--color-fg-3) backdrop-blur-sm hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
            <X className="h-4 w-4" />
          </Dialog.Close>
          <NotebookCard
            notebook={notebook}
            memoActions={memoActions}
            handlers={handlers}
            flush
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
