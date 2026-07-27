"use client";

import { Clock, Link2, Repeat, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MEMO_COLORS } from "@/lib/db/schema";
import {
  activeToday,
  daysUntil,
  describeNext,
  describeRecurrence,
  describeWindow,
  formatTime,
  nextOccurrence,
  parseDay,
  parseTimeInput,
  toDayString,
  WEEKDAY_LABELS,
  type Freq,
  type Recurrence,
} from "@/lib/recurrence";
import type { InstanceState } from "@/lib/schedule-instances";
import {
  colorVar,
  hostnameOf,
  normalizeUrl,
  type MemoColor,
  type MemoDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { DragHandle, type MemoActions } from "./memo-item";

/** 한 번에 저장되는 항목 변경. 담긴 것만 바뀐다. */
export interface SchedulePatch {
  text?: string;
  url?: string | null;
  color?: MemoColor | null;
  recurrence?: Recurrence | null;
}

export interface ScheduleActions {
  /**
   * 항목 저장. 내용·링크·색·주기를 한 번에 받는다.
   *
   * 편집기가 하나로 합쳐졌으므로 저장도 한 번이어야 한다. 필드마다 따로
   * 보내면 요청 네 개가 경쟁하고, 중간에 하나만 실패했을 때 화면과 서버가
   * 어긋난다.
   */
  onSave: (memo: MemoDTO, patch: SchedulePatch) => void;
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
 * 두 줄로 그린다 — 위는 제목, 아래는 부가 정보(시각·주기·다음 발생).
 * 제목이 아이콘·칩과 가로로 자리를 다투면 좁은 카드에서 제목만 사라진다.
 *
 * 시각은 참고용이라 지나도 흐려지지 않는다 — 그날 안에는 그대로 보인다.
 */
export function ScheduleRow({
  memo,
  actions,
  memoActions,
  variant = "rule",
  now,
  day,
  dayLabel,
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
  /** variant="instance" 일 때 이 발생일. */
  day?: Date;
  /** variant="instance" 일 때 날짜 라벨 (오늘/내일/화요일 …). */
  dayLabel?: string;
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
  const [editorOpen, setEditorOpen] = useState(false);

  const rule = memo.recurrence;
  const isRuleView = variant === "rule";

  // nextOccurrence 는 긴 주기에서 수십만 번을 돈다. now 가 분마다 바뀌므로
  // 메모해 두지 않으면 목록 전체가 매분 멈칫한다. 인스턴스 뷰에서는 아예
  // 부르지 않는다 — 날짜는 이미 전개 단계에서 정해졌다.
  const today = useMemo(
    () => (isRuleView && rule && now ? activeToday(rule, memo.createdAt, now) : null),
    [isRuleView, rule, memo.createdAt, now],
  );
  // nextOccurrence 는 안에서 날짜만 본다. now 를 그대로 의존성에 넣으면 매분
  // 새 객체라 메모가 늘 무효화돼 목록 전체가 분마다 다시 계산된다.
  const nowDay = now ? toDayString(now) : null;
  const hasToday = !!today;
  const next = useMemo(
    () =>
      isRuleView && rule && nowDay && !hasToday
        ? nextOccurrence(rule, memo.createdAt, parseDay(nowDay)!)
        : null,
    [isRuleView, rule, memo.createdAt, nowDay, hasToday],
  );
  const soon = next && now ? daysUntil(next, now) <= 2 : false;

  const href = safeHref(memo.url);
  const isNow = state === "live" || dayLabel === "오늘" || !!today;

  const openLink = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (href) window.open(href, "_blank", "noopener,noreferrer");
    else if (!isRuleView) onShowRule?.(memo);
  };

  const timeText = rule?.timeMinutes != null ? formatTime(rule.timeMinutes) : null;
  const timeTitle =
    rule?.timeMinutes != null && rule.timeMinutes >= 24 * 60
      ? `다음날 ${formatTime(rule.timeMinutes - 24 * 60)} (참고용)`
      : "참고용 시각";

  return (
    <li
      {...dnd}
      className={cn(
        "group relative flex min-h-14 items-center gap-2.5 rounded-lg border-l-[3px] border-transparent px-2.5 py-2 transition hover:bg-(--color-surface-hi)",
        isNow && "border-(--color-accent)",
        // 알파를 쓰면 밝은 배경에서 사실상 사라진다. 점선으로 위계를 만든다.
        soon && !today && "border-dotted border-(--color-accent)",
        editorOpen && "z-40",
        highlight && "ring-1 ring-(--color-accent)",
      )}
    >
      {handleProps && (
        <DragHandle handleProps={handleProps} className="h-4 @max-[300px]:hidden" />
      )}

      {/* 날짜 칸 — 인스턴스는 날짜 머리글 없이 늘어서므로 각 행이 직접 단다 */}
      {!isRuleView && day ? (
        <span
          className={cn(
            "flex w-[52px] shrink-0 flex-col items-center rounded-md px-1 py-1 leading-tight",
            isNow
              ? "bg-(--color-accent) text-(--color-bg)"
              : "bg-(--color-bg-2) text-(--color-fg-2)",
          )}
        >
          <span className="text-[12px] font-medium break-keep">{dayLabel}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-80">
            {day.getMonth() + 1}/{day.getDate()}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-full",
            isNow
              ? "bg-(--color-accent) text-(--color-bg)"
              : "bg-(--color-bg-2) text-(--color-fg-3)",
          )}
          aria-hidden
        >
          <Repeat className="h-3.5 w-3.5" />
        </span>
      )}

      {/* 제목 + 부가 정보. 세로로 쌓아 제목이 가로 자리를 다투지 않게 한다. */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          onClick={href || !isRuleView ? openLink : undefined}
          role={href ? "link" : undefined}
          tabIndex={href ? 0 : undefined}
          onKeyDown={
            href
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openLink(e);
                  }
                }
              : undefined
          }
          style={{ color: colorVar(memo.color) }}
          className={cn(
            "line-clamp-2 text-[15px] leading-snug break-keep select-text",
            (href || !isRuleView) && "cursor-pointer",
            href && "hover:underline",
            isNow && "font-medium",
            // 색을 지정하면 인라인 style 이 이긴다 — 기본색만 클래스로 준다
            !memo.color && (isNow ? "text-(--color-fg)" : "text-(--color-fg-2)"),
          )}
          title={href ? `${memo.text ?? ""} — ${hostnameOf(href)}` : (memo.text ?? "")}
        >
          {memo.text}
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-(--color-fg-3)">
          {timeText && (
            <span
              className="flex items-center gap-0.5 font-mono tabular-nums"
              title={timeTitle}
            >
              <Clock className="h-3 w-3" aria-hidden />
              {timeText}
            </span>
          )}

          {/* 규칙 목록에서는 주기와 다음 발생일을 아래 줄에 함께 둔다 */}
          {isRuleView && rule && (
            <span title={describeWindow(rule) ? `표시 기간 ${describeWindow(rule)}` : undefined}>
              {describeRecurrence(rule)}
            </span>
          )}
          {isRuleView && rule && now && (
            <span
              className={cn(
                "rounded px-1.5 py-px",
                today
                  ? "bg-(--color-accent) font-medium text-(--color-bg)"
                  : soon
                    ? "bg-(--color-accent-soft) font-medium text-(--color-accent-strong)"
                    : "bg-(--color-bg-2) text-(--color-fg-2)",
              )}
            >
              {today ? "오늘" : next ? describeNext(next, now) : "예정 없음"}
            </span>
          )}
          {isRuleView && !rule && (
            <span className="text-(--color-warn)">주기 없음</span>
          )}
          {isRuleView && href && (
            <span className="flex items-center gap-0.5">
              <Link2 className="h-3 w-3" aria-hidden />
              {hostnameOf(href)}
            </span>
          )}
          {memo.url && !href && (
            <span
              className="text-(--color-warn)"
              title={`열 수 없는 주소입니다: ${memo.url}`}
            >
              링크?
            </span>
          )}
        </span>
      </span>

      {/* 수정은 하나로 합쳤다 — 내용·링크·색·주기가 한 판에 있다 */}
      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditorOpen((v) => !v);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-3) transition hover:bg-(--color-bg-2) hover:text-(--color-fg)"
          aria-label="수정"
          title="수정 — 내용·링크·색·주기"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      )}

      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            memoActions.onDelete(memo);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-(--color-danger)/20 hover:text-(--color-danger)"
          aria-label="삭제"
          title="삭제"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {editorOpen && (
        <ItemEditor
          memo={memo}
          onCancel={() => setEditorOpen(false)}
          onSave={(patch) => {
            actions.onSave(memo, patch);
            setEditorOpen(false);
          }}
        />
      )}
    </li>
  );
}

