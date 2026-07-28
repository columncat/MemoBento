"use client";

import { CalendarDays, ChevronDown, ChevronRight, Inbox, Repeat } from "lucide-react";
import { useMemo, useState } from "react";

import {
  DEFAULT_HORIZON_MONTHS,
  defaultRange,
  dayLabel,
  dropPast,
  expandMemos,
  instanceState,
  type ScheduleInstance,
} from "@/lib/schedule-instances";
import type { MemoDTO, NotebookKind, ViewMode } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ChecklistRow, type ChecklistActions } from "./checklist-item";
import { MemoRow, MemoTile, useItemDnd, type MemoActions } from "./memo-item";
import { ScheduleRow, useNow, type ScheduleActions } from "./schedule-item";

/** 한 번에 펼쳐 보여주는 일정 수. 나머지는 버튼으로 더 펼친다. */
const ITEMS_PER_PAGE = 20;

export function MemoList({
  memos,
  viewMode,
  kind,
  actions,
  checklistActions,
  scheduleActions,
  emptyHint,
  onShowRule,
}: {
  memos: MemoDTO[];
  viewMode: ViewMode;
  kind: NotebookKind;
  actions: MemoActions;
  checklistActions: ChecklistActions;
  scheduleActions: ScheduleActions;
  emptyHint?: string;
  /** 인스턴스에서 규칙 편집 표로 이동. */
  onShowRule?: (memo: MemoDTO) => void;
}) {
  // 반복 일정은 비어 있어도 자체 안내가 필요하다 (규칙은 있는데 발생이 없는
  // 경우가 있어서, 공통 빈 상태로는 사용자가 데이터가 사라졌다고 읽는다).
  if (kind === "schedule") {
    return (
      <ScheduleSection
        memos={memos}
        actions={scheduleActions}
        memoActions={actions}
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
  actions,
  memoActions,
  onShowRule,
}: {
  memos: MemoDTO[];
  actions: ScheduleActions;
  memoActions: MemoActions;
  onShowRule?: (memo: MemoDTO) => void;
}) {
  // 목록에서 한 번만 계산해 모든 행에 내려준다
  const now = useNow(60_000);

  // 카드에는 계산된 일정만 둔다. 규칙 편집은 값이 열 개 가까이 되어 좁은
  // 카드 한 칸에 넣을 수 없으므로 넓은 표(ScheduleGridModal)로 뺐다.
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
  const [shownCount, setShownCount] = useState(ITEMS_PER_PAGE);
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

  const upcoming = useMemo(
    () => (expansion && now ? dropPast(expansion.instances, now) : []),
    [expansion, now],
  );

  // 서버에서는 "지금"을 알 수 없다. 그리면 hydration 이 깨진다.
  if (!now || !expansion) {
    return <div className="h-16" aria-hidden />;
  }

  const { ruleless, dormant, truncated, omitted } = expansion;
  const shown = upcoming.slice(0, shownCount);
  const rest = upcoming.length - shown.length;

  const nothingAtAll =
    memos.length === 0 && upcoming.length === 0 && ruleless.length === 0;

  if (nothingAtAll) {
    return (
      <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-8 text-center text-sm break-keep text-(--color-fg-3)">
        <CalendarDays className="mx-auto mb-1.5 h-4 w-4" />
        머리말의 표 버튼을 눌러 반복 일정을 추가하세요
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
          <ul className="flex flex-col gap-1">
            {ruleless.map((m) => (
              <ScheduleItem
                key={m.id}
                memo={m}
                memoActions={memoActions}
                now={now}
                onShowRule={onShowRule}
              />
            ))}
          </ul>
        </div>
      )}

      {upcoming.length === 0 ? (
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-6 text-center text-sm break-keep text-(--color-fg-3)">
          앞으로 {DEFAULT_HORIZON_MONTHS}개월 안에 예정된 일정이 없습니다
        </div>
      ) : (
        <div>
          {/* 날짜로 계층을 만들지 않고 일정 하나가 곧 한 항목이다.
              머리글이 없으므로 날짜는 각 행이 직접 달고 나온다. */}
          <ul className="flex flex-col gap-1">
            {shown.map((inst) => (
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

          {rest > 0 && (
            <button
              type="button"
              onClick={() => setShownCount((n) => n + ITEMS_PER_PAGE)}
              className="mt-1.5 w-full rounded-lg border border-(--color-border-soft) py-1.5 text-[13px] text-(--color-fg-2) transition hover:bg-(--color-surface-hi)"
            >
              {rest}건 더 보기
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
            aria-expanded={showDormant}
            aria-controls="schedule-dormant"
            className="flex w-full items-center gap-1 px-1 py-1 text-[12px] text-(--color-fg-3) transition hover:text-(--color-fg-2)"
          >
            {showDormant ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
            예정 없음 · {dormant.length}
          </button>
          {showDormant && (
            <ul id="schedule-dormant" className="flex flex-col gap-1">
              {dormant.map((m) => (
                <ScheduleItem
                  key={m.id}
                  memo={m}
                  memoActions={memoActions}
                  now={now}
                  onShowRule={onShowRule}
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
      memoActions={memoActions}
      variant="instance"
      now={now}
      day={inst.day}
      dayLabel={dayLabel(inst.day, now)}
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
  memoActions,
  now,
  onShowRule,
}: {
  memo: MemoDTO;
  memoActions: MemoActions;
  now: Date | null;
  onShowRule?: (memo: MemoDTO) => void;
}) {
  const { over, props, handleProps } = useItemDnd(memo, memoActions);
  return (
    <ScheduleRow
      memo={memo}
      memoActions={memoActions}
      variant="rule"
      now={now}
      onShowRule={onShowRule}
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
