"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { composeDue, formatDue, toDateInput, toTimeInput } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * TODO 항목을 추가할 때 쓸 기한을 고른다.
 *
 * 달력에서 고르거나, 날짜·시각을 직접 쳐 넣을 수도 있다. 시각은 선택이고,
 * 비워 두면 그날 정오로 저장한다 — 날짜만 정한 기한이라는 뜻이다.
 */
export function DuePicker({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (dueAt: number | null) => void;
}) {
  return (
    <div className="relative flex shrink-0 flex-col">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "flex h-full min-h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] transition",
          value
            ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/50"
            : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi) hover:text-(--color-fg)",
        )}
        aria-label={value ? `기한 ${formatDue(value)} — 변경` : "기한 정하기"}
        title={value ? `기한 ${formatDue(value)}` : "기한 정하기 (선택)"}
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        {value && (
          <span className="w-full truncate px-0.5 text-center leading-none tabular-nums">
            {formatDue(value)}
          </span>
        )}
      </button>

      {open && (
        <DuePanel
          value={value}
          onCancel={() => onOpenChange(false)}
          onPick={(next) => {
            onChange(next);
            onOpenChange(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * 기한 고르는 패널만 따로.
 *
 * 위의 DuePicker 는 입력칸 옆 큼직한 타일용이다. 체크리스트 한 줄처럼 자리가
 * 없는 곳에서는 각자 작은 버튼을 두고 이 패널만 띄운다.
 */
export function DuePanel({
  value,
  onPick,
  onCancel,
  align = "left",
}: {
  value: number | null;
  onPick: (dueAt: number | null) => void;
  onCancel: () => void;
  /** 붙일 쪽. 오른쪽 끝 버튼에 달면 left 로 두면 화면 밖으로 나간다. */
  align?: "left" | "right";
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [date, setDate] = useState(() => toDateInput(value));
  const [time, setTime] = useState(() => toTimeInput(value));
  const [error, setError] = useState<string | null>(null);
  // 달력이 보고 있는 달. 고른 날짜가 있으면 그 달부터.
  const [cursor, setCursor] = useState(() =>
    startOfDay(value ? new Date(value) : new Date()),
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCancel]);

  const grid = useMemo(() => buildMonth(cursor), [cursor]);
  const today = toDateInput(Date.now());

  const commit = (d: string, t: string) => {
    if (!d) {
      onPick(null);
      return;
    }
    const due = composeDue(d, t);
    if (due == null) {
      setError("날짜나 시각 형식이 올바르지 않습니다");
      return;
    }
    onPick(due);
  };

  return (
    <div
      ref={boxRef}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute bottom-full z-40 mb-1 w-64 rounded-xl border border-(--color-border) bg-(--color-surface) p-3 shadow-xl",
        align === "right" ? "right-0" : "left-0",
      )}
    >
      <div className="flex flex-col gap-2.5 text-[12px] text-(--color-fg-2)">
        {/* 달력 */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
            }
            className="grid h-6 w-6 place-items-center rounded text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)"
            aria-label="이전 달"
          >
            ‹
          </button>
          <span className="font-medium tabular-nums">
            {cursor.getFullYear()}년 {cursor.getMonth() + 1}월
          </span>
          <button
            type="button"
            onClick={() =>
              setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
            }
            className="grid h-6 w-6 place-items-center rounded text-(--color-fg-3) hover:bg-(--color-surface-hi) hover:text-(--color-fg)"
            aria-label="다음 달"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-(--color-fg-3)">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-0.5">
              {w}
            </span>
          ))}
          {grid.map((cell) => {
            if (!cell) return <span key={Math.random()} />;
            const key = toDateInput(cell.getTime());
            const picked = key === date;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setDate(key);
                  setError(null);
                }}
                aria-pressed={picked}
                className={cn(
                  "grid h-7 place-items-center rounded text-[12px] tabular-nums transition",
                  picked
                    ? "bg-(--color-accent) font-medium text-(--color-bg)"
                    : key === today
                      ? "bg-(--color-bg-2) font-medium text-(--color-accent-strong)"
                      : "text-(--color-fg-2) hover:bg-(--color-surface-hi)",
                )}
              >
                {cell.getDate()}
              </button>
            );
          })}
        </div>

        {/* 직접 입력 */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
              if (e.target.value) {
                const d = new Date(e.target.value + "T00:00:00");
                if (!Number.isNaN(d.getTime())) setCursor(startOfDay(d));
              }
            }}
            className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
            aria-label="기한 날짜"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setError(null);
            }}
            className="w-24 rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
            aria-label="기한 시각 (선택)"
          />
        </div>
        <p className="text-[11px] text-(--color-fg-3)">
          시각을 비우면 날짜만 정한 기한이 됩니다
        </p>

        {error && <div className="text-(--color-danger)">{error}</div>}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => commit(date, time)}
            className="flex-1 rounded-lg bg-(--color-accent) py-1.5 font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
          >
            적용
          </button>
          <button
            type="button"
            onClick={() => onPick(null)}
            className="rounded-lg px-2 py-1.5 text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
            title="기한 없이 추가"
          >
            해제
          </button>
        </div>
      </div>
    </div>
  );
}

/** 그 달의 칸들. 앞쪽 빈칸은 null. */
function buildMonth(cursor: Date): (Date | null)[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const out: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) out.push(null);
  for (let d = 1; d <= days; d++) out.push(new Date(year, month, d));
  return out;
}
