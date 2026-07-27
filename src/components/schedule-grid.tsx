"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MEMO_COLORS } from "@/lib/db/schema";
import {
  activeToday,
  describeNext,
  formatTime,
  nextOccurrence,
  parseDay,
  parseTimeInput,
  toDayString,
  WEEKDAY_LABELS,
  type Freq,
  type Recurrence,
} from "@/lib/recurrence";
import { colorVar, type MemoColor, type MemoDTO, type NotebookDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { MemoActions } from "./memo-item";
import { useNow, type SchedulePatch, type ScheduleActions } from "./schedule-item";

const FREQ_OPTIONS: { value: Freq | "none"; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "daily", label: "매일" },
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매월" },
  { value: "yearly", label: "매년" },
];

const COLOR_LABELS: Record<MemoColor, string> = {
  red: "빨강",
  orange: "주황",
  amber: "노랑",
  green: "초록",
  teal: "청록",
  blue: "파랑",
  violet: "보라",
  pink: "분홍",
};

/** 한 행의 편집 중인 값. 전부 문자열로 들고 있다가 저장할 때 한 번에 해석한다. */
interface Draft {
  text: string;
  freq: Freq | "none";
  interval: string;
  weekdays: number[];
  day: string;
  month: string;
  time: string;
  from: string;
  to: string;
  color: MemoColor | null;
  url: string;
}

function toDraft(memo: MemoDTO): Draft {
  const r = memo.recurrence;
  return {
    text: memo.text ?? "",
    freq: r?.freq ?? "none",
    interval: String(r?.interval ?? 1),
    // 요일을 고르지 않은 주간 규칙은 기준일의 요일로 돈다. 화면에 아무 표시가
    // 없으면 왜 그 요일인지 알 수 없으므로 미리 채워 보여 준다.
    weekdays:
      r?.weekdays ??
      (r?.freq === "weekly"
        ? [(parseDay(r.anchor) ?? new Date(memo.createdAt)).getDay()]
        : []),
    day: r?.day ? String(r.day) : "",
    month: r?.month ? String(r.month) : "",
    time: r?.timeMinutes != null ? formatTime(r.timeMinutes) : "",
    from: r?.from ?? "",
    to: r?.to ?? "",
    color: memo.color,
    url: memo.url ?? "",
  };
}

/** 저장할 값으로. 형식이 틀리면 사유를 돌려준다. */
function toPatch(
  draft: Draft,
  memo: MemoDTO,
): { patch: SchedulePatch } | { error: string } {
  const text = draft.text.trim();
  if (!text) return { error: "내용을 비울 수 없습니다" };

  let url: string | null = null;
  if (draft.url.trim()) {
    const raw = draft.url.trim();
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString();
    } catch {
      return { error: "올바른 주소가 아닙니다" };
    }
  }

  let recurrence: Recurrence | null = null;
  if (draft.freq !== "none") {
    const t = draft.time.trim();
    const timeMinutes = t ? parseTimeInput(t) : null;
    if (t && timeMinutes == null) return { error: "시각은 00:00 ~ 26:59 형식으로" };
    recurrence = {
      // 기준일은 사용자가 건드리지 않는다. 흘리면 다음 저장 때 만든 날로
      // 되돌아가면서 발생 요일이 바뀐다.
      anchor: memo.recurrence?.anchor ?? null,
      freq: draft.freq,
      interval: Math.max(1, Number(draft.interval) || 1),
      weekdays:
        draft.freq === "weekly" && draft.weekdays.length
          ? [...draft.weekdays].sort()
          : undefined,
      day:
        (draft.freq === "monthly" || draft.freq === "yearly") && draft.day
          ? Number(draft.day)
          : undefined,
      month: draft.freq === "yearly" && draft.month ? Number(draft.month) : undefined,
      timeMinutes,
      from: draft.from || null,
      to: draft.to || null,
    };
  }

  return { patch: { text, url, color: draft.color, recurrence } };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.text === b.text &&
    a.freq === b.freq &&
    a.interval === b.interval &&
    a.day === b.day &&
    a.month === b.month &&
    a.time === b.time &&
    a.from === b.from &&
    a.to === b.to &&
    a.color === b.color &&
    a.url === b.url &&
    a.weekdays.length === b.weekdays.length &&
    a.weekdays.every((w, i) => w === b.weekdays[i])
  );
}

