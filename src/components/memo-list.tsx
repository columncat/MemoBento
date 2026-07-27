"use client";

import { CalendarDays, ChevronDown, ChevronRight, Inbox, Repeat } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DEFAULT_HORIZON_MONTHS,
  defaultRange,
  dropPast,
  expandMemos,
  groupByDay,
  instanceState,
  scheduleViewOf,
  type ScheduleInstance,
} from "@/lib/schedule-instances";
import type { MemoDTO, NotebookKind, ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ChecklistRow, type ChecklistActions } from "./checklist-item";
import { MemoRow, MemoTile, useItemDnd, type MemoActions } from "./memo-item";
import { ScheduleRow, useNow, type ScheduleActions } from "./schedule-item";

/** 한 번에 펼쳐 보여주는 날짜 수. 나머지는 버튼으로 더 펼친다. */
const DAYS_PER_PAGE = 7;

export function MemoList({
  memos,
  viewMode,
  kind,
  actions,
  checklistActions,
  scheduleActions,
  emptyHint,
  highlightId,
  onShowRule,
}: {
  memos: MemoDTO[];
  viewMode: ViewMode;
  kind: NotebookKind;
  actions: MemoActions;
  checklistActions: ChecklistActions;
  scheduleActions: ScheduleActions;
  emptyHint?: string;
  /** 규칙 뷰로 건너온 직후 잠깐 강조할 메모. */
  highlightId?: string | null;
  /** 인스턴스에서 규칙 목록으로 이동. */
  onShowRule?: (memo: MemoDTO) => void;
}) {
  // 반복 일정은 비어 있어도 자체 안내가 필요하다 (규칙은 있는데 발생이 없는
  // 경우가 있어서, 공통 빈 상태로는 사용자가 데이터가 사라졌다고 읽는다).
  if (kind === "schedule") {
    return (
      <ScheduleSection
        memos={memos}
        viewMode={viewMode}
        actions={scheduleActions}
        memoActions={actions}
        highlightId={highlightId}
        onShowRule={onShowRule}
      />
    );
  }

  if (memos.length === 0) {
    // break-keep — 한국어가 좁은 카드(6단)에서 음절 중간에 끊기지 않게
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-3)">
        <Inbox className="mx-auto mb-1.5 h-4 w-4" />
        {emptyHint ?? "메모가 없습니다"}
      </div>
    );
  }

  // 체크리스트·TODO 는 보기 방식과 무관하게 얇은 한 줄로 그린다
  if (kind === "checklist" || kind === "todo") {
    return (
      <ul className="flex flex-col">
        {memos.map((m) => (
          <ChecklistItem
            key={m.id}
            memo={m}
            kind={kind}
            actions={checklistActions}
            memoActions={actions}
          />
        ))}
      </ul>
    );
  }

  if (viewMode === "grid") {
    // 카드 폭과 무관하게 한 행에 3개 고정
    return (
      <ul className="grid grid-cols-3 gap-2">
        {memos.map((m) => (
          <MemoTile key={m.id} memo={m} actions={actions} />
        ))}
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {memos.map((m) => (
        <MemoRow key={m.id} memo={m} actions={actions} />
      ))}
    </ul>
  );
}

/**
 * 반복 일정 메모함.
 *
 * 기본은 "다가올 일정" — 규칙을 앞으로 2개월치 실제 날짜로 펼쳐 날짜별로
 * 묶어 보여준다. 이 목록은 계산 결과라 읽기 전용이고, 고치려면 "반복 규칙"
 * 뷰로 넘어간다.
 */
function ScheduleSection({
  memos,
  viewMode,
  actions,
  memoActions,
  highlightId,
  onShowRule,
}: {
  memos: MemoDTO[];
  viewMode: ViewMode;
  actions: ScheduleActions;
  memoActions: MemoActions;
  highlightId?: string | null;
  onShowRule?: (memo: MemoDTO) => void;
}) {
  // 목록에서 한 번만 계산해 모든 행에 내려준다
  const now = useNow(60_000);
  const view = scheduleViewOf(viewMode);

  if (view === "rules") {
    if (memos.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-3)">
          <Repeat className="mx-auto mb-1.5 h-4 w-4" />
          반복할 일정을 입력하세요
        </div>
      );
    }
    return (
      <ul className="flex flex-col">
        {memos.map((m) => (
          <ScheduleItem
            key={m.id}
            memo={m}
            actions={actions}
            memoActions={memoActions}
            now={now}
            highlight={highlightId === m.id}
          />
        ))}
      </ul>
    );
  }

  return (
    <InstanceView
      memos={memos}
      now={now}
      actions={actions}
      memoActions={memoActions}
      onShowRule={onShowRule}
    />
  );
}

