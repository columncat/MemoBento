/**
 * 반복 규칙을 실제 날짜 목록으로 펼치는 계층.
 *
 * recurrence.ts 는 MemoDTO 를 몰라야 한다 (types.ts 가 recurrence.ts 를
 * import 하므로 반대 방향은 순환이 된다). 규칙 산수는 그쪽, 메모 병합·정렬·
 * 상한은 여기.
 *
 * 이 파일의 어떤 함수도 new Date() / Date.now() 를 부르지 않는다 — now 는
 * 전부 인자로 받는다. 그래야 테스트에서 임의 시점을 찍을 수 있고, 서버와
 * 브라우저가 서로 다른 "지금"으로 갈라지지 않는다.
 */

import {
  addDays,
  describeNext,
  expandRange,
  instanceEndMs,
  instanceStartMs,
  startOfDay,
  toDayString,
  type Recurrence,
} from "./recurrence";
import type { MemoDTO, ViewMode } from "./types";

/** 지금 이 발생이 어느 상태인가. */
export type InstanceState = "live" | "upcoming" | "past";

export interface ScheduleInstance {
  memoId: string;
  memo: MemoDTO;
  rule: Recurrence;
  /** 규칙이 매치한 날. 26:00 항목도 그날(토요일) 그대로 둔다. */
  day: Date;
  /** toDayString(day) — 그룹 키이자 React key 의 일부. */
  dayKey: string;
  /** `${memoId}@${dayKey}` — 한 메모가 여러 날짜에 나오므로 id 만으론 부족하다. */
  key: string;
  /** 시각을 정하지 않았으면 null. */
  startsAt: number | null;
  endsAt: number;
  /** memos 배열에서의 위치 = 사용자가 DnD 로 정한 순서. */
  order: number;
}

export interface ExpansionResult {
  instances: ScheduleInstance[];
  /** 상한에 걸려 잘렸는가. */
  truncated: boolean;
  /** 잘려나간 개수. */
  omitted: number;
  /** 온전히 포함된 마지막 날. 절단이 없으면 startOfDay(to). */
  coveredTo: Date | null;
  /** 규칙은 있으나 이 창 안에 발생이 하나도 없는 메모. */
  dormant: MemoDTO[];
  /** 아직 주기를 정하지 않은 메모 — 인스턴스 목록에 못 나오므로 따로 준다. */
  ruleless: MemoDTO[];
}

export interface DayGroup {
  key: string;
  day: Date;
  label: string;
  /**
   * 날짜는 어제인데 아직 안 지난 그룹 — 24시를 넘는 시각 때문에 넘어온 것.
   * (토요일 26:00 을 일요일 새벽에 보는 경우)
   */
  carried: boolean;
  items: ScheduleInstance[];
}

/** 기본 표시 범위 — 앞으로 2개월. */
export const DEFAULT_HORIZON_MONTHS = 2;
/** 화면에 올리는 인스턴스 상한. 넘으면 날짜 경계에서 자른다. */
export const DEFAULT_MAX_TOTAL = 200;

