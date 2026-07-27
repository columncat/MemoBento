/**
 * 반복 일정 규칙.
 *
 * 규칙은 memos.recurrence 에 JSON 한 덩어리로 저장한다 — 필드가 여럿이고
 * 앞으로도 늘어날 여지가 있어서 컬럼을 쪼개는 것보다 다루기 쉽다.
 *
 * 시각(timeMinutes)은 **참고용**이다. 지나도 그날치는 계속 보인다.
 * 24시를 넘는 값을 허용해서 "토요일 26시"(실제로는 일요일 새벽 2시) 같은
 * 생활 감각의 표기를 그대로 쓸 수 있다. 26:59 까지.
 */

export const FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
export type Freq = (typeof FREQS)[number];

/** 표시 가능한 최대 시각 — 26:59. */
export const MAX_TIME_MINUTES = 26 * 60 + 59;

export interface Recurrence {
  freq: Freq;
  /** n일/n주/n개월/n년 마다. 1 이상. */
  interval: number;
  /** freq=weekly — 0(일)~6(토). 비어 있으면 시작일의 요일을 쓴다. */
  weekdays?: number[];
  /** freq=monthly|yearly — 1~31. 없으면 시작일의 일자. */
  day?: number;
  /** freq=yearly — 1~12. 없으면 시작일의 월. */
  month?: number;
  /** 참고 시각(분). 0 ~ 1619(26:59). 없으면 시각 없음. */
  timeMinutes?: number | null;
  /**
   * 주기의 기준일 YYYY-MM-DD. 없으면 메모를 만든 날.
   *
   * 요일·일자를 고르지 않은 규칙("매주" 처럼)은 이 날의 요일/일자를 쓰고,
   * interval > 1 이면 이 날부터 세어 위상이 정해진다. from(표시 기간)과
   * 반드시 분리해야 한다 — 예전에는 from 이 이 역할을 겸해서, 표시 기간만
   * 좁혀도 발생 요일이 통째로 옮겨갔다.
   */
  anchor?: string | null;
  /** 표시 시작일 YYYY-MM-DD. 없으면 제한 없음. */
  from?: string | null;
  /** 표시 종료일 YYYY-MM-DD (그날 포함). 없으면 제한 없음. */
  to?: string | null;
}

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// ─────────────────────────────────────────────────────────────
//   날짜 도우미 — 전부 "현지 시간의 날짜"만 다룬다
// ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD → 그날 0시 Date. 잘못된 값이면 null. */
export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  // Date 는 넘치는 값을 다음 달로 굴려버린다 (13월 99일도 "유효"해진다).
  // 되돌려 맞춰 봐야 진짜 그 날짜인지 알 수 있다.
  if (
    d.getFullYear() !== y ||
    d.getMonth() !== mo - 1 ||
    d.getDate() !== da
  ) {
    return null;
  }
  return d;
}

export function toDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const DAY_MS = 86400000;

/** 날짜 차이(일). 시각은 무시. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** n일 뒤(음수면 앞). setDate 기반이라 DST 전환일에도 날짜가 밀리지 않는다. */
export function addDays(d: Date, n: number): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}


// ─────────────────────────────────────────────────────────────
//   검증 / 정규화
// ─────────────────────────────────────────────────────────────

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};

/** 저장/전송된 값을 안전한 규칙으로 정규화한다. 못 쓰면 null. */
export function normalizeRecurrence(input: unknown): Recurrence | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Partial<Recurrence>;
  if (!r.freq || !(FREQS as readonly string[]).includes(r.freq)) return null;

  const out: Recurrence = {
    freq: r.freq,
    interval: clampInt(r.interval, 1, 999, 1),
  };

  if (r.freq === "weekly" && Array.isArray(r.weekdays)) {
    const set = [...new Set(r.weekdays.map((w) => clampInt(w, 0, 6, 0)))].sort();
    if (set.length > 0) out.weekdays = set;
  }
  if (r.freq === "monthly" || r.freq === "yearly") {
    if (r.day != null) out.day = clampInt(r.day, 1, 31, 1);
  }
  if (r.freq === "yearly" && r.month != null) {
    out.month = clampInt(r.month, 1, 12, 1);
  }
  if (r.timeMinutes != null) {
    out.timeMinutes = clampInt(r.timeMinutes, 0, MAX_TIME_MINUTES, 0);
  }
  if (parseDay(r.anchor)) out.anchor = r.anchor;
  if (parseDay(r.from)) out.from = r.from;
  if (parseDay(r.to)) out.to = r.to;

  return out;
}

