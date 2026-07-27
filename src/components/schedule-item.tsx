"use client";

import { Clock, Repeat, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  activeToday,
  describeNext,
  describeRecurrence,
  describeWindow,
  formatTime,
  nextOccurrence,
  parseTimeInput,
  WEEKDAY_LABELS,
  type Freq,
  type Recurrence,
} from "@/lib/recurrence";
import type { MemoDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DragHandle, type MemoActions } from "./memo-item";

export interface ScheduleActions {
  /** 반복 규칙 저장 / 해제. */
  onRule: (memo: MemoDTO, rule: Recurrence | null) => void;
  /** 본문 수정. */
  onRename: (memo: MemoDTO, text: string) => void;
}

const DEFAULT_RULE: Recurrence = { freq: "weekly", interval: 1, weekdays: [1] };

const FREQ_LABELS: { value: Freq; label: string; unit: string }[] = [
  { value: "daily", label: "일", unit: "일" },
  { value: "weekly", label: "주", unit: "주" },
  { value: "monthly", label: "월", unit: "개월" },
  { value: "yearly", label: "년", unit: "년" },
];

/**
 * 반복 일정 한 줄.
 *
 * 오늘 돌아오는 일정은 강조하고, 나머지는 다음 발생일을 옅게 붙인다.
 * 시각은 참고용이라 지나도 흐려지지 않는다 — 그날 안에는 그대로 보인다.
 */
export function ScheduleRow({
  memo,
  actions,
  memoActions,
  dnd,
  handleProps,
}: {
  memo: MemoDTO;
  actions: ScheduleActions;
  memoActions: MemoActions;
  /** 순서 변경용 DnD props (memo-item 과 동일 규약). */
  dnd: Record<string, unknown>;
  /** 끌기를 시작하는 손잡이 props. */
  handleProps: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text ?? "");
  const [open, setOpen] = useState(false);

  const rule = memo.recurrence;
  // 자정을 넘겨도 화면이 스스로 따라오도록 분 단위로 다시 그린다.
  // 마운트 전에는 null — 서버와 브라우저의 "지금"이 달라 hydration 이 깨진다.
  const now = useNow(60_000);
  const today = rule && now ? activeToday(rule, memo.createdAt, now) : null;
  const next =
    rule && now && !today ? nextOccurrence(rule, memo.createdAt, now) : null;

  const commit = () => {
    setEditing(false);
    const value = draft.trim();
    if (value && value !== (memo.text ?? "")) actions.onRename(memo, value);
    else setDraft(memo.text ?? "");
  };

  return (
    <li
      {...dnd}
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-(--color-surface-hi)",
        // 오늘이 아니면 조금 물러나 보이게 — 목록이 길어도 오늘 것이 먼저 읽힌다
        now && !today && "opacity-70",
      )}
    >
      <DragHandle handleProps={handleProps} className="h-4" />

      <span
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px]",
          today
            ? "bg-(--color-accent) text-(--color-bg)"
            : "bg-(--color-bg-2) text-(--color-fg-4)",
        )}
        title={
          !now ? "" : today ? "오늘" : next ? describeNext(next, now) : "예정 없음"
        }
      >
        <Repeat className="h-2.5 w-2.5" />
      </span>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(memo.text ?? "");
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-0.5 text-[13px] text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none"
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            setDraft(memo.text ?? "");
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 cursor-text truncate text-[13px] select-text",
            today ? "text-(--color-fg)" : "text-(--color-fg-2)",
          )}
          title={memo.text ?? ""}
        >
          {memo.text}
        </span>
      )}

      {/* 시각 — 참고용이라 지나도 그대로 둔다 */}
      {rule?.timeMinutes != null && (
        <span
          className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-(--color-fg-3)"
          title={
            rule.timeMinutes >= 24 * 60
              ? `다음날 ${formatTime(rule.timeMinutes - 24 * 60)} (참고용)`
              : "참고용 시각"
          }
        >
          <Clock className="h-2.5 w-2.5" />
          {formatTime(rule.timeMinutes)}
        </span>
      )}

      {/* 주기 요약 — 누르면 편집기 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[11px] transition",
          rule
            ? today
              ? "bg-(--color-accent-soft) text-(--color-accent-strong)"
              : "bg-(--color-bg-2) text-(--color-fg-3)"
            : "text-(--color-fg-4) opacity-0 group-hover:opacity-100",
        )}
        title={rule ? "주기 변경" : "주기 설정"}
      >
        {rule ? describeRecurrence(rule) : "주기"}
      </button>

      {/* 오늘이 아니면 다음 발생일, 표시 기간이 있으면 그것도 */}
      {rule && now && (
        <span className="shrink-0 text-[10px] text-(--color-fg-4)">
          {today ? describeWindow(rule) : next ? describeNext(next, now) : "종료"}
        </span>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          memoActions.onDelete(memo);
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-4) opacity-0 transition group-hover:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
        aria-label="삭제"
        title="삭제"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {open && (
        <RuleEditor
          value={rule ?? DEFAULT_RULE}
          onCancel={() => setOpen(false)}
          onClear={() => {
            actions.onRule(memo, null);
            setOpen(false);
          }}
          onSave={(next) => {
            actions.onRule(memo, next);
            setOpen(false);
          }}
        />
      )}
    </li>
  );
}

