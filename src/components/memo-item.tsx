"use client";

import {
  Download,
  File as FileIcon,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Link2,
  Pencil,
  StickyNote,
  Trash2,
} from "lucide-react";

import { beginMemoDrag, endMemoDrag } from "@/lib/dnd";
import {
  MEMO_DND_TYPE,
  fileUrl,
  hostnameOf,
  memoLabel,
  thumbUrl,
  formatBytes,
  type MemoDTO,
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

export interface MemoActions {
  onOpen: (memo: MemoDTO) => void;
  onEdit: (memo: MemoDTO) => void;
  onDelete: (memo: MemoDTO) => void;
}

/** 메모 종류 아이콘 — 썸네일이 없을 때 대신 보여준다. */
export function MemoIcon({
  memo,
  className,
}: {
  memo: MemoDTO;
  className?: string;
}) {
  const kind = memo.file?.kind;
  if (memo.type === "text") return <StickyNote className={className} />;
  if (memo.type === "link") return <Link2 className={className} />;
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "pdf") return <FileText className={className} />;
  if (kind === "text") return <FileCode2 className={className} />;
  return <FileIcon className={className} />;
}

/** 썸네일 또는 아이콘/파비콘. */
function Thumb({ memo, size }: { memo: MemoDTO; size: "sm" | "lg" }) {
  const box =
    size === "sm"
      ? "h-10 w-10 rounded-md"
      : "h-full w-full rounded-none";

  if (memo.type === "link" && memo.iconUrl) {
    return (
      <div
        className={cn(
          "grid shrink-0 place-items-center bg-(--color-bg-2)",
          box,
          size === "lg" && "p-6",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={memo.iconUrl}
          alt=""
          className={cn(
            "object-contain",
            size === "sm" ? "h-6 w-6" : "h-full w-full max-h-16 max-w-16",
          )}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>
    );
  }

  if (memo.file?.hasThumb) {
    return (
      <div className={cn("thumb-checker shrink-0 overflow-hidden", box)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl(memo.file.id)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center bg-(--color-bg-2) text-(--color-fg-4)",
        box,
      )}
    >
      <MemoIcon memo={memo} className={size === "sm" ? "h-4 w-4" : "h-8 w-8"} />
    </div>
  );
}

function ActionButtons({
  memo,
  actions,
  floating,
}: {
  memo: MemoDTO;
  actions: MemoActions;
  floating?: boolean;
}) {
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const btn =
    "grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg)";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100",
        floating &&
          "absolute top-1.5 right-1.5 rounded-lg bg-(--color-surface)/90 p-0.5 ring-1 ring-(--color-border-soft) backdrop-blur-sm",
      )}
    >
      {memo.file && (
        <a
          href={fileUrl(memo.file.id, true)}
          download={memo.file.name}
          onClick={(e) => e.stopPropagation()}
          className={btn}
          aria-label="다운로드"
          title="다운로드"
        >
          <Download className="h-3 w-3" />
        </a>
      )}
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          actions.onEdit(memo);
        }}
        className={btn}
        aria-label="편집"
        title="편집"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          stop(e);
          actions.onDelete(memo);
        }}
        className={cn(btn, "hover:bg-(--color-danger)/20 hover:text-(--color-danger)")}
        aria-label="삭제"
        title="삭제"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * 항목 전체를 클릭/키보드로 열 수 있게 하고, 다른 메모함으로 끌어 옮길 수 있게 하는 공통 props.
 */
function openTriggerProps(memo: MemoDTO, actions: MemoActions) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": memoLabel(memo) || "메모 열기",
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const payload = { id: memo.id, notebookId: memo.notebookId };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(MEMO_DND_TYPE, JSON.stringify(payload));
      // 앱 밖으로 떨어뜨렸을 때를 위한 최소한의 대체 표현
      e.dataTransfer.setData("text/plain", memoLabel(memo));
      beginMemoDrag(payload);
    },
    onDragEnd: () => endMemoDrag(),
    onClick: () => actions.onOpen(memo),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return; // 내부 버튼의 Enter 는 그대로
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        actions.onOpen(memo);
      }
    },
  };
}

/** 메모 부제 — 링크는 URL, 파일은 용량, 텍스트는 시각. */
function subtitleOf(memo: MemoDTO): string {
  if (memo.type === "link") return memo.url ?? "";
  if (memo.file) {
    const ext = memo.file.ext ? memo.file.ext.toUpperCase() : "FILE";
    return `${ext} · ${formatBytes(memo.file.size)}`;
  }
  return formatRelativeTime(memo.createdAt);
}

// ─────────────────────────────────────────────────────────────
//   리스트 뷰 행
// ─────────────────────────────────────────────────────────────

export function MemoRow({
  memo,
  actions,
}: {
  memo: MemoDTO;
  actions: MemoActions;
}) {
  const label = memoLabel(memo);
  const sub = subtitleOf(memo);

  return (
    <li
      className="group flex cursor-pointer items-start gap-2.5 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) focus-visible:ring-(--color-accent)"
      {...openTriggerProps(memo, actions)}
    >
      <Thumb memo={memo} size="sm" />

      <div className="min-w-0 flex-1">
        {memo.type === "text" ? (
          <>
            <p className="line-clamp-3 break-words whitespace-pre-wrap text-sm leading-relaxed text-(--color-fg-2)">
              {memo.text}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-(--color-fg-4)">
              {sub}
            </p>
          </>
        ) : (
          <>
            <div className="truncate text-sm text-(--color-fg)">{label}</div>
            <div className="truncate font-mono text-[11px] text-(--color-fg-4)">
              {sub}
            </div>
          </>
        )}
      </div>

      <ActionButtons memo={memo} actions={actions} />
    </li>
  );
}

// ─────────────────────────────────────────────────────────────
//   그리드 뷰 타일
// ─────────────────────────────────────────────────────────────

export function MemoTile({
  memo,
  actions,
}: {
  memo: MemoDTO;
  actions: MemoActions;
}) {
  const label = memoLabel(memo);

  return (
    <li
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border-soft) transition hover:ring-(--color-accent)/50 focus-visible:ring-(--color-accent)"
      {...openTriggerProps(memo, actions)}
    >
      <div className="relative aspect-4/3 w-full overflow-hidden">
        {memo.type === "text" ? (
          <p className="scrollbar-thin h-full overflow-hidden break-words whitespace-pre-wrap p-2.5 text-[12px] leading-snug text-(--color-fg-2)">
            {memo.text}
          </p>
        ) : (
          <Thumb memo={memo} size="lg" />
        )}
        <ActionButtons memo={memo} actions={actions} floating />
      </div>

      <div className="border-t border-(--color-border-soft) px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <MemoIcon
            memo={memo}
            className="h-3 w-3 shrink-0 text-(--color-fg-4)"
          />
          <span className="truncate text-[11.5px] text-(--color-fg-2)">
            {memo.type === "text"
              ? formatRelativeTime(memo.createdAt) || "메모"
              : label}
          </span>
        </div>
        {memo.type !== "text" && (
          <div className="truncate font-mono text-[10px] text-(--color-fg-4)">
            {memo.type === "link"
              ? hostnameOf(memo.url ?? "")
              : subtitleOf(memo)}
          </div>
        )}
      </div>
    </li>
  );
}