/** 26:00 같은 표기를 분으로. "26:30" → 1590. */
export function parseTimeInput(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  const total = h * 60 + min;
  if (total > MAX_TIME_MINUTES) return null;
  return total;
}

/** 분 → "26:30". */
export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────
//   발생일 계산
// ─────────────────────────────────────────────────────────────

/**
 * 규칙의 기준일.
 *
 * from(표시 기간)은 여기에 관여하지 않는다. 예전에는 겸했는데, 그러면
 * "9월부터 보이게" 처럼 범위만 좁혔을 때 매주 화요일이던 일정이 매주
 * 토요일로 바뀌었다. 화면 어디에도 단서가 없어 버그로만 보인다.
 */
function anchorOf(rule: Recurrence, createdAt: number): Date {
  return parseDay(rule.anchor) ?? startOfDay(new Date(createdAt));
}

/**
 * anchor 가 없던 시절의 규칙을 지금 의미로 옮긴다.
 *
 * 그때는 from 이 기준일을 겸했으므로, from 을 anchor 로 굳혀야 이미 쓰던
 * 일정의 발생일이 그대로 유지된다. 읽을 때마다 적용되고, 다음 저장 때
 * 명시적으로 남는다.
 */
export function withLegacyAnchor(rule: Recurrence): Recurrence {
  if (rule.anchor || !rule.from) return rule;
  return { ...rule, anchor: rule.from };
}

/** 이 날짜가 표시 기간 안인가. */
export function withinWindow(rule: Recurrence, day: Date): boolean {
  const from = parseDay(rule.from);
  const to = parseDay(rule.to);
  const d = startOfDay(day).getTime();
  if (from && d < from.getTime()) return false;
  if (to && d > to.getTime()) return false;
  return true;
}

/** 이 날짜가 주기에 맞는가 (표시 기간은 보지 않는다). */
export function matchesDay(
  rule: Recurrence,
  createdAt: number,
  day: Date,
): boolean {
  const anchor = anchorOf(rule, createdAt);
  const d = startOfDay(day);
  if (d.getTime() < anchor.getTime()) return false;
  const n = Math.max(1, rule.interval);

  switch (rule.freq) {
    case "daily":
      return daysBetween(anchor, d) % n === 0;

    case "weekly": {
      const days = rule.weekdays?.length ? rule.weekdays : [anchor.getDay()];
      if (!days.includes(d.getDay())) return false;
      // n주마다 — 기준 주(일요일 시작)로부터 몇 주 떨어졌는지
      const anchorWeek = addDays(anchor, -anchor.getDay());
      const dWeek = addDays(d, -d.getDay());
      return (daysBetween(anchorWeek, dWeek) / 7) % n === 0;
    }

    case "monthly": {
      // 없는 날짜는 그 달을 건너뛴다 — 31일 규칙은 2·4·6·9·11월에 발생하지 않는다.
      // 말일로 당기지 않는 쪽이 RFC 5545 BYMONTHDAY 및 구글/애플 캘린더와 같다.
      const target = rule.day ?? anchor.getDate();
      if (d.getDate() !== target) return false;
      const months =
        (d.getFullYear() - anchor.getFullYear()) * 12 +
        (d.getMonth() - anchor.getMonth());
      return months >= 0 && months % n === 0;
    }

    case "yearly": {
      const targetMonth = (rule.month ?? anchor.getMonth() + 1) - 1;
      const targetDay = rule.day ?? anchor.getDate();
      if (d.getMonth() !== targetMonth || d.getDate() !== targetDay) return false;
      const years = d.getFullYear() - anchor.getFullYear();
      return years >= 0 && years % n === 0;
    }
  }
}

