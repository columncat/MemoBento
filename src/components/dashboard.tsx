"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  AlertCircle,
  ArrowUpFromLine,
  Link2,
  NotebookPen,
  RefreshCw,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/client-api";
import { registerDecryptWorker, useSwReady } from "@/lib/sw-client";
import {
  enqueueUploads,
  setTransferSink,
} from "@/lib/transfer-queue";
import {
  COLUMN_CLASS,
  DEFAULT_COLUMNS,
  STORAGE_KEYS,
  confirmMemoDelete,
  type ColumnsPref,
} from "@/lib/preferences";
import {
  autoIconUrl,
  looksLikeUrl,
  viewUrl,
  type MemoDTO,
  type NotebookDTO,
  type ViewMode,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { MailBentoLink } from "./cross-app-link";
import type { MemoActions } from "./memo-item";
import { MemoViewer } from "./memo-viewer";
import { NotebookModal } from "./notebook-modal";
import { AddNotebookCard, type NotebookHandlers } from "./notebook-card";
import { PastePicker, type PendingPaste } from "./paste-picker";
import { TransferPanel, useTransferSummary } from "./transfer-panel";
import { SortableNotebookCard } from "./sortable-notebook-card";

export function Dashboard({
  initialNotebooks,
  legacySynced,
  mailbentoUrl,
}: {
  initialNotebooks: NotebookDTO[];
  /** MAILBENTO_DB_PATH 로 MailBento DB 와 직접 동기화 중인가. */
  legacySynced: boolean;
  /** MAILBENTO_URL override. null 이면 현재 호스트의 3000 포트로 유추. */
  mailbentoUrl: string | null;
}) {
  const [notebooks, setNotebooks] = useState<NotebookDTO[]>(initialNotebooks);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [columns, setColumns] = useState<ColumnsPref>(DEFAULT_COLUMNS);
  const [pending, setPending] = useState<PendingPaste | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─ 에러 토스트 ─
  const fail = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "요청에 실패했습니다");
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  /** 모든 변경 API 는 갱신된 목록을 돌려준다 — 그대로 상태에 반영. */
  const run = useCallback(
    async (fn: () => Promise<NotebookDTO[]>) => {
      try {
        setNotebooks(await fn());
      } catch (e) {
        fail(e);
        throw e;
      }
    },
    [fail],
  );

  // ─ 복호화 서비스 워커 + 업로드 큐 배선 ─
  const swReady = useSwReady();
  const transfers = useTransferSummary();
  useEffect(() => {
    registerDecryptWorker();
    setTransferSink((next) => setNotebooks(next));
  }, []);
  useEffect(() => {
    if (transfers.active > 0) setQueueOpen(true);
  }, [transfers.active]);

  // ─ 표시 prefs ─
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.columns) as
        | ColumnsPref
        | null;
      if (saved) setColumns(saved);
    } catch {
      /* */
    }
  }, []);

  // ─ 새로고침 (MailBento 가 같은 DB 를 고쳤을 수 있으므로 창 포커스 시에도) ─
  const refresh = useCallback(
    async (spinner = false) => {
      if (spinner) setRefreshing(true);
      try {
        setNotebooks(await api.list());
      } catch {
        /* 조용히 무시 — 다음 시도에서 복구 */
      } finally {
        if (spinner) setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!legacySynced) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [legacySynced, refresh]);

  // ─ 붙여넣기 → 어느 메모함에 넣을지 묻는 플로팅 ─
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return; // 입력 중인 붙여넣기는 그대로 둔다
      }
      const dt = e.clipboardData;
      if (!dt) return;

      const files = Array.from(dt.files ?? []);
      if (files.length === 0 && dt.items) {
        for (const item of Array.from(dt.items)) {
          if (item.kind !== "file") continue;
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        setPending({ kind: "files", files });
        return;
      }

      const text = dt.getData("text/plain").trim();
      if (text) {
        e.preventDefault();
        setPending({ kind: "text", text });
      }
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const takePaste = useCallback(
    async (notebookId: string) => {
      const p = pending;
      setPending(null);
      if (!p) return;
      const nb = notebooks.find((n) => n.id === notebookId);
      try {
        if (p.kind === "files") {
          if (nb) enqueueUploads(nb, p.files);
          return;
        }
        // 대상이 받는 종류에 맞춘다 — 텍스트 전용 메모함이면 URL 도 텍스트로
        const canLink = nb?.accepts.includes("link") ?? true;
        const canText = nb?.accepts.includes("text") ?? true;
        if (canLink && (!canText || looksLikeUrl(p.text))) {
          setNotebooks(await api.createLinkMemo(notebookId, p.text));
        } else {
          setNotebooks(await api.createTextMemo(notebookId, p.text));
        }
      } catch (e) {
        fail(e);
      }
    },
    [pending, fail, notebooks],
  );

  /** 목록 안의 메모 하나를 그 자리에서 갈아끼운다 (서버 응답 전 즉시 반영용). */
  const patchMemo = useCallback((memoId: string, patch: Partial<MemoDTO>) => {
    setNotebooks((prev) =>
      prev.map((n) => ({
        ...n,
        memos: n.memos.map((m) => (m.id === memoId ? { ...m, ...patch } : m)),
      })),
    );
  }, []);

  // ─ 메모함 조작 ─
  const handlers: NotebookHandlers = useMemo(
    () => ({
      addText: (id, text) => run(() => api.createTextMemo(id, text)),
      addLink: (id, url) => run(() => api.createLinkMemo(id, url)),
      addFiles: async (id, files) => {
        const nb = notebooks.find((n) => n.id === id);
        if (nb) enqueueUploads(nb, files);
      },
      moveMemo: (memoId, toNotebookId) =>
        run(() => api.updateMemo(memoId, { notebookId: toNotebookId })),
      checklist: {
        onToggle: (memo, done) => {
          // 낙관적 반영 — 체크는 즉각 반응해야 한다
          patchMemo(memo.id, { done });
          void run(() => api.updateMemo(memo.id, { done })).catch(() => undefined);
        },
        onDue: (memo, dueAt) => {
          patchMemo(memo.id, { dueAt });
          void run(() => api.updateMemo(memo.id, { dueAt })).catch(() => undefined);
        },
        onRename: (memo, text) => {
          patchMemo(memo.id, { text });
          void run(() => api.updateMemo(memo.id, { text })).catch(() => undefined);
        },
      },
      schedule: {
        onColor: (memo, color) => {
          patchMemo(memo.id, { color });
          void run(() => api.updateMemo(memo.id, { color })).catch(() => undefined);
        },
        onLink: (memo, url) => {
          patchMemo(memo.id, { url, iconUrl: url ? autoIconUrl(url) : null });
          void run(() => api.updateMemo(memo.id, { url })).catch(() => undefined);
        },
        onRule: (memo, recurrence) => {
          patchMemo(memo.id, { recurrence });
          void run(() => api.updateMemo(memo.id, { recurrence })).catch(
            () => undefined,
          );
        },
        onRename: (memo, text) => {
          patchMemo(memo.id, { text });
          void run(() => api.updateMemo(memo.id, { text })).catch(() => undefined);
        },
      },
      notify: (message) => fail(new Error(message)),
      setViewMode: (id, mode: ViewMode) => {
        // 낙관적 반영 — 토글 반응이 즉시 보이도록
        setNotebooks((prev) =>
          prev.map((n) => (n.id === id ? { ...n, viewMode: mode } : n)),
        );
        void run(() => api.updateNotebook(id, { viewMode: mode })).catch(
          () => undefined,
        );
      },
      rename: (id, name) => {
        void run(() => api.updateNotebook(id, { name })).catch(() => undefined);
      },
      remove: (id) => {
        const nb = notebooks.find((n) => n.id === id);
        const count = nb?.memos.length ?? 0;
        const msg =
          count > 0
            ? `"${nb?.name}" 메모함과 그 안의 메모 ${count}개를 휴지통으로 옮깁니다. 30일 안에는 설정 > 휴지통에서 되살릴 수 있습니다. 진행할까요?`
            : `"${nb?.name}" 메모함을 휴지통으로 옮길까요?`;
        if (!confirm(msg)) return;
        if (expandedId === id) setExpandedId(null);
        void run(() => api.deleteNotebook(id)).catch(() => undefined);
      },
      expand: (nb) => setExpandedId(nb.id),
    }),
    [run, fail, patchMemo, notebooks, expandedId],
  );

  // ─ 메모 조작 ─
  const memoActions: MemoActions = useMemo(
    () => ({
      onOpen: (memo) => {
        if (memo.type === "link" && memo.url) {
          window.open(memo.url, "_blank", "noreferrer");
          return;
        }
        // 앱에서 열 수 없는 일반 파일은 클릭 즉시 다운로드
        if (memo.file && memo.file.kind === "file") {
          triggerDownload(viewUrl(memo.file, { dl: true, swReady }), memo.file.name);
          return;
        }
        setViewerId(memo.id);
      },
      onEdit: (memo) => setViewerId(memo.id),
      onDelete: (memo) => {
        if (!confirmMemoDelete("이 메모를 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)")) return;
        void run(() => api.deleteMemo(memo.id)).catch(() => undefined);
      },
      onDropOnMemo: (payload, target) => {
        // 같은 메모함 안 → 순서 변경 (끌어온 것을 대상 **앞**에 끼워 넣는다)
        if (payload.notebookId !== target.notebookId) return;
        const nb = notebooks.find((n) => n.id === target.notebookId);
        if (!nb) return;
        const ids = nb.memos.map((m) => m.id).filter((id) => id !== payload.id);
        const at = ids.indexOf(target.id);
        if (at < 0) return;
        ids.splice(at, 0, payload.id);

        // 낙관적 반영 — 드롭 즉시 자리가 잡히게
        const byId = new Map(nb.memos.map((m) => [m.id, m]));
        setNotebooks((prev) =>
          prev.map((n) =>
            n.id === nb.id
              ? { ...n, memos: ids.map((id) => byId.get(id)!).filter(Boolean) }
              : n,
          ),
        );
        void run(() => api.reorderMemos(nb.id, ids)).catch(() => undefined);
      },
    }),
    [run, notebooks, swReady],
  );

  const viewerMemo = useMemo(() => {
    if (!viewerId) return null;
    for (const nb of notebooks) {
      const found = nb.memos.find((m) => m.id === viewerId);
      if (found) return found;
    }
    return null;
  }, [viewerId, notebooks]);

  const expanded = useMemo(
    () => notebooks.find((n) => n.id === expandedId) ?? null,
    [expandedId, notebooks],
  );

  // ─ 메모함 순서 DnD ─
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setNotebooks((prev) => {
      const oldIdx = prev.findIndex((n) => n.id === active.id);
      const newIdx = prev.findIndex((n) => n.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      const next = arrayMove(prev, oldIdx, newIdx);
      void api
        .reorderNotebooks(next.map((n) => n.id))
        .catch(() => undefined);
      return next;
    });
  };

  const totalMemos = notebooks.reduce((s, n) => s + n.memos.length, 0);

  return (
    // 넓은 화면에서는 가로를 더 쓴다 — 2560px 모니터에서 1920 으로 잘리지 않도록
    <main className="relative mx-auto flex min-h-screen w-full max-w-[2560px] flex-col gap-6 px-6 py-10 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-surface) ring-1 ring-(--color-border-soft)">
            <NotebookPen className="h-5 w-5 text-(--color-accent)" />
          </div>
          <div>
            <h1
              className="text-2xl leading-tight"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              MemoBento
            </h1>
            <p className="flex items-center gap-1.5 text-xs text-(--color-fg-4)">
              <span>
                메모함 {notebooks.length} · 메모 {totalMemos}
              </span>
              {legacySynced && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-(--color-accent-soft) px-1.5 py-0.5 text-[10px] text-(--color-accent-strong)"
                  title="MailBento DB 와 실시간 동기화 중"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  MailBento 동기화
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setQueueOpen((v) => !v)}
            aria-pressed={queueOpen}
            title="전송 큐"
            className={cn(
              "relative flex items-center gap-2 rounded-full px-4 py-2 text-sm ring-1 transition",
              transfers.active > 0
                ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-(--color-accent)/40"
                : "bg-(--color-surface) text-(--color-fg-2) ring-(--color-border-soft) hover:bg-(--color-surface-2)",
            )}
          >
            <ArrowUpFromLine
              className={cn("h-4 w-4", transfers.active > 0 && "animate-pulse")}
            />
            <span className="hidden sm:inline">전송</span>
            {transfers.total > 0 && (
              <span className="rounded-full bg-(--color-bg-2) px-1.5 py-0.5 font-mono text-[10px] text-(--color-fg-3)">
                {transfers.active > 0 ? transfers.active : transfers.total}
              </span>
            )}
          </button>
          <MailBentoLink href={mailbentoUrl} />
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className={cn(
              "flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)",
              refreshing && "opacity-60",
            )}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            새로고침
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-full bg-(--color-accent-soft) px-4 py-2 text-sm text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25"
          >
            <SettingsIcon className="h-4 w-4" />
            설정
          </Link>
        </div>
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={notebooks.map((n) => n.id)}
          strategy={rectSortingStrategy}
        >
          <section className={cn("grid gap-4", COLUMN_CLASS[columns])}>
            {notebooks.map((nb) => (
              <SortableNotebookCard
                key={nb.id}
                notebook={nb}
                memoActions={memoActions}
                handlers={handlers}
              />
            ))}
            <AddNotebookCard
              onCreate={(name, kind) => run(() => api.createNotebook(name, kind))}
            />
          </section>
        </SortableContext>
      </DndContext>

      <footer className="mt-2 text-center text-xs text-(--color-fg-4)">
        파일은 메모함에 <b>끌어다 놓기</b>, 클립보드는{" "}
        <b>Ctrl+V</b> 로 메모함을 골라 추가 · 카드 왼쪽 손잡이를 끌면 순서 변경
      </footer>

      {/* 메모 열람 / 편집 */}
      <MemoViewer
        memo={viewerMemo}
        onClose={() => setViewerId(null)}
        onSave={async (memo, patch) => {
          setNotebooks(await api.updateMemo(memo.id, patch));
        }}
        onDelete={async (memo) => {
          setNotebooks(await api.deleteMemo(memo.id));
        }}
      />

      {/* 메모함 크게 보기 */}
      <NotebookModal
        notebook={expanded}
        memoActions={memoActions}
        handlers={handlers}
        onClose={() => setExpandedId(null)}
      />

      {/* 업로드 큐 */}
      <TransferPanel open={queueOpen} onClose={() => setQueueOpen(false)} />

      {/* 붙여넣기 대상 선택 */}
      <PastePicker
        pending={pending}
        notebooks={notebooks}
        onPick={(id) => void takePaste(id)}
        onCancel={() => setPending(null)}
      />

      {/* 에러 토스트 */}
      {error && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex max-w-[92vw] -translate-x-1/2 items-start gap-2 rounded-xl bg-(--color-surface) px-4 py-3 text-sm text-(--color-danger) shadow-xl ring-1 ring-(--color-danger)/40">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) hover:text-(--color-fg-2)"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </main>
  );
}

/** 열람 불가 형식 — 클릭 즉시 다운로드. */
function triggerDownload(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
