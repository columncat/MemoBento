"use client";

import {
  Check,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Maximize2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { activeMemoDrag } from "@/lib/dnd";
import {
  MEMO_DND_TYPE,
  looksLikeUrl,
  type MemoDragPayload,
  type NotebookDTO,
  type ViewMode,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { MemoList } from "./memo-list";
import type { MemoActions } from "./memo-item";

export interface NotebookHandlers {
  addText: (notebookId: string, text: string) => Promise<void>;
  addLink: (notebookId: string, url: string) => Promise<void>;
  addFiles: (notebookId: string, files: File[]) => Promise<void>;
  /** 메모를 다른 메모함으로 이동. */
  moveMemo: (memoId: string, toNotebookId: string) => Promise<void>;
  setViewMode: (notebookId: string, mode: ViewMode) => void;
  rename: (notebookId: string, name: string) => void;
  remove: (notebookId: string) => void;
  expand: (notebook: NotebookDTO) => void;
}

interface Props {
  notebook: NotebookDTO;
  memoActions: MemoActions;
  handlers: NotebookHandlers;
  /** dnd-kit 드래그 핸들 props (정렬용). 없으면 핸들을 숨긴다. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  /** 확대 모달 안에서 쓸 때는 카드 높이를 고정하지 않는다. */
  flush?: boolean;
}

export function NotebookCard({
  notebook,
  memoActions,
  handlers,
  dragHandleProps,
  flush,
}: Props) {
  const [input, setInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(notebook.name);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const locked = !!notebook.systemKey;

  // ─ 메모 추가 (URL 처럼 보이면 링크 메모, 아니면 텍스트 메모) ─
  const submit = async () => {
    const value = input.trim();
    if (!value) return;
    setInput("");
    try {
      if (looksLikeUrl(value)) await handlers.addLink(notebook.id, value);
      else await handlers.addText(notebook.id, value);
    } catch {
      setInput(value); // 실패하면 입력 복구
    }
  };

  // ─ 파일 투입 (DnD / 파일 선택) ─
  const takeFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      await handlers.addFiles(notebook.id, files);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);

    // 1) 다른 메모함에서 끌어온 메모 → 이동
    const memoRaw = e.dataTransfer.getData(MEMO_DND_TYPE);
    if (memoRaw) {
      try {
        const p = JSON.parse(memoRaw) as MemoDragPayload;
        if (p.notebookId === notebook.id) return; // 제자리
        await handlers.moveMemo(p.id, notebook.id);
      } catch {
        /* 손상된 페이로드 무시 */
      }
      return;
    }

    // 2) 파일
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) {
      await takeFiles(files);
      return;
    }

    // 3) 그 외엔 URL / 텍스트로 처리
    const uri = e.dataTransfer.getData("text/uri-list").trim();
    const text = e.dataTransfer.getData("text/plain").trim();
    const payload = uri || text;
    if (!payload) return;
    if (looksLikeUrl(payload)) await handlers.addLink(notebook.id, payload);
    else await handlers.addText(notebook.id, payload);
  };

  /**
   * 이 드래그를 이 카드가 받는가.
   * 자기 메모함에서 나온 메모는 제자리이므로 받지 않는다 (오버레이도 안 뜸).
   */
  const accepts = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(MEMO_DND_TYPE)) {
      return activeMemoDrag()?.notebookId !== notebook.id;
    }
    return e.dataTransfer.types.includes("Files");
  };

  const saveName = () => {
    setEditingName(false);
    const name = draftName.trim();
    if (name && name !== notebook.name) handlers.rename(notebook.id, name);
    else setDraftName(notebook.name);
  };

  const iconBtn =
    "grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)";

  return (
    <article
      onDragEnter={(e) => {
        if (!accepts(e)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MEMO_DND_TYPE)
          ? "move"
          : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        // @container — 6단처럼 카드가 좁아지면 헤더 버튼을 컨테이너 폭 기준으로 접는다
        "group/card @container relative flex flex-col rounded-[var(--radius-card)] bg-(--color-surface) ring-1 ring-(--color-border-soft) transition",
        flush ? "h-full min-h-0" : "h-[460px]",
        dragging && "ring-2 ring-(--color-accent)",
      )}
    >
      {/* 헤더 */}
      <header
        className={cn(
          "flex flex-col items-start gap-1.5 border-b border-(--color-border-soft) px-4 py-3",
          // 카드가 좁으면(6단 등) 제목 줄 / 버튼 줄로 나눠 어느 것도 잘리지 않게 한다
          "@[330px]:flex-row @[330px]:items-center @[330px]:justify-between @[330px]:gap-2",
          // 확대 모달의 닫기 버튼과 겹치지 않게 여백 확보
          flush && "pr-12",
        )}
      >
        <div className="flex w-full min-w-0 items-center gap-2 @[330px]:w-auto">
          {dragHandleProps && (
            <button
              type="button"
              {...dragHandleProps}
              className="grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-(--color-fg-4) opacity-0 transition group-hover/card:opacity-100 hover:text-(--color-fg-2) active:cursor-grabbing"
              aria-label="메모함 순서 바꾸기"
              title="드래그로 순서 변경"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setDraftName(notebook.name);
                  setEditingName(false);
                }
              }}
              maxLength={60}
              className="min-w-0 flex-1 rounded-md bg-(--color-bg-2) px-2 py-1 text-sm text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none"
            />
          ) : (
            // title 은 래퍼에 둔다 — h2 에 붙이면 접근성 이름이 툴팁으로 덮인다
            <div
              className="min-w-0"
              title={
                locked
                  ? "시스템 예약 메모함 — 이름 변경 불가"
                  : "더블클릭해서 이름 변경"
              }
            >
              <h2
                onDoubleClick={() => {
                  if (locked) return;
                  setDraftName(notebook.name);
                  setEditingName(true);
                }}
                className="truncate text-[17px] leading-tight"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                {notebook.name}
              </h2>
            </div>
          )}

          {locked && (
            <Lock
              className="h-3 w-3 shrink-0 text-(--color-fg-4)"
              aria-label="시스템 예약 메모함"
            />
          )}
          <span className="shrink-0 font-mono text-[11px] text-(--color-fg-4)">
            {String(notebook.memos.length).padStart(2, "0")}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {uploading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-(--color-accent)" />
          )}

          {/* 리스트 / 그리드 */}
          <div className="mr-1 flex items-center rounded-md bg-(--color-bg-2) p-0.5 ring-1 ring-(--color-border-soft)">
            {(
              [
                { mode: "list" as const, Icon: List, label: "리스트 보기" },
                { mode: "grid" as const, Icon: LayoutGrid, label: "그리드 보기" },
              ]
            ).map(({ mode, Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => handlers.setViewMode(notebook.id, mode)}
                aria-pressed={notebook.viewMode === mode}
                aria-label={label}
                title={label}
                className={cn(
                  "grid h-5 w-6 place-items-center rounded transition",
                  notebook.viewMode === mode
                    ? "bg-(--color-accent-soft) text-(--color-accent-strong)"
                    : "text-(--color-fg-4) hover:text-(--color-fg-2)",
                )}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={iconBtn}
            aria-label="파일 추가"
            title="파일 추가 (드래그해서 놓아도 됩니다)"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>

          {!flush && (
            <button
              type="button"
              onClick={() => handlers.expand(notebook)}
              className={iconBtn}
              aria-label="크게 보기"
              title="크게 보기"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}

          {!locked && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraftName(notebook.name);
                  setEditingName(true);
                }}
                className={cn(iconBtn, "opacity-0 group-hover/card:opacity-100")}
                aria-label="이름 변경"
                title="이름 변경"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handlers.remove(notebook.id)}
                className={cn(
                  iconBtn,
                  "opacity-0 group-hover/card:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)",
                )}
                aria-label="메모함 삭제"
                title="메모함 삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      {/* 입력 — 텍스트면 텍스트 메모, URL 이면 링크 메모 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex shrink-0 gap-2 px-4 pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter = 추가, Shift/Alt+Enter = 개행
            if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="메모 또는 URL 입력 후 Enter"
          maxLength={20000}
          rows={2}
          className="scrollbar-thin flex-1 resize-none rounded-lg bg-(--color-bg-2) px-3 py-2 text-sm leading-relaxed text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none placeholder:text-(--color-fg-4) focus:ring-(--color-accent)/60"
        />
        <button
          type="submit"
          className="flex shrink-0 items-center gap-1 self-stretch rounded-lg bg-(--color-accent) px-3 text-sm font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
          aria-label="메모 추가"
        >
          <Plus className="h-4 w-4" />
        </button>
      </form>

      {/* 본문 */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MemoList
          memos={notebook.memos}
          viewMode={notebook.viewMode}
          actions={memoActions}
          emptyHint="메모를 입력하거나 파일을 끌어다 놓으세요"
        />
      </div>

      {/* 드래그 오버레이 */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] bg-(--color-bg)/80 backdrop-blur-[2px]">
          <Upload className="h-6 w-6 text-(--color-accent)" />
          <span className="px-3 text-center text-sm font-medium break-keep text-(--color-fg-2)">
            {notebook.name} 으로
          </span>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void takeFiles(files);
        }}
      />
    </article>
  );
}

/** 대시보드 맨 끝의 "새 메모함" 카드 — 클릭 한 번으로 인라인 생성. */
export function AddNotebookCard({
  onCreate,
}: {
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const value = name.trim();
    if (!value) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onCreate(value);
      setName("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[460px] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-(--color-border) text-(--color-fg-4) transition hover:border-(--color-accent)/60 hover:bg-(--color-surface)/40 hover:text-(--color-fg-2)"
      >
        <Plus className="h-6 w-6" />
        <span className="text-sm">새 메모함</span>
      </button>
    );
  }

  return (
    <div className="flex h-[460px] flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-(--color-accent)/60 bg-(--color-surface)/40 px-6">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
        placeholder="메모함 이름"
        maxLength={60}
        className="w-full rounded-lg bg-(--color-bg-2) px-3 py-2 text-center text-sm text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none placeholder:text-(--color-fg-4)"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setName("");
            setOpen(false);
          }}
          className="rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-full bg-(--color-accent) px-3.5 py-1.5 text-xs font-medium text-(--color-bg) hover:bg-(--color-accent-strong) disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          만들기
        </button>
      </div>
    </div>
  );
}
