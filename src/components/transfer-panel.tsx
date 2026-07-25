"use client";

import { AlertCircle, CheckCircle2, Loader2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  cancelTransfer,
  clearFinishedTransfers,
  subscribeTransfers,
  type TransferItem,
} from "@/lib/transfer-queue";
import { formatBytes } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 헤더 버튼에 띄울 요약 — 진행 중 건수. */
export function useTransferSummary() {
  const [items, setItems] = useState<TransferItem[]>([]);
  useEffect(() => subscribeTransfers(setItems), []);
  const active = items.filter((i) =>
    ["queued", "preparing", "uploading"].includes(i.status),
  );
  return { total: items.length, active: active.length };
}

/** 업로드 큐 패널. 열려 있을 때만 그린다 (헤더 버튼으로 토글). */
export function TransferPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TransferItem[]>([]);

  useEffect(() => subscribeTransfers(setItems), []);

  if (!open) return null;

  const active = items.filter((i) =>
    ["queued", "preparing", "uploading"].includes(i.status),
  );
  const totalSize = active.reduce((s, i) => s + i.size, 0);
  const totalSent = active.reduce((s, i) => s + i.sent, 0);

  return (
    <div className="fixed right-6 bottom-6 z-50 w-[min(380px,90vw)] rounded-[var(--radius-app)] bg-(--color-surface) shadow-2xl ring-1 ring-(--color-border)">
      <header className="flex items-center justify-between gap-2 border-b border-(--color-border-soft) px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Upload className="h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
          <span className="truncate text-xs font-medium text-(--color-fg-2)">
            {active.length > 0
              ? `업로드 ${active.length}건 · ${formatBytes(totalSent)} / ${formatBytes(totalSize)}`
              : "업로드 완료"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={clearFinishedTransfers}
            className="rounded-md px-2 py-1 text-[11px] text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            title="끝난 항목 치우기"
          >
            치우기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md text-(--color-fg-4) hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            aria-label="닫기"
            title="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {items.length === 0 && (
        <p className="px-4 py-6 text-center text-xs break-keep text-(--color-fg-4)">
          전송 중인 항목이 없습니다
        </p>
      )}

      <ul className="scrollbar-thin max-h-[45vh] overflow-y-auto p-2">
        {items.map((it) => {
          const pct = it.size > 0 ? Math.round((it.sent / it.size) * 100) : 0;
          return (
            <li key={it.id} className="rounded-lg px-2 py-1.5">
              <div className="flex items-center gap-2">
                <StatusIcon status={it.status} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-(--color-fg-2)">
                  {it.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-(--color-fg-4)">
                  {it.status === "uploading"
                    ? `${pct}%`
                    : it.status === "done"
                      ? formatBytes(it.size)
                      : it.status === "preparing"
                        ? "준비"
                        : ""}
                </span>
                {["queued", "preparing", "uploading"].includes(it.status) && (
                  <button
                    type="button"
                    onClick={() => cancelTransfer(it.id)}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-danger)"
                    aria-label="취소"
                    title="취소"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {it.status === "uploading" && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-(--color-bg-2)">
                  <div
                    className="h-full rounded-full bg-(--color-accent) transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {it.error && (
                <p className="mt-0.5 truncate text-[10.5px] text-(--color-danger)">
                  {it.error}
                </p>
              )}
              <p className="truncate text-[10px] text-(--color-fg-4)">
                → {it.notebookName}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: TransferItem["status"] }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (status === "done")
    return <CheckCircle2 className={cn(cls, "text-(--color-accent-strong)")} />;
  if (status === "error")
    return <AlertCircle className={cn(cls, "text-(--color-danger)")} />;
  if (status === "canceled")
    return <X className={cn(cls, "text-(--color-fg-4)")} />;
  return <Loader2 className={cn(cls, "animate-spin text-(--color-accent)")} />;
}