/**
 * `from` 이후로 가장 가까운 발생일. 없으면 null.
 * 표시 기간(to)을 넘어가면 더 찾지 않는다.
 */
export function nextOccurrence(
  rule: Recurrence,
  createdAt: number,
  fromDay: Date = new Date(),
): Date | null {
  const to = parseDay(rule.to);
  const start = startOfDay(fromDay);

  if (rule.freq === "yearly") {
    // 하루씩 훑으면 2/29 규칙(4년에 한 번)에서 상한에 먼저 걸려 "예정 없음"이
    // 되고, interval 이 크면 수만 번을 헛돈다. 연 단위로 후보만 본다.
    const anchor = anchorOf(rule, createdAt);
    const month = (rule.month ?? anchor.getMonth() + 1) - 1;
    const day = rule.day ?? anchor.getDate();
    const n = Math.max(1, rule.interval);
    // 윤년 규칙은 최대 4년 간격 — interval 배수로 8회면 충분히 넘어선다
    for (let k = 0; k <= 8; k++) {
      const year = anchor.getFullYear() + k * n;
      const d = new Date(year, month, day);
      // 없는 날짜(2/29 평년)는 다음 달로 굴러가므로 걸러낸다
      if (d.getMonth() !== month || d.getDate() !== day) continue;
      if (d.getTime() < start.getTime()) continue;
      if (to && d.getTime() > to.getTime()) return null;
      if (withinWindow(rule, d) && matchesDay(rule, createdAt, d)) return d;
    }
    return null;
  }

  // 하루씩 훑되 상한을 둔다. 일/주/월 규칙은 2년 안에 반드시 잡힌다.
  for (let i = 0; i < 800; i++) {
    const d = addDays(start, i);
    if (to && d.getTime() > to.getTime()) return null;
    if (withinWindow(rule, d) && matchesDay(rule, createdAt, d)) return d;
  }
  return null;
}

/**
 * 이 발생일의 시작 시점(ms). 시각을 정하지 않았으면 null (종일).
 *
 * 분을 ms 로 더하지 않고 현지 날짜 생성자에 넘긴다. 서머타임이 있는 지역에서
 * 전환일 하루는 23 또는 25시간이라, 고정 ms 로 더하면 화면에 적힌 시각과 한
 * 시간 어긋난다. 분이 1440 을 넘어도(26:00) 생성자가 다음날로 정규화해 준다.
 */
export function instanceStartMs(rule: Recurrence, day: Date): number | null {
  if (rule.timeMinutes == null) return null;
  return atMinutes(day, rule.timeMinutes);
}

function atMinutes(day: Date, minutes: number): number {
  const b = startOfDay(day);
  return new Date(b.getFullYear(), b.getMonth(), b.getDate(), 0, minutes).getTime();
}

/**
 * 이 발생일이 "지난 것"이 되는 시점(ms).
 *
 * 시각은 참고용이라 지나도 그날 안에는 남고, 24시를 넘는 시각이면 실제
 * 시점(다음날 새벽)까지 늘려 준다 — 토요일 26:00 은 일요일 02:01 까지.
 */
export function instanceEndMs(rule: Recurrence, day: Date): number {
  // 다음날 자정과 "시각 + 1분" 중 늦은 쪽. 둘 다 현지 시간으로 계산해야
  // 서머타임 전환일에 하루가 23/25시간이어도 어긋나지 않는다.
  const nextMidnight = addDays(day, 1).getTime();
  const afterTime = atMinutes(day, rule.timeMinutes ?? 0) + 60000;
  return Math.max(nextMidnight, afterTime);
}

/**
 * 지금 "오늘 것"으로 보여줄 발생일. 없으면 null.
 *
 * 시각은 참고용이라 지나도 그날 안에는 계속 보인다. 24시를 넘는 시각이면
 * 실제 시점(다음날 새벽)까지 늘려 준다 — 토요일 26시는 일요일 02:00 까지 남는다.
 */
