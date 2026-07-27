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
  memoActions,
  variant = "rule",
  now,
  day,
  dayLabel,
  state,
  dnd,
  handleProps,
  onShowRule,
}: {
  memo: MemoDTO;
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
  /** 순서 변경용 DnD props (memo-item 과 동일 규약). 인스턴스 뷰에서는 없다. */
  dnd?: Record<string, unknown>;
  /** 끌기를 시작하는 손잡이 props. 인스턴스 뷰에서는 없다. */
  handleProps?: Record<string, unknown>;
  /** 인스턴스에서 규칙 목록으로 이동. */
  onShowRule?: (memo: MemoDTO) => void;
}) {
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

      {/* 편집은 넓은 표에서 한다 — 규칙 하나에 값이 열 개 가까이라 행 위
          팝오버로는 어느 것도 제대로 보이지 않았다 */}
      {isRuleView && onShowRule && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowRule(memo);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-fg-3) transition hover:bg-(--color-bg-2) hover:text-(--color-fg)"
          aria-label="수정"
          title="반복 규칙 편집 표 열기"
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

    </li>
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
