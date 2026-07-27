"use client";

import {
  Download,
  File as FileIcon,
  GripVertical,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Link2,
  Pencil,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

import { activeMemoDrag, beginMemoDrag, endMemoDrag } from "@/lib/dnd";
import { useSwReady } from "@/lib/sw-client";
import {
  MEMO_DND_TYPE,
  hostnameOf,
  memoLabel,
  thumbUrl,
  formatBytes,
  viewUrl,
  type MemoDTO,
  type MemoDragPayload,
} from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

export interface MemoActions {
  onOpen: (memo: MemoDTO) => void;
  onEdit: (memo: MemoDTO) => void;
  onDelete: (memo: MemoDTO) => void;
  /** 다른 메모를 이 메모 위에 떨어뜨렸을 때 (같은 메모함이면 순서 변경). */
  onDropOnMemo: (payload: MemoDragPayload, target: MemoDTO) => void;
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
  const swReady = useSwReady();
  const box = size === "sm" ? "h-10 w-10 rounded-md" : "h-full w-full rounded-none";

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
          src={thumbUrl(memo.file, swReady)}
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
  const swReady = useSwReady();
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
          href={viewUrl(memo.file, { dl: true, swReady })}
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
 * 항목을 클릭/키보드로 열고, 끌어서 옮기고, 다른 메모를 받아 순서를 바꾸는 공통 props.
 *
 * 같은 메모함 안에서 떨어뜨리면 순서 변경, 다른 메모함이면 이동이다.
 * 판정에 필요한 출처 정보는 dragover 중 DataTransfer 값을 읽을 수 없어
 * lib/dnd 의 모듈 상태로 본다.
 */
export function useItemDnd(memo: MemoDTO, actions: MemoActions) {
  const [over, setOver] = useState<false | "self" | "reject">(false);
  const rowRef = useRef<HTMLElement | null>(null);

  const dragged = () => activeMemoDrag();
  const relevant = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(MEMO_DND_TYPE);

  /**
   * 끌기는 **손잡이에서만** 시작한다.
   * 행 전체를 draggable 로 두면 본문에서 마우스를 끄는 순간 이동이 시작되어
   * 텍스트를 선택하거나 복사할 수 없다.
   */
  const handleProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const payload: MemoDragPayload = {
        id: memo.id,
        notebookId: memo.notebookId,
        type: memo.type,
      };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(MEMO_DND_TYPE, JSON.stringify(payload));
      // 앱 밖으로 떨어뜨렸을 때를 위한 최소한의 대체 표현
      e.dataTransfer.setData("text/plain", memoLabel(memo));
      // 손잡이만 끌려가 보이지 않도록 행 전체를 드래그 이미지로 쓴다
      const row = rowRef.current;
      if (row) {
        const r = row.getBoundingClientRect();
        e.dataTransfer.setDragImage(row, e.clientX - r.left, e.clientY - r.top);
      }
      beginMemoDrag(payload);
    },
    onDragEnd: () => {
      endMemoDrag();
      setOver(false);
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  return {
    over,
    handleProps,
    props: {
      ref: rowRef as React.Ref<never>,
      role: "button" as const,
      tabIndex: 0,
      "aria-label": memoLabel(memo) || "메모 열기",

      onDragOver: (e: React.DragEvent) => {
        if (!relevant(e)) return;
        const d = dragged();
        if (!d || d.id === memo.id) return;
        // 같은 메모함일 때만 항목 위 드롭(=순서 변경)을 받는다.
        // 다른 메모함이면 카드 전체가 처리하도록 그대로 흘려보낸다.
        if (d.notebookId !== memo.notebookId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver("self");
      },
      onDragLeave: () => setOver(false),

      onDrop: (e: React.DragEvent) => {
        if (!relevant(e)) return;
        const raw = e.dataTransfer.getData(MEMO_DND_TYPE);
        setOver(false);
        if (!raw) return;
        let payload: MemoDragPayload;
        try {
          payload = JSON.parse(raw) as MemoDragPayload;
        } catch {
          return;
        }
        if (payload.notebookId !== memo.notebookId) return; // 카드가 처리
        e.preventDefault();
        e.stopPropagation();
        if (payload.id === memo.id) return;
        actions.onDropOnMemo(payload, memo);
      },

      onClick: () => actions.onOpen(memo),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return; // 내부 버튼의 Enter 는 그대로
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          actions.onOpen(memo);
        }
      },
    },
  };
}

/** 끌어 옮기기 손잡이. 여기서만 드래그가 시작된다. */
export function DragHandle({
  handleProps,
  className,
}: {
  handleProps: Record<string, unknown>;
  className?: string;
}) {
  return (
    <span
      {...handleProps}
      role="button"
      aria-label="끌어서 옮기기"
      title="끌어서 옮기기 / 순서 변경"
      className={cn(
        "grid w-4 shrink-0 cursor-grab place-items-center self-stretch rounded text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
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
  const { over, props, handleProps } = useItemDnd(memo, actions);

  return (
    <li
      {...props}
      className={cn(
        "group flex cursor-pointer items-start gap-2.5 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) focus-visible:ring-(--color-accent)",
        // 여기에 놓으면 이 항목 **앞**으로 들어간다
        over === "self" && "border-t-2 border-(--color-accent) pt-2",
      )}
    >
      <DragHandle handleProps={handleProps} />
      <Thumb memo={memo} size="sm" />

      {/* select-text — 본문은 끌어서 선택·복사할 수 있어야 한다 */}
      <div className="min-w-0 flex-1 select-text">
        {memo.type === "text" ? (
          <>
            <p className="line-clamp-3 break-words whitespace-pre-wrap text-sm leading-relaxed text-(--color-fg-2)">
              {memo.text}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-(--color-fg-4)">{sub}</p>
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
  const { over, props, handleProps } = useItemDnd(memo, actions);

  return (
    <li
      {...props}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg bg-(--color-bg-2) ring-1 ring-(--color-border-soft) transition hover:ring-(--color-accent)/50 focus-visible:ring-(--color-accent)",
        over === "self" && "border-l-2 border-(--color-accent)",
      )}
    >
      <div className="relative aspect-4/3 w-full overflow-hidden">
        {memo.type === "text" ? (
          <p className="scrollbar-thin h-full overflow-hidden break-words whitespace-pre-wrap p-2.5 text-[12px] leading-snug select-text text-(--color-fg-2)">
            {memo.text}
          </p>
        ) : (
          <Thumb memo={memo} size="lg" />
        )}
        <ActionButtons memo={memo} actions={actions} floating />
        <DragHandle
          handleProps={handleProps}
          className="absolute top-1.5 left-1.5 h-5 rounded bg-(--color-surface)/90 ring-1 ring-(--color-border-soft) backdrop-blur-sm"
        />
      </div>

      <div className="border-t border-(--color-border-soft) px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <MemoIcon memo={memo} className="h-3 w-3 shrink-0 text-(--color-fg-4)" />
          <span className="truncate text-[11.5px] text-(--color-fg-2)">
            {memo.type === "text"
              ? formatRelativeTime(memo.createdAt) || "메모"
              : label}
          </span>
        </div>
        {memo.type !== "text" && (
          <div className="truncate font-mono text-[10px] text-(--color-fg-4)">
            {memo.type === "link" ? hostnameOf(memo.url ?? "") : subtitleOf(memo)}
          </div>
        )}
      </div>
    </li>
  );
}