/** 행 위에 뜨는 판. */
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
        "absolute top-full right-0 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-(--color-border) bg-(--color-surface) p-3 shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[12px] font-medium text-(--color-fg-2)">
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded bg-(--color-bg-2) px-2 py-1.5 text-[13px] text-(--color-fg) ring-1 ring-(--color-border-soft) outline-none focus:ring-(--color-accent)";

/**
 * 항목 편집기 — 내용·링크·색·주기가 한 판에 있다.
 *
 * 예전에는 셋이 각각 버튼과 팝오버를 가졌는데, 좁은 카드에서 아이콘 세 개가
 * 제목 자리를 먹었고 어느 버튼이 무엇인지도 알기 어려웠다.
 */
function ItemEditor({
  memo,
  onSave,
  onCancel,
}: {
  memo: MemoDTO;
  onSave: (patch: SchedulePatch) => void;
  onCancel: () => void;
}) {
  const value = memo.recurrence ?? DEFAULT_RULE;
  const hasRule = !!memo.recurrence;
  // 기준일은 명시된 anchor, 없으면 만든 날. 표시 기간(from)은 관여하지 않는다.
  const anchorDay = parseDay(value.anchor) ?? new Date(memo.createdAt);

  const [text, setText] = useState(memo.text ?? "");
  const [url, setUrl] = useState(memo.url ?? "");
  const [color, setColor] = useState<MemoColor | null>(memo.color);
  const [enabled, setEnabled] = useState(hasRule);
  const [freq, setFreq] = useState<Freq>(value.freq);
  const [interval, setInterval] = useState(String(value.interval));
  // 요일을 고르지 않은 규칙은 기준일의 요일로 돈다. 비워 두면 화면에 아무
  // 단서가 없어 왜 그 요일인지 알 수 없으므로 미리 눌러 보여 준다.
  const [weekdays, setWeekdays] = useState<number[]>(
    value.weekdays ?? (value.freq === "weekly" ? [anchorDay.getDay()] : []),
  );
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
    const body = text.trim();
    if (!body) {
      setError("내용을 비울 수 없습니다");
      return;
    }

    const raw = url.trim();
    let nextUrl: string | null = null;
    if (raw) {
      // 서버도 검증하지만 여기서 먼저 막는다 — 낙관적 반영이 검증 전 원본
      // 문자열을 그대로 화면에 올리기 때문이다.
      nextUrl = normalizeUrl(raw);
      if (!nextUrl) {
        setError("올바른 주소가 아닙니다");
        return;
      }
    }

    let recurrence: Recurrence | null = null;
    if (enabled) {
      const t = time.trim();
      // 시각은 26:59 까지 — 하루의 끝을 넘겨 쓰는 생활 표기를 그대로 받는다
      const timeMinutes = t ? parseTimeInput(t) : null;
      if (t && timeMinutes == null) {
        setError("시각은 00:00 ~ 26:59 형식으로");
        return;
      }
      recurrence = {
        // 기준일은 사용자가 건드리지 않는다. 여기서 흘리면 다음 저장 때
        // 만든 날로 되돌아가면서 발생 요일이 바뀐다.
        anchor: value.anchor ?? null,
        freq,
        interval: Math.max(1, Number(interval) || 1),
        weekdays:
          freq === "weekly" && weekdays.length ? [...weekdays].sort() : undefined,
        day:
          (freq === "monthly" || freq === "yearly") && day ? Number(day) : undefined,
        month: freq === "yearly" && month ? Number(month) : undefined,
        timeMinutes,
        from: from || null,
        to: to || null,
      };
    }

    onSave({ text: body, url: nextUrl, color, recurrence });
  };

  return (
    <Popover onCancel={onCancel} className="w-72">
      <div className="flex flex-col gap-3 text-[12px] text-(--color-fg-2)">
        <div>
          <FieldLabel>내용</FieldLabel>
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onCancel();
            }}
            className={cn(inputClass, "resize-none")}
            aria-label="내용"
          />
        </div>

        <div>
          <FieldLabel>
            링크 <span className="font-normal text-(--color-fg-3)">선택</span>
          </FieldLabel>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="https://example.com"
            className={inputClass}
            aria-label="링크 주소"
          />
        </div>

        <div>
          <FieldLabel>글자 색</FieldLabel>
          <div className="grid grid-cols-5 gap-1.5">
            {MEMO_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-pressed={color === c}
                aria-label={COLOR_LABELS[c]}
                title={COLOR_LABELS[c]}
                className={cn(
                  "grid h-8 place-items-center rounded-lg text-[15px] font-semibold transition",
                  color === c
                    ? "bg-(--color-surface-hi) ring-2 ring-(--color-accent)"
                    : "bg-(--color-bg-2) hover:bg-(--color-surface-hi)",
                )}
                style={{ color: `var(--color-tag-${c})` }}
              >
                가
              </button>
            ))}
            <button
              type="button"
              onClick={() => setColor(null)}
              aria-pressed={color === null}
              aria-label="기본색"
              title="기본색"
              className={cn(
                "col-span-2 grid h-8 place-items-center rounded-lg text-[12px] transition",
                color === null
                  ? "bg-(--color-surface-hi) text-(--color-fg-2) ring-2 ring-(--color-accent)"
                  : "bg-(--color-bg-2) text-(--color-fg-3) hover:bg-(--color-surface-hi)",
              )}
            >
              기본색
            </button>
          </div>
        </div>

        <div className="border-t border-(--color-border-soft) pt-2.5">
          <label className="mb-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-(--color-accent)"
            />
            <span className="text-[12px] font-medium text-(--color-fg-2)">
              반복
            </span>
            <span className="text-[12px] text-(--color-fg-3)">
              {enabled ? "" : "끄면 목록에 뜨지 않습니다"}
            </span>
          </label>

          {enabled && (
            <div className="flex flex-col gap-2.5">
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

              {freq === "weekly" && (
                <div className="flex gap-0.5">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setWeekdays((prev) =>
                          prev.includes(i)
                            ? prev.filter((w) => w !== i)
                            : [...prev, i],
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

              <div>
                <FieldLabel>
                  시각{" "}
                  <span className="font-normal text-(--color-fg-3)">
                    참고용 · 선택
                  </span>
                </FieldLabel>
                <input
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="예: 26:00 (다음날 새벽 2시)"
                  inputMode="numeric"
                  className={cn(inputClass, "font-mono")}
                  aria-label="시각"
                />
              </div>

              <div>
                <FieldLabel>
                  표시 기간{" "}
                  <span className="font-normal text-(--color-fg-3)">선택</span>
                </FieldLabel>
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
            </div>
          )}
        </div>

        {error && <div className="text-(--color-danger)">{error}</div>}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={save}
            className="flex-1 rounded-lg bg-(--color-accent) py-2 font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
          >
            저장
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-(--color-fg-3) transition hover:bg-(--color-surface-hi) hover:text-(--color-fg-2)"
          >
            취소
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