export function activeToday(
  rule: Recurrence,
  createdAt: number,
  now: Date = new Date(),
): Date | null {
  for (const back of [0, 1]) {
    const day = addDays(now, -back);
    if (!withinWindow(rule, day) || !matchesDay(rule, createdAt, day)) continue;
    // 인스턴스 목록과 같은 공식을 써야 한 화면 안에서 두 값이 갈라지지 않는다
    if (now.getTime() < instanceEndMs(rule, day)) return day;
  }
  return null;
}

/**
 * [from, to] 닫힌 구간(양 끝 포함) 안의 모든 발생일. 오름차순.
 *
 * 하루씩 훑으며 matchesDay 에게 물어본다 — 산술 점프로 다시 구현하면
 * monthly 31일·weekly 주 정렬·yearly 윤년 판정이 matchesDay 와 갈라져
 * "목록엔 있는데 행에는 오늘 강조가 없다" 같은 버그가 난다.
 *
 * now 를 읽지 않는다(순수). 테스트에서 임의 시점을 찍기 위해서다.
 */
export function expandRange(
  rule: Recurrence,
  createdAt: number,
  from: Date,
  to: Date,
  maxPerRule = 400,
): Date[] {
  // 스캔 구간을 규칙의 창과 미리 교집합해 둔다. 루프 안에서 withinWindow 를
  // 부르면 매 반복마다 parseDay 를 두 번 돌리게 되고, matchesDay 가 어차피
  // 떨굴 anchor 이전 구간도 헛돈다.
  const ruleFrom = parseDay(rule.from);
  const ruleTo = parseDay(rule.to);
  const anchor = anchorOf(rule, createdAt);

  let scanStart = startOfDay(from);
  if (scanStart.getTime() < anchor.getTime()) scanStart = anchor;
  if (ruleFrom && scanStart.getTime() < ruleFrom.getTime()) scanStart = ruleFrom;

  let scanEnd = startOfDay(to);
  if (ruleTo && scanEnd.getTime() > ruleTo.getTime()) scanEnd = ruleTo;

  if (scanEnd.getTime() < scanStart.getTime()) return [];

  const out: Date[] = [];
  const span = daysBetween(scanStart, scanEnd);
  for (let i = 0; i <= span && out.length < maxPerRule; i++) {
    const d = addDays(scanStart, i);
    if (matchesDay(rule, createdAt, d)) out.push(d);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//   사람이 읽는 요약
// ─────────────────────────────────────────────────────────────

export function describeRecurrence(rule: Recurrence): string {
  const n = Math.max(1, rule.interval);
  switch (rule.freq) {
    case "daily":
      return n === 1 ? "매일" : `${n}일마다`;
    case "weekly": {
      const days = rule.weekdays?.length
        ? rule.weekdays.map((w) => WEEKDAY_LABELS[w]).join("·")
        : null;
      const every = n === 1 ? "매주" : `${n}주마다`;
      return days ? `${every} ${days}` : every;
    }
    case "monthly": {
      const every = n === 1 ? "매월" : `${n}개월마다`;
      return rule.day ? `${every} ${rule.day}일` : every;
    }
    case "yearly": {
      const every = n === 1 ? "매년" : `${n}년마다`;
      if (rule.month && rule.day) return `${every} ${rule.month}/${rule.day}`;
      return every;
    }
  }
}

/** 표시 기간 요약. 제한이 없으면 빈 문자열. */
export function describeWindow(rule: Recurrence): string {
  const f = parseDay(rule.from);
  const t = parseDay(rule.to);
  const short = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  if (f && t) return `${short(f)}–${short(t)}`;
  if (f) return `${short(f)}부터`;
  if (t) return `${short(t)}까지`;
  return "";
}

/** now 로부터 day 까지 며칠. 과거면 음수. */
export function daysUntil(day: Date, now: Date): number {
  return daysBetween(now, day);
}

/** 다음 발생일을 짧게 — 오늘/내일/모레/n일 뒤/날짜. */
export function describeNext(day: Date, now: Date = new Date()): string {
  const diff = daysBetween(now, day);
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === 2) return "모레";
  if (diff < 0) return `${-diff}일 전`;
  if (diff <= 7) return `${WEEKDAY_LABELS[day.getDay()]} (${diff}일 뒤)`;
  return `${day.getMonth() + 1}/${day.getDate()}`;
}
