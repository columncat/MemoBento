"use client";

import { Clock, Link2, Pencil, Repeat, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  activeToday,
  daysUntil,
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
import type { InstanceState } from "@/lib/schedule-instances";
import { hostnameOf, normalizeUrl, type MemoDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

import { DragHandle, type MemoActions } from "./memo-item";

export interface ScheduleActions {
  /** 반복 규칙 저장 / 해제. */
  onRule: (memo: MemoDTO, rule: Recurrence | null) => void;
  /** 링크 저장 / 해제. */
  onLink: (memo: MemoDTO, url: string | null) => void;
  /** 본문 수정. */
  onRename: (memo: MemoDTO, text: string) => void;
}

/**
 * "rule"     — 규칙 목록. 편집·삭제·순서 변경 전부 가능.
 * "instance" — 계산된 발생 목록. 읽기 전용이다.
 */
export type ScheduleVariant = "rule" | "instance";

const DEFAULT_RULE: Recurrence = { freq: "weekly", interval: 1, weekdays: [1] };

const FREQ_LABELS: { value: Freq; label: string; unit: string }[] = [
  { value: "daily", label: "일", unit: "일" },
  { value: "weekly", label: "주", unit: "주" },
  { value: "monthly", label: "월", unit: "개월" },
  { value: "yearly", label: "년", unit: "년" },
];

/**
 * 링크는 렌더 시점에 스킴을 한 번 더 막는다.
 *
 * 서버 PATCH 는 normalizeUrl 을 거치지만 백업 가져오기(importNotebooks)는
 * url 을 검증 없이 그대로 넣는다. 손으로 고친 백업이면 임의 스킴이 DB 에
 * 들어올 수 있고, 그걸 href 에 그대로 실으면 클릭 한 번에 실행된다.
 */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * 반복 일정 한 줄.
 *
 * 규칙 뷰에서는 오늘 돌아오는 일정을 왼쪽 강조 바로 표시하고 다음 발생일을
 * 붙인다. 인스턴스 뷰에서는 이미 날짜별로 묶여 있으므로 시각만 남긴다.
 * 시각은 참고용이라 지나도 흐려지지 않는다 — 그날 안에는 그대로 보인다.
 */
export function ScheduleRow({
  memo,
  actions,
  memoActions,
  variant = "rule",
  now,
  state,
  highlight = false,
  dnd,
  handleProps,
  onShowRule,
}: {
  memo: MemoDTO;
  actions: ScheduleActions;
  memoActions: MemoActions;
  variant?: ScheduleVariant;
  /** 목록에서 한 번만 계산해 내려주는 "지금". null 이면 시간 의존 표시를 그리지 않는다. */
  now: Date | null;
  /** variant="instance" 일 때 이 발생의 상태. */
  state?: InstanceState;
  /** 인스턴스에서 규칙으로 건너왔을 때 잠깐 표시. */
  highlight?: boolean;
  /** 순서 변경용 DnD props (memo-item 과 동일 규약). 인스턴스 뷰에서는 없다. */
  dnd?: Record<string, unknown>;
  /** 끌기를 시작하는 손잡이 props. 인스턴스 뷰에서는 없다. */
  handleProps?: Record<string, unknown>;
  /** 인스턴스에서 규칙 목록으로 이동. */
  onShowRule?: (memo: MemoDTO) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text ?? "");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const rule = memo.recurrence;
  const isRuleView = variant === "rule";

  // nextOccurrence 는 긴 주기에서 수십만 번을 돈다. now 가 분마다 바뀌므로
  // 메모해 두지 않으면 목록 전체가 매분 멈칫한다. 인스턴스 뷰에서는 아예
  // 부르지 않는다 — 날짜는 이미 전개 단계에서 정해졌다.
  const today = useMemo(
    () => (isRuleView && rule && now ? activeToday(rule, memo.createdAt, now) : null),
    [isRuleView, rule, memo.createdAt, now],
  );
  const next = useMemo(
    () =>
      isRuleView && rule && now && !today
        ? nextOccurrence(rule, memo.createdAt, now)
        : null,
    [isRuleView, rule, memo.createdAt, now, today],
  );
  const soon = next && now ? daysUntil(next, now) <= 2 : false;

  const href = safeHref(memo.url);

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
        "group relative flex min-h-8 items-center gap-1.5 rounded-md border-l-2 border-transparent px-2 py-1.5 transition hover:bg-(--color-surface-hi)",
        today && "border-(--color-accent)",
        soon && !today && "border-(--color-accent)/40",
        state === "live" && "border-(--color-accent)",
        // 열린 편집기가 sticky 날짜 헤더 아래로 깔리지 않게
        (ruleOpen || linkOpen) && "z-40",
        highlight && "ring-1 ring-(--color-accent)",
      )}
    >
      {handleProps && (
        <DragHandle handleProps={handleProps} className="h-4 @max-[300px]:hidden" />
      )}

      <span
        className={cn(
          "grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full",
          today || state === "live"
            ? "bg-(--color-accent) text-(--color-bg)"
            : "bg-(--color-bg-2) text-(--color-fg-3)",
        )}
        aria-hidden
      >
        <Repeat className="h-3 w-3" />
      </span>

      {isRuleView && editing ? (
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
          className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-0.5 text-sm text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none"
        />
      ) : (
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (!isRuleView) {
              // 인스턴스는 계산 결과다. 여기서 고치면 나머지 발생이 전부 함께
              // 바뀌는데, 사용자는 "그날만 고쳤다"고 읽는다.
              onShowRule?.(memo);
              return;
            }
            setDraft(memo.text ?? "");
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 truncate text-sm leading-snug break-keep select-text @max-[300px]:line-clamp-2 @max-[300px]:overflow-visible @max-[300px]:whitespace-normal",
            isRuleView ? "cursor-text" : "cursor-pointer",
            today || state === "live"
              ? "font-medium text-(--color-fg)"
              : "text-(--color-fg-2)",
          )}
          title={memo.text ?? ""}
        >
          {memo.text}
        </span>
      )}

      {/* 시각 — 참고용이라 지나도 그대로 둔다 */}
      {rule?.timeMinutes != null && (
        <span
          className="flex shrink-0 items-center gap-0.5 font-mono text-[12px] tabular-nums text-(--color-fg-2) @max-[380px]:hidden"
          title={
            rule.timeMinutes >= 24 * 60
              ? `다음날 ${formatTime(rule.timeMinutes - 24 * 60)} (참고용)`
              : "참고용 시각"
          }
        >
          <Clock className="h-3 w-3" />
          {formatTime(rule.timeMinutes)}
        </span>
      )}

      {/* 링크 */}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={hostnameOf(href)}
          aria-label={`링크 열기 — ${hostnameOf(href)}`}
          className="shrink-0 rounded px-1 py-0.5 text-(--color-fg-3) transition hover:text-(--color-accent-strong)"
        >
          <Link2 className="h-3.5 w-3.5" />
        </a>
      ) : memo.url ? (
        <span
          className="shrink-0 px-1 text-[12px] text-(--color-fg-3)"
          title={`열 수 없는 주소입니다: ${memo.url}`}
        >
          링크?
        </span>
      ) : null}

      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLinkOpen((v) => !v);
            setRuleOpen(false);
          }}
          className="shrink-0 rounded px-1 py-0.5 text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-(--color-fg)"
          aria-label={memo.url ? "링크 편집" : "링크 추가"}
          title={memo.url ? "링크 편집" : "링크 추가"}
        >
          {memo.url ? <Pencil className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* 주기 — 규칙 뷰에서만 누를 수 있다 */}
      {isRuleView ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setRuleOpen((v) => !v);
            setLinkOpen(false);
          }}
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[12px] transition",
            rule
              ? today
                ? "bg-(--color-accent-soft) font-medium text-(--color-accent-strong)"
                : "bg-(--color-bg-2) text-(--color-fg-2)"
              : "text-(--color-fg-3) opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          aria-label={rule ? `주기 변경 — ${describeRecurrence(rule)}` : "주기 설정"}
          title={rule ? `주기 변경 — ${describeRecurrence(rule)}` : "주기 설정"}
        >
          <Repeat className="hidden h-3 w-3 @max-[300px]:block" aria-hidden />
          <span className="@max-[300px]:hidden">
            {rule ? describeRecurrence(rule) : "주기"}
          </span>
        </button>
      ) : (
        onShowRule && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowRule(memo);
            }}
            className="shrink-0 rounded px-1 py-0.5 text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-(--color-fg)"
            aria-label={rule ? `규칙 보기 — ${describeRecurrence(rule)}` : "규칙 보기"}
            title={rule ? `규칙 보기 — ${describeRecurrence(rule)}` : "규칙 보기"}
          >
            <Repeat className="h-3.5 w-3.5" />
          </button>
        )
      )}

      {/* 다음 발생일 — 규칙 뷰 전용. 인스턴스 뷰는 날짜 머리글이 대신한다 */}
      {isRuleView && rule && now && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 font-mono text-[12px] tabular-nums whitespace-nowrap",
            today
              ? "bg-(--color-accent) font-medium text-(--color-bg)"
              : soon
                ? "bg-(--color-accent-soft) font-medium text-(--color-accent-strong)"
                : "bg-(--color-bg-2) text-(--color-fg-2)",
          )}
        >
          {today ? describeWindow(rule) || "오늘" : next ? describeNext(next, now) : "종료"}
        </span>
      )}

      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            memoActions.onDelete(memo);
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
          aria-label="삭제"
          title="삭제"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {ruleOpen && (
        <RuleEditor
          value={rule ?? DEFAULT_RULE}
          onCancel={() => setRuleOpen(false)}
          onClear={() => {
            actions.onRule(memo, null);
            setRuleOpen(false);
          }}
          onSave={(saved) => {
            actions.onRule(memo, saved);
            setRuleOpen(false);
          }}
        />
      )}

      {linkOpen && (
        <LinkEditor
          value={memo.url ?? ""}
          onCancel={() => setLinkOpen(false)}
          onSave={(url) => {
            actions.onLink(memo, url);
            setLinkOpen(false);
          }}
        />
      )}
    </li>
  );
}