/** 규칙 편집기 — 행 위에 뜨는 작은 판. */
function RuleEditor({
  value,
  onSave,
  onClear,
  onCancel,
}: {
  value: Recurrence;
  onSave: (rule: Recurrence) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  const [freq, setFreq] = useState<Freq>(value.freq);
  const [interval, setInterval] = useState(String(value.interval));
  const [weekdays, setWeekdays] = useState<number[]>(value.weekdays ?? []);
  const [day, setDay] = useState(value.day ? String(value.day) : "");
  const [month, setMonth] = useState(value.month ? String(value.month) : "");
  const [time, setTime] = useState(
    value.timeMinutes != null ? formatTime(value.timeMinutes) : "",
  );
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const [error, setError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement | null>(null);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCancel]);

  const unit = FREQ_LABELS.find((f) => f.value === freq)?.unit ?? "";

  const save = () => {
    const t = time.trim();
    // 시각은 26:59 까지 — 하루의 끝을 넘겨 쓰는 생활 표기를 그대로 받는다
    const timeMinutes = t ? parseTimeInput(t) : null;
    if (t && timeMinutes == null) {
      setError("시각은 00:00 ~ 26:59 형식으로");
      return;
    }
    onSave({
      freq,
      interval: Math.max(1, Number(interval) || 1),
      weekdays: freq === "weekly" && weekdays.length ? [...weekdays].sort() : undefined,
      day: (freq === "monthly" || freq === "yearly") && day ? Number(day) : undefined,
      month: freq === "yearly" && month ? Number(month) : undefined,
      timeMinutes,
      from: from || null,
      to: to || null,
    });
  };

  return (
    <div
      ref={boxRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute top-full right-0 z-30 mt-1 w-64 rounded-xl border border-(--color-border) bg-(--color-surface) p-3 shadow-xl"
    >
      <div className="flex flex-col gap-2.5 text-[11px] text-(--color-fg-3)">
        {/* 주기 */}
        <div>
          <div className="mb-1 font-medium text-(--color-fg-2)">반복</div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={999}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-12 rounded bg-(--color-bg-2) px-1.5 py-1 text-center text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="간격"
            />
            <span className="text-(--color-fg-4)">{unit}마다</span>
            <div className="ml-auto flex gap-0.5">
              {FREQ_LABELS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFreq(f.value)}
                  aria-pressed={freq === f.value}
                  className={cn(
                    "h-6 w-6 rounded transition",
                    freq === f.value
                      ? "bg-(--color-accent) text-(--color-bg)"
                      : "bg-(--color-bg-2) hover:bg-(--color-surface-hi)",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {freq === "weekly" && (
          <div className="flex gap-0.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() =>
                  setWeekdays((prev) =>
                    prev.includes(i) ? prev.filter((w) => w !== i) : [...prev, i],
                  )
                }
                aria-pressed={weekdays.includes(i)}
                className={cn(
                  "h-6 flex-1 rounded text-[11px] transition",
                  weekdays.includes(i)
                    ? "bg-(--color-accent) text-(--color-bg)"
                    : "bg-(--color-bg-2) hover:bg-(--color-surface-hi)",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {(freq === "monthly" || freq === "yearly") && (
          <div className="flex items-center gap-1.5">
            {freq === "yearly" && (
              <>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  placeholder="월"
                  className="w-12 rounded bg-(--color-bg-2) px-1.5 py-1 text-center text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
                  aria-label="월"
                />
                <span className="text-(--color-fg-4)">월</span>
              </>
            )}
            <input
              type="number"
              min={1}
              max={31}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              placeholder="일"
              className="w-12 rounded bg-(--color-bg-2) px-1.5 py-1 text-center text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="일"
            />
            <span className="text-(--color-fg-4)">일</span>
          </div>
        )}

        {/* 시각 — 참고용, 26:59 까지 */}
        <div>
          <div className="mb-1 font-medium text-(--color-fg-2)">
            시각 <span className="font-normal text-(--color-fg-4)">참고용 · 선택</span>
          </div>
          <input
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setError(null);
            }}
            placeholder="예: 26:00 (다음날 새벽 2시)"
            inputMode="numeric"
            className="w-full rounded bg-(--color-bg-2) px-1.5 py-1 font-mono text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
            aria-label="시각"
          />
        </div>

        {/* 표시 기간 */}
        <div>
          <div className="mb-1 font-medium text-(--color-fg-2)">
            표시 기간 <span className="font-normal text-(--color-fg-4)">선택</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="표시 시작일"
            />
            <span className="text-(--color-fg-4)">~</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="표시 종료일"
            />
          </div>
        </div>

        {error && <div className="text-(--color-danger)">{error}</div>}

        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={save}
            className="flex-1 rounded-lg bg-(--color-accent) py-1.5 font-medium text-(--color-bg) transition hover:opacity-90"
          >
            저장
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-2 py-1.5 text-(--color-fg-4) transition hover:text-(--color-danger)"
            title="주기 해제"
          >
            해제
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 일정 표시는 시간이 지나면 스스로 바뀌어야 한다 — 주기적으로 now 를 새로 준다.
 *
 * 첫 렌더에서 null 을 주는 게 중요하다. 이 페이지는 서버에서도 그려지는데
 * 서버와 브라우저의 "지금"이 다르면 오늘/다음 표시가 어긋나 hydration 이 깨진다.
 * 마운트 후에 값이 들어오고, 그때부터 분 단위로 갱신된다.
 */
function useNow(everyMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