export function addMonths(d: Date, n: number): Date {
  // 넘치는 값의 자동 롤오버(12/31 + 2개월 = 3/3)를 그대로 쓴다. 여기서는
  // 판정이 아니라 화면 범위의 끝점이라 하루 오차가 결과를 바꾸지 않는다.
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

/**
 * 지금 기준 표시 범위.
 *
 * from 이 어제인 것이 중요하다. 자정을 넘겨 아직 살아 있는 26시 항목을
 * 잡기 위해서다 — activeToday 가 하루 되돌아보는 것과 같은 이유다.
 * 이 -1 을 지우면 일요일 새벽에 토요일 26:00 일정이 조용히 사라진다.
 */
export function defaultRange(
  now: Date,
  months = DEFAULT_HORIZON_MONTHS,
): { from: Date; to: Date } {
  const today = startOfDay(now);
  return { from: addDays(today, -1), to: addMonths(today, months) };
}

/** 지금 이 발생이 어느 상태인가. */
export function instanceState(
  inst: Pick<ScheduleInstance, "startsAt" | "endsAt" | "day">,
  now: Date,
): InstanceState {
  const t = now.getTime();
  if (t >= inst.endsAt) return "past";
  const start = inst.startsAt ?? startOfDay(inst.day).getTime();
  return t >= start ? "live" : "upcoming";
}

/**
 * 메모 목록을 [from, to] 구간의 발생들로 펼친다.
 *
 * 정렬은 날짜 → 종일 먼저 → 시각 오름차순 → 사용자 순서 → id.
 * 시각은 **원값으로** 비교한다. 26:00 을 02:00 으로 환산하면 토요일 26시가
 * 토요일 09시보다 앞으로 튄다.
 */
export function expandMemos(
  memos: MemoDTO[],
  from: Date,
  to: Date,
  opts: { maxTotal?: number; maxPerRule?: number } = {},
): ExpansionResult {
  const maxTotal = opts.maxTotal ?? DEFAULT_MAX_TOTAL;
  const maxPerRule = opts.maxPerRule ?? 400;

  const all: ScheduleInstance[] = [];
  const dormant: MemoDTO[] = [];
  const ruleless: MemoDTO[] = [];

  memos.forEach((memo, order) => {
    const rule = memo.recurrence;
    if (!rule) {
      ruleless.push(memo);
      return;
    }
    const days = expandRange(rule, memo.createdAt, from, to, maxPerRule);
    if (days.length === 0) {
      dormant.push(memo);
      return;
    }
    for (const day of days) {
      const dayKey = toDayString(day);
      all.push({
        memoId: memo.id,
        memo,
        rule,
        day,
        dayKey,
        key: `${memo.id}@${dayKey}`,
        startsAt: instanceStartMs(rule, day),
        endsAt: instanceEndMs(rule, day),
        order,
      });
    }
  });

  all.sort((a, b) => {
    if (a.dayKey !== b.dayKey) return a.dayKey < b.dayKey ? -1 : 1;
    // 종일 항목이 먼저 (캘린더 관례)
    const at = a.rule.timeMinutes ?? -1;
    const bt = b.rule.timeMinutes ?? -1;
    if (at !== bt) return at - bt;
    if (a.order !== b.order) return a.order - b.order;
    return a.memoId < b.memoId ? -1 : a.memoId > b.memoId ? 1 : 0;
  });

  const lastDay = startOfDay(to);
  if (all.length <= maxTotal) {
    return {
      instances: all,
      truncated: false,
      omitted: 0,
      coveredTo: all.length > 0 ? lastDay : null,
      dormant,
      ruleless,
    };
  }

  // 상한을 넘으면 날짜 경계에서 자른다. 하루를 반만 보여주면 "그날은 이게
  // 전부"라는 거짓말이 된다.
  let cut = maxTotal;
  const boundaryKey = all[maxTotal].dayKey;
  while (cut > 0 && all[cut - 1].dayKey === boundaryKey) cut--;

  // 첫날 하나가 통째로 상한을 넘기면 자를 곳이 없다 — 그때는 그 하루를 살린다
  if (cut === 0) {
    while (cut < all.length && all[cut].dayKey === all[0].dayKey) cut++;
  }

  const kept = all.slice(0, cut);
  return {
    instances: kept,
    truncated: true,
    omitted: all.length - cut,
    coveredTo: kept.length > 0 ? startOfDay(kept[kept.length - 1].day) : null,
    dormant,
    ruleless,
  };
}

/** 지난 발생을 걷어낸다. */
export function dropPast(
  instances: ScheduleInstance[],
  now: Date,
): ScheduleInstance[] {
  return instances.filter((i) => instanceState(i, now) !== "past");
}

/** 날짜 한 줄 라벨 — 오늘/내일/모레/"토 (5일 뒤)"/"9/12". */
export function dayLabel(day: Date, now: Date): string {
  return describeNext(day, now);
}

/**
 * 날짜별로 묶는다. 입력은 이미 정렬되어 있어야 한다.
 *
 * 어제 날짜인데 아직 안 지난 그룹은 24시를 넘는 시각(26:00 등) 때문에 넘어온
 * 것이다. 라벨만 "어젯밤"으로 바꾸고 day 는 건드리지 않는다 — 오늘 그룹으로
 * 옮기면 날짜가 거짓이 되고, "1일 전"이라고 쓰면 아직 안 온 일정이 지난
 * 것처럼 보인다. "진행 중"도 쓰지 않는다: 일요일 01시에 보는 26:00 일정은
 * 아직 시작 전이다.
 */
export function groupByDay(
  instances: ScheduleInstance[],
  now: Date,
): DayGroup[] {
  const today = startOfDay(now).getTime();
  const groups: DayGroup[] = [];
  let cur: DayGroup | null = null;

  for (const inst of instances) {
    if (!cur || cur.key !== inst.dayKey) {
      cur = {
        key: inst.dayKey,
        day: inst.day,
        label: dayLabel(inst.day, now),
        carried: false,
        items: [],
      };
      groups.push(cur);
    }
    cur.items.push(inst);
  }

  for (const g of groups) {
    if (startOfDay(g.day).getTime() < today) {
      g.carried = true;
      g.label = "어젯밤";
    }
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────
//   뷰 어댑터
// ─────────────────────────────────────────────────────────────

/**
 * 반복 일정 메모함에서 viewMode 는 "무엇을 보여줄지"로 달리 읽는다.
 * 일정 관련 코드에서는 "list"/"grid" 리터럴을 직접 쓰지 않는다 — 나중에
 * 진짜 그리드 보기가 필요해지면 이 어댑터 한 곳만 고치면 된다.
 */
export type ScheduleView = "instances" | "rules";

export function scheduleViewOf(mode: ViewMode): ScheduleView {
  return mode === "grid" ? "rules" : "instances";
}

export const SCHEDULE_VIEW_MODE: Record<ScheduleView, ViewMode> = {
  instances: "list",
  rules: "grid",
};