const CELL =
  "w-full rounded-sm bg-transparent px-1.5 py-1 text-[13px] text-(--color-fg) outline-none focus:bg-(--color-bg-2) focus:ring-1 focus:ring-(--color-accent)";

/**
 * 반복 규칙을 표로 펼쳐 고친다.
 *
 * 규칙 하나에 딸린 값이 열 개 가까이 된다. 좁은 카드 한 칸에서는 어느 것도
 * 제대로 보이지 않아서, 편집은 넓은 화면으로 빼고 카드에는 계산된 일정만
 * 남긴다.
 *
 * 저장은 행 단위다. 칸마다 보내면 요청이 쏟아지고, 전부 모아 한 번에 보내면
 * 어디서 틀렸는지 알기 어렵다. 행에서 포커스가 빠질 때 그 행만 보낸다.
 */
export function ScheduleGridModal({
  notebook,
  actions,
  memoActions,
  onAdd,
  focusMemoId,
  onClose,
}: {
  notebook: NotebookDTO | null;
  actions: ScheduleActions;
  memoActions: MemoActions;
  /** 새 항목 추가 — 메모함에 빈 일정을 만든다. */
  onAdd: (notebookId: string, text: string) => Promise<void>;
  /** 열자마자 이 행으로 이동. */
  focusMemoId?: string | null;
  onClose: () => void;
}) {
  // 닫을 때 아직 저장하지 않은 행이 있으면 먼저 보낸다. 행에서 포커스가
  // 빠질 때 저장하는 규칙만으로는, 마지막으로 고치던 행이 닫기 한 번에
  // 조용히 사라진다.
  const commitAll = useRef<() => void>(() => {});

  if (!notebook) return null;
  return (
    <Dialog.Root
      open
      onOpenChange={(o) => {
        if (o) return;
        commitAll.current();
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 z-40 flex h-[88vh] w-[min(1500px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] border border-(--color-border) bg-(--color-surface) shadow-2xl"
        >
          <Dialog.Title className="sr-only">
            {notebook.name} — 반복 규칙 편집
          </Dialog.Title>
          <Grid
            notebook={notebook}
            actions={actions}
            memoActions={memoActions}
            onAdd={onAdd}
            focusMemoId={focusMemoId}
            registerCommitAll={(fn) => {
              commitAll.current = fn;
            }}
          />
          <Dialog.Close className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-md text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)">
            <X className="h-4 w-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Grid({
  notebook,
  actions,
  memoActions,
  onAdd,
  focusMemoId,
  registerCommitAll,
}: {
  notebook: NotebookDTO;
  actions: ScheduleActions;
  memoActions: MemoActions;
  onAdd: (notebookId: string, text: string) => Promise<void>;
  focusMemoId?: string | null;
  /** 닫기 직전에 부를 수 있도록 "전부 저장"을 바깥에 넘겨 둔다. */
  registerCommitAll: (fn: () => void) => void;
}) {
  const memos = notebook.memos;
  const now = useNow(60_000);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");

  // 서버 값이 바뀌면 손대지 않은 행만 따라간다. 편집 중인 행을 덮어쓰면
  // 타이핑하던 내용이 사라진다.
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, Draft> = {};
      for (const m of memos) {
        const fresh = toDraft(m);
        const cur = prev[m.id];
        next[m.id] = cur && !sameDraft(cur, fresh) ? cur : fresh;
      }
      return next;
    });
  }, [memos]);

  const setCell = useCallback((id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  /**
   * 요일 토글은 직전 값에서 계산해야 한다.
   *
   * 렌더에서 읽은 draft 로 새 배열을 만들면, 리렌더 전에 두 번 누른 경우
   * 뒤 클릭이 앞 클릭을 덮어써 하나만 켜진다.
   */
  const toggleWeekday = useCallback((id: string, i: number) => {
    setDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      const weekdays = cur.weekdays.includes(i)
        ? cur.weekdays.filter((w) => w !== i)
        : [...cur.weekdays, i];
      return { ...prev, [id]: { ...cur, weekdays } };
    });
  }, []);

  /** 행 저장 — 서버 값과 같으면 아무것도 보내지 않는다. */
  const commit = useCallback(
    (memo: MemoDTO) => {
      const draft = drafts[memo.id];
      if (!draft || sameDraft(draft, toDraft(memo))) return;
      const result = toPatch(draft, memo);
      if ("error" in result) {
        setErrors((e) => ({ ...e, [memo.id]: result.error }));
        return;
      }
      setErrors((e) => {
        const { [memo.id]: _drop, ...rest } = e;
        return rest;
      });
      actions.onSave(memo, result.patch);
    },
    [drafts, actions],
  );

  const commitAll = useCallback(() => {
    for (const m of memos) commit(m);
  }, [memos, commit]);

  useEffect(() => {
    registerCommitAll(commitAll);
  }, [commitAll, registerCommitAll]);

  /** 위/아래 화살표와 Enter 로 같은 열의 다른 행으로 옮긴다. */
  const move = (row: number, col: string, delta: number) => {
    const root = bodyRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(
      `[data-row="${row + delta}"][data-col="${col}"]`,
    );
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
  };

  const onCellKeyDown = (
    e: React.KeyboardEvent,
    memo: MemoDTO,
    row: number,
    col: string,
  ) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      setDrafts((prev) => ({ ...prev, [memo.id]: toDraft(memo) }));
      setErrors((x) => {
        const { [memo.id]: _drop, ...rest } = x;
        return rest;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(memo);
      move(row, col, 1);
      return;
    }
    // 텍스트 칸 안에서는 좌우 화살표가 캐럿을 옮겨야 하므로 위아래만 가로챈다
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(row, col, 1);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(row, col, -1);
    }
  };

  const add = async () => {
    const value = newText.trim();
    if (!value) return;
    setAdding(true);
    try {
      await onAdd(notebook.id, value);
      setNewText("");
    } finally {
      setAdding(false);
    }
  };

  // 인스턴스에서 건너왔으면 그 행의 내용 칸으로 바로 간다
  useEffect(() => {
    if (!focusMemoId) return;
    const i = memos.findIndex((m) => m.id === focusMemoId);
    if (i < 0) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(
      `[data-row="${i}"][data-col="text"]`,
    );
    el?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMemoId]);

  const dirtyCount = useMemo(
    () =>
      memos.filter((m) => drafts[m.id] && !sameDraft(drafts[m.id], toDraft(m)))
        .length,
    [memos, drafts],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-(--color-border-soft) px-5 py-3">
        <h2 className="text-[15px] font-semibold text-(--color-fg)">
          {notebook.name}
          <span className="ml-2 font-normal text-[13px] text-(--color-fg-3)">
            반복 규칙 {memos.length}개
          </span>
        </h2>
        <p className="ml-auto text-[12px] break-keep text-(--color-fg-3)">
          {dirtyCount > 0
            ? `저장하지 않은 행 ${dirtyCount}개`
            : "칸을 눌러 바로 고칩니다 · Enter 저장 · ↑↓ 행 이동 · Esc 되돌리기"}
        </p>
        <button
          type="button"
          onClick={commitAll}
          disabled={dirtyCount === 0}
          className="mr-8 shrink-0 rounded-lg bg-(--color-accent) px-3 py-1.5 text-[13px] font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:bg-(--color-bg-2) disabled:text-(--color-fg-3)"
        >
          {dirtyCount > 0 ? `${dirtyCount}개 저장` : "저장됨"}
        </button>
      </header>

      <div ref={bodyRef} className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-(--color-surface) shadow-[0_1px_0_var(--color-border-soft)]">
            <tr className="text-left text-[12px] text-(--color-fg-3)">
              <Th className="w-[22%] min-w-52">내용</Th>
              <Th className="w-24">주기</Th>
              <Th className="w-16">간격</Th>
              <Th className="w-52">요일 · 일자</Th>
              <Th className="w-20">시각</Th>
              <Th className="w-32">표시 시작</Th>
              <Th className="w-32">표시 종료</Th>
              <Th className="w-24">색</Th>
              <Th className="w-[18%] min-w-40">링크</Th>
              <Th className="w-24">다음</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {memos.map((memo, row) => {
              const d = drafts[memo.id];
              if (!d) return null;
              const err = errors[memo.id];
              const dirty = !sameDraft(d, toDraft(memo));
              const cellProps = (col: string) => ({
                "data-row": row,
                "data-col": col,
                onKeyDown: (e: React.KeyboardEvent) =>
                  onCellKeyDown(e, memo, row, col),
              });
              return (
                <tr
                  key={memo.id}
                  onBlur={(e) => {
                    // 같은 행 안에서 칸만 옮긴 것이면 아직 저장하지 않는다
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    commit(memo);
                  }}
                  className={cn(
                    "border-b border-(--color-border-soft) transition hover:bg-(--color-surface-hi)/50",
                    dirty && "bg-(--color-accent-soft)",
                    err && "bg-(--color-danger)/10",
                  )}
                >
                  <Td>
                    <input
                      {...cellProps("text")}
                      value={d.text}
                      onChange={(e) => setCell(memo.id, { text: e.target.value })}
                      style={{ color: colorVar(d.color) }}
                      className={cn(CELL, "font-medium")}
                      aria-label={`${row + 1}행 내용`}
                    />
                    {err && (
                      <p className="px-1.5 pb-1 text-[11px] text-(--color-danger)">
                        {err}
                      </p>
                    )}
                  </Td>

                  <Td>
                    <select
                      {...cellProps("freq")}
                      value={d.freq}
                      onChange={(e) =>
                        setCell(memo.id, { freq: e.target.value as Freq | "none" })
                      }
                      className={cn(CELL, "cursor-pointer")}
                      aria-label={`${row + 1}행 주기`}
                    >
                      {FREQ_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    {d.freq === "none" ? (
                      <Dash />
                    ) : (
                      <input
                        {...cellProps("interval")}
                        type="number"
                        min={1}
                        max={d.freq === "yearly" ? 20 : 999}
                        value={d.interval}
                        onChange={(e) =>
                          setCell(memo.id, { interval: e.target.value })
                        }
                        className={cn(CELL, "text-center tabular-nums")}
                        aria-label={`${row + 1}행 간격`}
                      />
                    )}
                  </Td>

                  <Td>
                    {d.freq === "weekly" ? (
                      <div className="flex gap-0.5">
                        {WEEKDAY_LABELS.map((label, i) => (
                          <button
                            key={label}
                            type="button"
                            {...cellProps(`wd${i}`)}
                            onClick={() => toggleWeekday(memo.id, i)}
                            aria-pressed={d.weekdays.includes(i)}
                            aria-label={`${row + 1}행 ${label}요일`}
                            className={cn(
                              "h-6 w-6 rounded text-[12px] transition",
                              d.weekdays.includes(i)
                                ? "bg-(--color-accent) font-medium text-(--color-bg)"
                                : "bg-(--color-bg-2) text-(--color-fg-3) hover:bg-(--color-surface-hi)",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : d.freq === "monthly" ? (
                      <div className="flex items-center gap-1">
                        <input
                          {...cellProps("day")}
                          type="number"
                          min={1}
                          max={31}
                          value={d.day}
                          placeholder="일"
                          onChange={(e) => setCell(memo.id, { day: e.target.value })}
                          className={cn(CELL, "w-14 text-center tabular-nums")}
                          aria-label={`${row + 1}행 일자`}
                        />
                        <span className="text-[12px] text-(--color-fg-3)">일</span>
                        {Number(d.day) >= 29 && (
                          <span className="text-[11px] break-keep text-(--color-fg-3)">
                            없는 달은 건너뜀
                          </span>
                        )}
                      </div>
                    ) : d.freq === "yearly" ? (
                      <div className="flex items-center gap-1">
                        <input
                          {...cellProps("month")}
                          type="number"
                          min={1}
                          max={12}
                          value={d.month}
                          placeholder="월"
                          onChange={(e) => setCell(memo.id, { month: e.target.value })}
                          className={cn(CELL, "w-12 text-center tabular-nums")}
                          aria-label={`${row + 1}행 월`}
                        />
                        <span className="text-[12px] text-(--color-fg-3)">월</span>
                        <input
                          {...cellProps("day")}
                          type="number"
                          min={1}
                          max={31}
                          value={d.day}
                          placeholder="일"
                          onChange={(e) => setCell(memo.id, { day: e.target.value })}
                          className={cn(CELL, "w-12 text-center tabular-nums")}
                          aria-label={`${row + 1}행 일자`}
                        />
                        <span className="text-[12px] text-(--color-fg-3)">일</span>
                      </div>
                    ) : (
                      <Dash />
                    )}
                  </Td>

                  <Td>
                    {d.freq === "none" ? (
                      <Dash />
                    ) : (
                      <input
                        {...cellProps("time")}
                        value={d.time}
                        placeholder="26:00"
                        inputMode="numeric"
                        onChange={(e) => setCell(memo.id, { time: e.target.value })}
                        className={cn(CELL, "text-center font-mono tabular-nums")}
                        aria-label={`${row + 1}행 시각 (26:59 까지)`}
                        title="참고용 시각. 24시를 넘겨 26:59 까지 쓸 수 있습니다"
                      />
                    )}
                  </Td>

                  <Td>
                    {d.freq === "none" ? (
                      <Dash />
                    ) : (
                      <input
                        {...cellProps("from")}
                        type="date"
                        value={d.from}
                        onChange={(e) => setCell(memo.id, { from: e.target.value })}
                        className={CELL}
                        aria-label={`${row + 1}행 표시 시작일`}
                      />
                    )}
                  </Td>

                  <Td>
                    {d.freq === "none" ? (
                      <Dash />
                    ) : (
                      <input
                        {...cellProps("to")}
                        type="date"
                        value={d.to}
                        onChange={(e) => setCell(memo.id, { to: e.target.value })}
                        className={CELL}
                        aria-label={`${row + 1}행 표시 종료일`}
                      />
                    )}
                  </Td>

                  <Td>
                    <select
                      {...cellProps("color")}
                      value={d.color ?? ""}
                      onChange={(e) =>
                        setCell(memo.id, {
                          color: (e.target.value || null) as MemoColor | null,
                        })
                      }
                      style={{ color: colorVar(d.color) }}
                      className={cn(CELL, "cursor-pointer font-medium")}
                      aria-label={`${row + 1}행 글자 색`}
                    >
                      <option value="">기본색</option>
                      {MEMO_COLORS.map((c) => (
                        <option key={c} value={c}>
                          {COLOR_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </Td>

                  <Td>
                    <input
                      {...cellProps("url")}
                      value={d.url}
                      placeholder="https://…"
                      onChange={(e) => setCell(memo.id, { url: e.target.value })}
                      className={cn(CELL, "text-(--color-fg-2)")}
                      aria-label={`${row + 1}행 링크`}
                    />
                  </Td>

                  <Td>
                    <NextCell memo={memo} now={now} />
                  </Td>

                  <Td>
                    <button
                      type="button"
                      onClick={() => memoActions.onDelete(memo)}
                      className="grid h-6 w-6 place-items-center rounded text-(--color-fg-3) transition hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
                      aria-label={`${row + 1}행 삭제`}
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {memos.length === 0 && (
          <p className="px-5 py-10 text-center text-sm break-keep text-(--color-fg-3)">
            아직 반복 일정이 없습니다. 아래에서 추가하세요.
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-(--color-border-soft) px-5 py-3">
        <Plus className="h-4 w-4 shrink-0 text-(--color-fg-3)" aria-hidden />
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void add();
          }}
          placeholder="새 일정 이름을 입력하고 Enter — 주기는 표에서 정합니다"
          className="min-w-0 flex-1 rounded-lg bg-(--color-bg-2) px-3 py-2 text-[13px] text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
          aria-label="새 일정"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={adding || !newText.trim()}
          className="shrink-0 rounded-lg bg-(--color-accent) px-4 py-2 text-[13px] font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong) disabled:opacity-40"
        >
          추가
        </button>
      </footer>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn("px-2 py-2 font-medium break-keep whitespace-nowrap", className)}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1 align-middle">{children}</td>;
}

function Dash() {
  return <span className="px-1.5 text-(--color-fg-4)">—</span>;
}

/** 다음 발생일 — 읽기 전용. 저장된 규칙 기준이라 편집 중 값과는 다를 수 있다. */
function NextCell({ memo, now }: { memo: MemoDTO; now: Date | null }) {
  const rule = memo.recurrence;
  const nowDay = now ? toDayString(now) : null;
  const label = useMemo(() => {
    if (!rule || !now || !nowDay) return null;
    if (activeToday(rule, memo.createdAt, now)) return "오늘";
    const n = nextOccurrence(rule, memo.createdAt, parseDay(nowDay)!);
    return n ? describeNext(n, now) : "예정 없음";
  }, [rule, memo.createdAt, now, nowDay]);

  if (!label) return <Dash />;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[12px] whitespace-nowrap",
        label === "오늘"
          ? "bg-(--color-accent) font-medium text-(--color-bg)"
          : "text-(--color-fg-2)",
      )}
    >
      {label}
    </span>
  );
}
