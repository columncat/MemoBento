"use client";

import { Clock, Link2, Palette, Pencil, Repeat, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { MEMO_COLORS } from "@/lib/db/schema";
import {
  colorVar,
  hostnameOf,
  normalizeUrl,
  type MemoColor,
  type MemoDTO,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { DragHandle, type MemoActions } from "./memo-item";

export interface ScheduleActions {
  /** 반복 규칙 저장 / 해제. */
  onRule: (memo: MemoDTO, rule: Recurrence | null) => void;
  /** 링크 저장 / 해제. */
  onLink: (memo: MemoDTO, url: string | null) => void;
  /** 글자 색 지정 / 해제. */
  onColor: (memo: MemoDTO, color: MemoColor | null) => void;
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
  /** variant="instance" 일 때 날짜 라벨 (오늘/내일/9-12 …). */
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text ?? "");
  const [ruleOpen, setRuleOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

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
  // 링크가 붙어 있으면 본문 클릭이 곧 링크다. 규칙 뷰에서 본문을 고치려면
  // 연필 버튼을 쓴다 — 클릭 한 번에 두 뜻을 담을 수는 없다.
  const bodyIsLink = !!href;
  const isNow = state === "live" || dayLabel === "오늘";

  const onBody = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (!isRuleView) {
      // 인스턴스는 계산 결과다. 여기서 고치면 나머지 발생이 전부 함께 바뀌는데,
      // 사용자는 "그날만 고쳤다"고 읽는다.
      onShowRule?.(memo);
      return;
    }
    setDraft(memo.text ?? "");
    setEditing(true);
  };

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
        "group relative flex min-h-11 items-center gap-2 rounded-lg border-l-[3px] border-transparent px-2.5 py-2 transition hover:bg-(--color-surface-hi)",
        today && "border-(--color-accent)",
        // 알파를 쓰면 밝은 배경에서 사실상 사라진다. 점선으로 위계를 만든다.
        soon && !today && "border-dotted border-(--color-accent)",
        state === "live" && "border-(--color-accent)",
        // 열린 편집기가 다른 행 위로 오도록
        (ruleOpen || linkOpen || colorOpen) && "z-40",
        highlight && "ring-1 ring-(--color-accent)",
      )}
    >
      {handleProps && (
        <DragHandle handleProps={handleProps} className="h-4 @max-[300px]:hidden" />
      )}

      {/* 인스턴스는 날짜 머리글 없이 한 줄씩 늘어서므로 날짜를 직접 단다 */}
      {!isRuleView && day ? (
        <span
          className={cn(
            "flex w-14 shrink-0 flex-col items-center rounded-md px-1 py-0.5 leading-tight",
            isNow
              ? "bg-(--color-accent) text-(--color-bg)"
              : "bg-(--color-bg-2) text-(--color-fg-2)",
          )}
        >
          <span className="text-[11px] font-medium break-keep">{dayLabel}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-80">
            {day.getMonth() + 1}/{day.getDate()}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-full",
            today
              ? "bg-(--color-accent) text-(--color-bg)"
              : "bg-(--color-bg-2) text-(--color-fg-3)",
          )}
          aria-hidden
        >
          <Repeat className="h-3.5 w-3.5" />
        </span>
      )}

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
          className="min-w-0 flex-1 rounded bg-(--color-bg-2) px-1.5 py-1 text-[15px] text-(--color-fg) ring-1 ring-(--color-accent)/60 outline-none"
        />
      ) : (
        <span
          onClick={onBody}
          role={bodyIsLink ? "link" : undefined}
          tabIndex={bodyIsLink ? 0 : undefined}
          onKeyDown={
            bodyIsLink
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onBody(e as unknown as React.MouseEvent);
                  }
                }
              : undefined
          }
          style={{ color: colorVar(memo.color) }}
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] leading-snug break-keep select-text @max-[300px]:line-clamp-2 @max-[300px]:overflow-visible @max-[300px]:whitespace-normal",
            isRuleView && !bodyIsLink ? "cursor-text" : "cursor-pointer",
            bodyIsLink && "hover:underline",
            today || state === "live" ? "font-medium" : undefined,
            // 색을 지정하면 인라인 style 이 이긴다 — 기본색만 클래스로 준다
            !memo.color &&
              (today || state === "live"
                ? "text-(--color-fg)"
                : "text-(--color-fg-2)"),
          )}
          title={bodyIsLink ? `${memo.text ?? ""} — ${hostnameOf(href!)}` : (memo.text ?? "")}
        >
          {memo.text}
        </span>
      )}

      {/* 시각 — 참고용이라 지나도 그대로 둔다 */}
      {rule?.timeMinutes != null && (
        <span
          className="flex shrink-0 items-center gap-0.5 font-mono text-[12px] tabular-nums text-(--color-fg-2)"
          title={
            rule.timeMinutes >= 24 * 60
              ? `다음날 ${formatTime(rule.timeMinutes - 24 * 60)} (참고용)`
              : "참고용 시각"
          }
        >
          {/* 좁아지면 아이콘만 접는다. 인스턴스 목록에서 시각은 그 행의
              유일한 시간 정보라 통째로 숨기면 대체 경로가 없다. */}
          <Clock className="h-3 w-3 @max-[380px]:hidden" />
          {formatTime(rule.timeMinutes)}
        </span>
      )}

      {/* 링크 표시 — 본문 클릭이 곧 링크라 여기서는 표식만 */}
      {href ? (
        <Link2
          className="h-3.5 w-3.5 shrink-0 text-(--color-fg-3)"
          aria-hidden
        />
      ) : memo.url ? (
        <span
          className="shrink-0 px-1 text-[12px] text-(--color-warn)"
          title={`열 수 없는 주소입니다: ${memo.url}`}
          aria-label={`열 수 없는 주소입니다: ${memo.url}`}
        >
          링크?
        </span>
      ) : null}

      {isRuleView && bodyIsLink && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(memo.text ?? "");
            setEditing(true);
          }}
          className="shrink-0 rounded px-1 py-0.5 text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-(--color-fg)"
          aria-label="내용 수정"
          title="내용 수정"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setColorOpen((v) => !v);
            setRuleOpen(false);
            setLinkOpen(false);
          }}
          className="shrink-0 rounded px-1 py-0.5 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="글자 색"
          title="글자 색"
        >
          <Palette
            className="h-3.5 w-3.5"
            style={{ color: colorVar(memo.color) }}
          />
        </button>
      )}

      {isRuleView && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setLinkOpen((v) => !v);
            setRuleOpen(false);
            setColorOpen(false);
          }}
          className="shrink-0 rounded px-1 py-0.5 text-(--color-fg-3) opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:text-(--color-fg)"
          aria-label={memo.url ? "링크 편집" : "링크 추가"}
          title={memo.url ? "링크 편집" : "링크 추가"}
        >
          <Link2 className="h-3.5 w-3.5" />
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
            setColorOpen(false);
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
          title={describeWindow(rule) ? `표시 기간 ${describeWindow(rule)}` : undefined}
        >
          {today ? "오늘" : next ? describeNext(next, now) : "예정 없음"}
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
          createdAt={memo.createdAt}
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

      {colorOpen && (
        <ColorPicker
          value={memo.color}
          onPick={(color) => {
            actions.onColor(memo, color);
            setColorOpen(false);
          }}
          onCancel={() => setColorOpen(false)}
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

/** 글자 색 팔레트. */
function ColorPicker({
  value,
  onPick,
  onCancel,
}: {
  value: MemoColor | null;
  onPick: (color: MemoColor | null) => void;
  onCancel: () => void;
}) {
  return (
    <Popover onCancel={onCancel} className="w-52">
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-medium text-(--color-fg-2)">글자 색</div>
        <div className="grid grid-cols-4 gap-1.5">
          {MEMO_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              aria-pressed={value === c}
              aria-label={COLOR_LABELS[c]}
              title={COLOR_LABELS[c]}
              className={cn(
                "grid h-8 place-items-center rounded-lg text-[15px] font-semibold transition",
                value === c
                  ? "bg-(--color-surface-hi) ring-2 ring-(--color-accent)"
                  : "bg-(--color-bg-2) hover:bg-(--color-surface-hi)",
              )}
              style={{ color: `var(--color-tag-${c})` }}
            >
              가
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onPick(null)}
          className={cn(
            "rounded-lg py-1.5 text-[12px] transition",
            value === null
              ? "bg-(--color-surface-hi) text-(--color-fg-2) ring-1 ring-(--color-accent)"
              : "text-(--color-fg-3) hover:bg-(--color-surface-hi)",
          )}
        >
          기본색
        </button>
      </div>
    </Popover>
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
            className="flex-1 rounded-lg bg-(--color-accent) py-1.5 font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
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
  createdAt,
  onSave,
  onClear,
  onCancel,
}: {
  value: Recurrence;
  /** 요일·일자를 고르지 않았을 때 기준이 되는 날. */
  createdAt: number;
  onSave: (rule: Recurrence) => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  // 기준일은 명시된 anchor, 없으면 만든 날. 표시 기간(from)은 관여하지 않는다.
  const anchorDay = parseDay(value.anchor) ?? new Date(createdAt);
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
    const t = time.trim();
    // 시각은 26:59 까지 — 하루의 끝을 넘겨 쓰는 생활 표기를 그대로 받는다
    const timeMinutes = t ? parseTimeInput(t) : null;
    if (t && timeMinutes == null) {
      setError("시각은 00:00 ~ 26:59 형식으로");
      return;
    }
    onSave({
      // 기준일은 사용자가 건드리지 않는다. 여기서 흘리면 다음 저장 때
      // 만든 날로 되돌아가면서 발생 요일이 바뀐다.
      anchor: value.anchor ?? null,
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
            className="flex-1 rounded-lg bg-(--color-accent) py-1.5 font-medium text-(--color-bg) transition hover:bg-(--color-accent-strong)"
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