/** 행 위에 뜨는 작은 판 — 규칙 편집기와 링크 편집기가 공유한다. */
function Popover({
  onCancel,
  className,
  children,
}: {
  onCancel: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCancel]);

  return (
    <div
      ref={boxRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "absolute top-full right-0 z-30 mt-1 rounded-xl border border-(--color-border) bg-(--color-surface) p-3 shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 링크 편집기. */
function LinkEditor({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (url: string | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const raw = draft.trim();
    if (!raw) {
      onSave(null);
      return;
    }
    // 서버도 검증하지만 여기서 먼저 막는다 — 낙관적 반영이 검증 전 원본
    // 문자열을 그대로 화면에 올리기 때문이다.
    const url = normalizeUrl(raw);
    if (!url) {
      setError("올바른 주소가 아닙니다");
      return;
    }
    onSave(url);
  };

  return (
    <Popover onCancel={onCancel} className="w-72">
      <div className="flex flex-col gap-2 text-[12px] text-(--color-fg-2)">
        <div className="font-medium text-(--color-fg-2)">
          링크 <span className="font-normal text-(--color-fg-3)">선택</span>
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="https://example.com"
          className="w-full rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
          aria-label="링크 주소"
        />
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
            onClick={() => onSave(null)}
            className="rounded-lg px-2 py-1.5 text-(--color-fg-3) transition hover:text-(--color-danger)"
            title="링크 해제"
          >
            해제
          </button>
        </div>
      </div>
    </Popover>
  );
}

/** 규칙 편집기. */
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
      weekdays:
        freq === "weekly" && weekdays.length ? [...weekdays].sort() : undefined,
      day: (freq === "monthly" || freq === "yearly") && day ? Number(day) : undefined,
      month: freq === "yearly" && month ? Number(month) : undefined,
      timeMinutes,
      from: from || null,
      to: to || null,
    });
  };

  return (
    <Popover onCancel={onCancel} className="w-72">
      <div className="flex flex-col gap-2.5 text-[12px] text-(--color-fg-2)">
        {/* 주기 */}
        <div>
          <div className="mb-1 font-medium text-(--color-fg-2)">반복</div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={freq === "yearly" ? 20 : 999}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-12 rounded bg-(--color-bg-2) px-1.5 py-1 text-center text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="간격"
            />
            <span className="text-(--color-fg-3)">{unit}마다</span>
            <div className="ml-auto flex gap-0.5">
              {FREQ_LABELS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFreq(f.value)}
                  aria-pressed={freq === f.value}
                  aria-label={`${f.unit} 단위`}
                  className={cn(
                    "h-7 w-7 rounded transition",
                    freq === f.value
                      ? "bg-(--color-accent) font-medium text-(--color-bg)"
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
                aria-label={`${label}요일`}
                className={cn(
                  "h-7 flex-1 rounded text-[12px] transition",
                  weekdays.includes(i)
                    ? "bg-(--color-accent) font-medium text-(--color-bg)"
                    : "bg-(--color-bg-2) hover:bg-(--color-surface-hi)",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {(freq === "monthly" || freq === "yearly") && (
          <div className="flex flex-col gap-1">
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
                  <span className="text-(--color-fg-3)">월</span>
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
              <span className="text-(--color-fg-3)">일</span>
            </div>
            {Number(day) >= 29 && (
              <p className="text-[12px] text-(--color-fg-3)">
                29·30·31일은 그 날짜가 없는 달을 건너뜁니다
              </p>
            )}
          </div>
        )}

        {/* 시각 — 참고용, 26:59 까지 */}
        <div>
          <div className="mb-1 font-medium text-(--color-fg-2)">
            시각 <span className="font-normal text-(--color-fg-3)">참고용 · 선택</span>
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
            표시 기간 <span className="font-normal text-(--color-fg-3)">선택</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-1 text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)"
              aria-label="표시 시작일"
            />
            <span className="text-(--color-fg-3)">~</span>
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
            className="rounded-lg px-2 py-1.5 text-(--color-fg-3) transition hover:text-(--color-danger)"
            title="주기 해제"
          >
            해제
          </button>
        </div>
      </div>
    </Popover>
  );
}

/**
 * 일정 표시는 시간이 지나면 스스로 바뀌어야 한다 — 주기적으로 now 를 새로 준다.
 *
 * 첫 렌더에서 null 을 주는 게 중요하다. 이 페이지는 서버에서도 그려지는데
 * 서버와 브라우저의 "지금"이 다르면 오늘/다음 표시가 어긋나 hydration 이 깨진다.
 * 마운트 후에 값이 들어오고, 그때부터 분 단위로 갱신된다.
 *
 * 목록에서 **한 번만** 호출하고 각 행에 내려보낸다. 행마다 부르면 타이머가
 * 행 수만큼 생기고, 인스턴스 전개 후에는 그 수가 수십 개가 된다.
 */
export function useNow(everyMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