function InstanceView({
  memos,
  now,
  actions,
  memoActions,
  onShowRule,
}: {
  memos: MemoDTO[];
  now: Date | null;
  actions: ScheduleActions;
  memoActions: MemoActions;
  onShowRule?: (memo: MemoDTO) => void;
}) {
  const [days, setDays] = useState(DAYS_PER_PAGE);
  const [showDormant, setShowDormant] = useState(false);

  // now 를 분 단위로 새로 받으므로 전개를 그때마다 다시 하지 않도록 묶는다.
  // 날짜(자정)가 넘어갈 때만 실제로 다시 계산된다.
  const dayKeyOfNow = now
    ? `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
    : null;
  const expansion = useMemo(() => {
    if (!now) return null;
    const { from, to } = defaultRange(now);
    return expandMemos(memos, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memos, dayKeyOfNow]);

  const groups = useMemo(() => {
    if (!expansion || !now) return [];
    return groupByDay(dropPast(expansion.instances, now), now);
  }, [expansion, now]);

  // 서버에서는 "지금"을 알 수 없다. 그리면 hydration 이 깨진다.
  if (!now || !expansion) {
    return <div className="h-16" aria-hidden />;
  }

  const { ruleless, dormant, truncated, omitted } = expansion;
  const shown = groups.slice(0, days);
  const restDays = groups.length - shown.length;
  const shownCount = shown.reduce((n, g) => n + g.items.length, 0);

  const nothingAtAll =
    memos.length === 0 && groups.length === 0 && ruleless.length === 0;

  if (nothingAtAll) {
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-3)">
        <CalendarDays className="mx-auto mb-1.5 h-4 w-4" />
        반복할 일정을 입력하세요
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 주기가 아직 없는 항목 — 인스턴스로는 나올 수 없으니 위에 고정해 둔다.
          이게 없으면 방금 입력한 항목이 사라진 것처럼 보인다. */}
      {ruleless.length > 0 && (
        <div>
          <SectionHead>
            주기 없음 · {ruleless.length} — 주기를 정하면 아래 일정에 나타납니다
          </SectionHead>
          <ul className="flex flex-col">
            {ruleless.map((m) => (
              <ScheduleItem
                key={m.id}
                memo={m}
                actions={actions}
                memoActions={memoActions}
                now={now}
              />
            ))}
          </ul>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-6 text-center text-sm break-keep text-(--color-fg-3)">
          앞으로 {DEFAULT_HORIZON_MONTHS}개월 안에 예정된 일정이 없습니다
        </div>
      ) : (
        <div>
          <SectionHead>
            앞으로 {DEFAULT_HORIZON_MONTHS}개월 · {shownCount}건 — 수정·삭제는 반복 규칙
            목록에서
          </SectionHead>
          <ul className="flex flex-col">
            {shown.map((g) => (
              <li key={g.key}>
                {/* z-0 이어야 한다 — 이보다 위로 올리면 행에서 열리는 편집기(z-30)가
                    머리글 아래로 깔린다 */}
                <div
                  className={cn(
                    "sticky top-0 z-0 -mx-1 mt-2 mb-0.5 flex items-center gap-1.5 bg-(--color-surface)/95 px-1 py-1 text-[12px] font-medium break-keep backdrop-blur-sm first:mt-0",
                    g.carried || g.label === "오늘"
                      ? "text-(--color-accent-strong)"
                      : "text-(--color-fg-2)",
                  )}
                >
                  <span>{g.label}</span>
                  <span className="font-mono text-(--color-fg-3) tabular-nums">
                    {g.day.getMonth() + 1}/{g.day.getDate()}
                  </span>
                </div>
                <ul className="flex flex-col">
                  {g.items.map((inst) => (
                    <InstanceRow
                      key={inst.key}
                      inst={inst}
                      now={now}
                      actions={actions}
                      memoActions={memoActions}
                      onShowRule={onShowRule}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          {restDays > 0 && (
            <button
              type="button"
              onClick={() => setDays((d) => d + DAYS_PER_PAGE)}
              className="mt-1.5 w-full rounded-lg border border-(--color-border-soft) py-1.5 text-[12px] text-(--color-fg-2) transition hover:bg-(--color-surface-hi)"
            >
              이후 {restDays}일 더 보기
            </button>
          )}
        </div>
      )}

      {/* 규칙은 있는데 이 창 안에 발생이 없는 것들. 접어 두되 숨기지는 않는다 —
          윤년 2/29 처럼 몇 년씩 안 돌아오는 규칙이 목록에서 완전히 증발한다. */}
      {dormant.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDormant((v) => !v)}
            className="flex w-full items-center gap-1 px-1 py-1 text-[12px] text-(--color-fg-3) transition hover:text-(--color-fg-2)"
          >
            {showDormant ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            예정 없음 · {dormant.length}
          </button>
          {showDormant && (
            <ul className="flex flex-col">
              {dormant.map((m) => (
                <ScheduleItem
                  key={m.id}
                  memo={m}
                  actions={actions}
                  memoActions={memoActions}
                  now={now}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {truncated && (
        <p className="rounded-lg bg-(--color-bg-2) px-2 py-1.5 text-[12px] break-keep text-(--color-fg-2)">
          너무 많아 {omitted}건을 잘랐습니다. 반복 규칙 목록에서 주기를 조정하세요.
        </p>
      )}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-0.5 text-[12px] break-keep text-(--color-fg-3)">
      {children}
    </p>
  );
}

/** 계산된 발생 한 줄 — 훅을 쓰지 않으므로 드래그도 드롭도 붙지 않는다. */
function InstanceRow({
  inst,
  now,
  actions,
  memoActions,
  onShowRule,
}: {
  inst: ScheduleInstance;
  now: Date;
  actions: ScheduleActions;
  memoActions: MemoActions;
  onShowRule?: (memo: MemoDTO) => void;
}) {
  return (
    <ScheduleRow
      memo={inst.memo}
      actions={actions}
      memoActions={memoActions}
      variant="instance"
      now={now}
      state={instanceState(inst, now)}
      onShowRule={onShowRule}
    />
  );
}

/** 훅을 쓰기 위한 얇은 래퍼 — 순서 변경 DnD 는 일반 메모와 같은 규약을 쓴다. */
function ChecklistItem({
  memo,
  kind,
  actions,
  memoActions,
}: {
  memo: MemoDTO;
  kind: NotebookKind;
  actions: ChecklistActions;
  memoActions: MemoActions;
}) {
  const { over, props, handleProps } = useItemDnd(memo, memoActions);
  return (
    <ChecklistRow
      memo={memo}
      kind={kind}
      actions={actions}
      memoActions={memoActions}
      handleProps={handleProps}
      dnd={{
        ...props,
        // 한 줄 항목에서는 클릭이 편집이므로 열기 동작을 뺀다
        onClick: undefined,
        className: undefined,
        style: over === "self" ? { boxShadow: "inset 0 2px 0 var(--color-accent)" } : undefined,
      }}
    />
  );
}

/** ScheduleRow 용 래퍼 — 규칙 뷰 전용 (인스턴스는 드래그하지 않는다). */
function ScheduleItem({
  memo,
  actions,
  memoActions,
  now,
  highlight,
}: {
  memo: MemoDTO;
  actions: ScheduleActions;
  memoActions: MemoActions;
  now: Date | null;
  highlight?: boolean;
}) {
  const { over, props, handleProps } = useItemDnd(memo, memoActions);
  return (
    <ScheduleRow
      memo={memo}
      actions={actions}
      memoActions={memoActions}
      variant="rule"
      now={now}
      highlight={highlight}
      handleProps={handleProps}
      dnd={{
        ...props,
        onClick: undefined,
        className: undefined,
        style:
          over === "self"
            ? { boxShadow: "inset 0 2px 0 var(--color-accent)" }
            : undefined,
      }}
    />
  );
}
