"use client";

import {
  Loader2,
  NotebookText,
  RotateCcw,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn, formatDateTime } from "@/lib/utils";

interface TrashEntry {
  id: string;
  kind: "notebook" | "memo";
  label: string;
  notebookName: string | null;
  deletedAt: number;
  daysLeft: number;
  restorable: boolean;
}

/** 30일 휴지통 — 되살리기 / 지금 영구 삭제. */
export function TrashPanel({ retentionDays }: { retentionDays: number }) {
  const [entries, setEntries] = useState<TrashEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trash", { cache: "no-store" });
      const j = (await res.json()) as { trash?: TrashEntry[] };
      setEntries(j.trash ?? []);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "restore" | "purge") => {
    if (action === "purge" && !confirm("지금 영구 삭제할까요? 되돌릴 수 없습니다.")) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const j = (await res.json()) as { trash?: TrashEntry[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setEntries(j.trash ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-1 flex items-center gap-2 text-base font-medium text-(--color-fg)">
        <Trash2 className="h-4 w-4 text-(--color-fg-3)" />
        휴지통
      </header>
      <p className="mb-4 text-xs break-keep text-(--color-fg-4)">
        지운 메모함·메모는 <b>{retentionDays}일</b> 동안 여기 보관되고 그때까지
        되살릴 수 있습니다. 첨부 파일도 함께 남아 있다가 만료되면 같이
        지워집니다.
      </p>

      {entries === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-(--color-fg-4)">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중…
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) py-8 text-center text-xs text-(--color-fg-4)">
          휴지통이 비어 있습니다
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2.5 rounded-lg bg-(--color-bg-2) p-2.5 ring-1 ring-(--color-border-soft)"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-(--color-surface) text-(--color-fg-4)">
                {e.kind === "notebook" ? (
                  <NotebookText className="h-3.5 w-3.5" />
                ) : (
                  <StickyNote className="h-3.5 w-3.5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-(--color-fg)">
                  {e.label || "(제목 없음)"}
                </div>
                <div className="truncate font-mono text-[10.5px] text-(--color-fg-4)">
                  {e.kind === "notebook" ? "메모함" : (e.notebookName ?? "메모")}
                  {" · "}
                  {formatDateTime(e.deletedAt)}
                  {" · "}
                  {e.daysLeft}일 남음
                </div>
              </div>

              <button
                type="button"
                onClick={() => void act(e.id, "restore")}
                disabled={busy === e.id || !e.restorable}
                title={
                  e.restorable
                    ? "되살리기"
                    : "원래 메모함이 없습니다 — 메모함을 먼저 되살리세요"
                }
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] ring-1 transition",
                  e.restorable
                    ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40 hover:bg-(--color-accent)/25"
                    : "bg-(--color-surface) text-(--color-fg-4) ring-(--color-border-soft) opacity-60",
                )}
              >
                {busy === e.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="h-3 w-3" />
                )}
                되살리기
              </button>
              <button
                type="button"
                onClick={() => void act(e.id, "purge")}
                disabled={busy === e.id}
                title="지금 영구 삭제"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-4) transition hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-(--color-danger)">{error}</p>}
    </section>
  );
}
