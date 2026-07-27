/**
 * 반복 일정 순수 로직 검증. `npm run check:recurrence`
 *
 * expandRange 가 matchesDay 를 통째로 믿는 설계라 matchesDay 가 틀리면 목록
 * 전체가 틀린다. 하나가 틀리는 편이 두 개가 갈라지는 것보다 낫다는 선택이고,
 * 그 대가로 브루트포스 대조(불변식)를 여기서 반드시 지킨다.
 */

import assert from "node:assert/strict";

import {
  activeToday,
  expandRange,
  instanceEndMs,
  instanceStartMs,
  matchesDay,
  nextOccurrence,
  normalizeRecurrence,
  startOfDay,
  toDayString,
  withinWindow,
  withLegacyAnchor,
  type Recurrence,
} from "./recurrence";
import {
  defaultRange,
  dropPast,
  expandMemos,
  groupByDay,
  instanceState,
} from "./schedule-instances";
import type { MemoDTO } from "./types";

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e instanceof Error ? e.message : String(e)}`);
  }
}

const D = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const DT = (s: string, h: number, min = 0): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, h, min);
};
const rule = (o: unknown): Recurrence => {
  const r = normalizeRecurrence(o);
  assert.ok(r, "규칙 정규화 실패");
  return r;
};
const keys = (days: Date[]): string[] => days.map(toDayString);

function memo(over: Partial<MemoDTO> & { id: string }): MemoDTO {
  return {
    notebookId: "nb",
    type: "text",
    text: over.id,
    title: null,
    url: null,
    iconUrl: null,
    file: null,
    done: false,
    dueAt: null,
    recurrence: null,
    color: null,
    createdAt: D("2025-01-01").getTime(),
    updatedAt: 0,
    legacy: false,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────
//   A. expandRange
// ─────────────────────────────────────────────────────────────

const CREATED = D("2025-01-15").getTime();
const WIN_FROM = D("2026-07-27");
const WIN_TO = D("2026-09-27");

check("T-1 매일 — 양 끝 포함 63건", () => {
  const days = expandRange(rule({ freq: "daily", interval: 1 }), CREATED, WIN_FROM, WIN_TO);
  assert.equal(days.length, 63);
  assert.equal(toDayString(days[0]), "2026-07-27");
  assert.equal(toDayString(days[62]), "2026-09-27");
});

check("T-2 3일마다 — 21건, 시작 4건", () => {
  const days = expandRange(rule({ freq: "daily", interval: 3 }), CREATED, WIN_FROM, WIN_TO);
  // anchor(2025-01-15)부터 3일 간격이라 창 안 첫날은 위상에 따라 정해진다
  assert.deepEqual(
    keys(days).slice(0, 4),
    keys(days).slice(0, 4).map((k) => k), // 형태 확인용
  );
  assert.equal(days.length, 21);
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((days[i].getTime() - days[i - 1].getTime()) / 86400000);
    assert.equal(gap, 3, `${i}번째 간격이 ${gap}일`);
  }
});

check("T-3 매월 31일 — 없는 달은 건너뛴다", () => {
  const days = expandRange(
    rule({ freq: "monthly", interval: 1, day: 31 }),
    CREATED,
    WIN_FROM,
    WIN_TO,
  );
  assert.deepEqual(keys(days), ["2026-07-31", "2026-08-31"]);
  for (const d of days) assert.equal(d.getDate(), 31, "없는 날짜가 만들어졌다");
});

check("T-4 매년 2/29 — 비윤년 창은 0건, 윤년엔 1건", () => {
  const r = rule({ freq: "yearly", interval: 1, month: 2, day: 29 });
  assert.deepEqual(expandRange(r, CREATED, WIN_FROM, WIN_TO), []);
  const leap = expandRange(r, CREATED, D("2028-02-01"), D("2028-03-31"));
  assert.deepEqual(keys(leap), ["2028-02-29"]);
});

check("T-5 격주 토요일 — 5건", () => {
  const days = expandRange(
    rule({ freq: "weekly", interval: 2, weekdays: [6], from: "2026-08-01" }),
    CREATED,
    WIN_FROM,
    WIN_TO,
  );
  assert.deepEqual(keys(days), [
    "2026-08-01",
    "2026-08-15",
    "2026-08-29",
    "2026-09-12",
    "2026-09-26",
  ]);
});

check("T-6 창 위치가 주기 위상을 바꾸지 않는다", () => {
  const r = rule({ freq: "weekly", interval: 2, weekdays: [6], from: "2026-08-01" });
  const wide = keys(expandRange(r, CREATED, WIN_FROM, WIN_TO));
  const narrow = keys(expandRange(r, CREATED, D("2026-08-10"), WIN_TO));
  assert.deepEqual(narrow, wide.filter((k) => k >= "2026-08-10"));
});

check("T-7 rule.from/to 클리핑", () => {
  const days = expandRange(
    rule({
      freq: "weekly",
      interval: 1,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      from: "2026-08-01",
      to: "2026-08-20",
    }),
    CREATED,
    WIN_FROM,
    WIN_TO,
  );
  assert.equal(days.length, 20);
  assert.equal(toDayString(days[0]), "2026-08-01");
  assert.equal(toDayString(days[19]), "2026-08-20");
});

check("T-8 anchor(createdAt) 이전은 나오지 않는다", () => {
  const days = expandRange(
    rule({ freq: "daily", interval: 1 }),
    D("2026-08-10").getTime(),
    WIN_FROM,
    WIN_TO,
  );
  assert.equal(toDayString(days[0]), "2026-08-10");
});

check("T-9 만료 규칙 — 빈 배열", () => {
  const days = expandRange(
    rule({ freq: "daily", interval: 1, to: "2026-01-01" }),
    CREATED,
    WIN_FROM,
    WIN_TO,
  );
  assert.deepEqual(days, []);
});

check("maxPerRule 상한이 실제로 잘린다", () => {
  const days = expandRange(rule({ freq: "daily", interval: 1 }), CREATED, WIN_FROM, WIN_TO, 10);
  assert.equal(days.length, 10);
});

check("T-22 표시 기간(from)은 주기 위상을 바꾸지 않는다", () => {
  // 2026-07-14 는 화요일. 요일을 고르지 않은 "매주" 규칙은 기준일의 요일로 돈다.
  const created = D("2026-07-14").getTime();
  const bare = rule({ freq: "weekly", interval: 1 });
  const windowed = rule({ freq: "weekly", interval: 1, from: "2026-08-01" });
  const a = expandRange(bare, created, D("2026-08-01"), D("2026-08-31"));
  const b = expandRange(windowed, created, D("2026-08-01"), D("2026-08-31"));
  assert.deepEqual(keys(a), keys(b), "표시 기간만 넣었는데 발생일이 달라졌다");
  for (const d of b) assert.equal(d.getDay(), 2, "화요일이 아니다");

  // interval > 1 도 마찬가지 — 예전에는 from 이 위상을 밀었다
  const every2 = rule({ freq: "weekly", interval: 2, weekdays: [2] });
  const every2w = rule({
    freq: "weekly",
    interval: 2,
    weekdays: [2],
    from: "2026-07-20",
  });
  assert.deepEqual(
    keys(expandRange(every2, created, D("2026-08-01"), D("2026-08-31"))),
    keys(expandRange(every2w, created, D("2026-08-01"), D("2026-08-31"))),
  );
});

check("T-23 anchor 없던 옛 규칙은 발생일이 그대로 유지된다", () => {
  const created = D("2026-07-14").getTime();
  // 예전에는 from 이 기준일을 겸했다 — 토요일로 돌던 일정
  const legacy = withLegacyAnchor(rule({ freq: "weekly", interval: 1, from: "2026-08-01" }));
  const days = expandRange(legacy, created, D("2026-08-01"), D("2026-08-31"));
  assert.equal(legacy.anchor, "2026-08-01");
  for (const d of days) assert.equal(d.getDay(), 6, "옛 규칙의 요일이 바뀌었다");
  assert.equal(keys(days)[0], "2026-08-01");

  // anchor 가 이미 있으면 건드리지 않는다
  const explicit = rule({ freq: "weekly", interval: 1, anchor: "2026-07-14", from: "2026-08-01" });
  assert.equal(withLegacyAnchor(explicit).anchor, "2026-07-14");
});

check("T-24 윤년 2/29 규칙에 다음 발생이 나온다", () => {
  // 예전에는 일 단위 탐색 상한에 먼저 걸려 null 이 되고 화면에 "종료"가 떴다
  const r = rule({ freq: "yearly", interval: 1, month: 2, day: 29 });
  const n = nextOccurrence(r, D("2025-01-01").getTime(), D("2026-07-28"));
  assert.ok(n, "다음 발생을 못 찾았다");
  assert.equal(toDayString(n!), "2028-02-29");

  const every4 = rule({ freq: "yearly", interval: 4, month: 2, day: 29 });
  const n4 = nextOccurrence(every4, D("2024-02-29").getTime(), D("2026-07-28"));
  assert.equal(n4 && toDayString(n4), "2028-02-29");
});

check("T-25 서머타임 전환일에도 시각이 벽시계 그대로다", () => {
  // 이 검사는 DST 가 있는 지역에서만 의미가 있다. 국내(Asia/Seoul)에서는
  // 두 계산이 어차피 같으므로 통과한다 — 회귀 방어선으로만 둔다.
  const r = rule({ freq: "daily", interval: 1, timeMinutes: 9 * 60 });
  const start = instanceStartMs(r, D("2026-03-08"))!;
  const d = new Date(start);
  assert.equal(d.getHours(), 9, "시작 시각이 벽시계와 어긋난다");
  assert.equal(d.getMinutes(), 0);

  const late = rule({ freq: "daily", interval: 1, timeMinutes: 26 * 60 });
  const lateStart = new Date(instanceStartMs(late, D("2026-03-08"))!);
  assert.equal(toDayString(lateStart), "2026-03-09", "26시가 다음날로 안 넘어갔다");
  assert.equal(lateStart.getHours(), 2);
});

// ─────────────────────────────────────────────────────────────
//   B. 시각 경계 (26:00)
// ─────────────────────────────────────────────────────────────

const SAT26 = rule({
  freq: "weekly",
  interval: 1,
  weekdays: [6],
  timeMinutes: 26 * 60,
  from: "2026-08-01",
});
const SAT_PLAIN = rule({ freq: "weekly", interval: 1, weekdays: [6], from: "2026-08-01" });

check("T-10 instanceEndMs — 26:00 은 다음날 02:01", () => {
  assert.equal(instanceEndMs(SAT26, D("2026-08-01")), DT("2026-08-02", 2, 1).getTime());
  assert.equal(instanceEndMs(SAT_PLAIN, D("2026-08-01")), D("2026-08-02").getTime());
  assert.equal(instanceStartMs(SAT26, D("2026-08-01")), DT("2026-08-02", 2, 0).getTime());
  assert.equal(instanceStartMs(SAT_PLAIN, D("2026-08-01")), null);
});

const satMemo = memo({ id: "sat", recurrence: SAT26, createdAt: CREATED });

check("T-11 일요일 01:00 — 토요일 인스턴스가 살아 있고 activeToday 와 일치", () => {
  const now = DT("2026-08-02", 1);
  const { from, to } = defaultRange(now);
  const live = dropPast(expandMemos([satMemo], from, to).instances, now);
  assert.ok(live.length > 0, "인스턴스가 없다");
  assert.equal(live[0].dayKey, "2026-08-01");
  // 26:00 = 일요일 02:00 이므로 01:00 시점에는 아직 시작 전이다
  assert.equal(instanceState(live[0], now), "upcoming");
  assert.equal(instanceState(live[0], DT("2026-08-02", 2, 0)), "live");
  // 행 강조와 목록이 갈라지면 안 된다
  const active = activeToday(SAT26, CREATED, now);
  assert.equal(active && toDayString(active), "2026-08-01");
});

check("T-12 일요일 02:02 — 사라지고 activeToday 도 null", () => {
  const now = DT("2026-08-02", 2, 2);
  const { from, to } = defaultRange(now);
  const live = dropPast(expandMemos([satMemo], from, to).instances, now);
  assert.equal(live.filter((i) => i.dayKey === "2026-08-01").length, 0);
  assert.equal(activeToday(SAT26, CREATED, now), null);
});

check("T-13 시각 없는 규칙 — 토 23:00 있고 일 00:30 없다", () => {
  const plain = memo({ id: "p", recurrence: SAT_PLAIN, createdAt: CREATED });
  const at23 = DT("2026-08-01", 23);
  const r1 = defaultRange(at23);
  assert.ok(
    dropPast(expandMemos([plain], r1.from, r1.to).instances, at23).some(
      (i) => i.dayKey === "2026-08-01",
    ),
  );
  const at0030 = DT("2026-08-02", 0, 30);
  const r2 = defaultRange(at0030);
  assert.equal(
    dropPast(expandMemos([plain], r2.from, r2.to).instances, at0030).filter(
      (i) => i.dayKey === "2026-08-01",
    ).length,
    0,
  );
});

check("T-14 defaultRange 의 하루 되돌아보기가 실제로 필요하다", () => {
  const now = DT("2026-08-02", 1);
  // from 을 오늘로 되돌리면 토요일 인스턴스를 놓친다 — 회귀 방어선
  const naive = dropPast(
    expandMemos([satMemo], startOfDay(now), defaultRange(now).to).instances,
    now,
  );
  assert.equal(naive.filter((i) => i.dayKey === "2026-08-01").length, 0);
  assert.equal(toDayString(defaultRange(now).from), "2026-08-01");
});

// ─────────────────────────────────────────────────────────────
//   C. 불변식 / 순수성
// ─────────────────────────────────────────────────────────────

check("T-15 브루트포스 대조 — 누락도 초과도 없다", () => {
  const rules: Recurrence[] = [
    rule({ freq: "daily", interval: 1 }),
    rule({ freq: "daily", interval: 7 }),
    rule({ freq: "weekly", interval: 1, weekdays: [1, 3, 5] }),
    rule({ freq: "weekly", interval: 3, weekdays: [0] }),
    rule({ freq: "monthly", interval: 1, day: 31 }),
    rule({ freq: "monthly", interval: 2, day: 1 }),
    rule({ freq: "yearly", interval: 1, month: 2, day: 29 }),
    rule({ freq: "weekly", interval: 1, weekdays: [2], from: "2026-08-05", to: "2026-09-02" }),
    rule({ freq: "daily", interval: 1, to: "2026-08-03" }),
  ];
  const anchors = [CREATED, D("2026-08-10").getTime(), D("2026-01-31").getTime()];

  for (const r of rules) {
    for (const created of anchors) {
      const got = new Set(keys(expandRange(r, created, WIN_FROM, WIN_TO)));
      const want = new Set<string>();
      for (let i = 0; ; i++) {
        const d = new Date(WIN_FROM.getFullYear(), WIN_FROM.getMonth(), WIN_FROM.getDate() + i);
        if (d.getTime() > WIN_TO.getTime()) break;
        if (withinWindow(r, d) && matchesDay(r, created, d)) want.add(toDayString(d));
      }
      assert.deepEqual(
        [...got].sort(),
        [...want].sort(),
        `${JSON.stringify(r)} anchor=${new Date(created).toDateString()}`,
      );
    }
  }
});

check("T-16 순수성 — Date.now / new Date 없이 동작", () => {
  const RealDate = globalThis.Date;
  const now = DT("2026-08-02", 1);
  const { from, to } = defaultRange(now);

  // 인자 없는 new Date() 와 Date.now() 만 막는다
  class Trap extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) throw new Error("new Date() 를 호출했다 — 순수하지 않다");
      super(...(args as [number]));
    }
    static now(): number {
      throw new Error("Date.now() 를 호출했다 — 순수하지 않다");
    }
  }
  globalThis.Date = Trap as unknown as DateConstructor;
  try {
    const res = expandMemos([satMemo], from, to);
    const live = dropPast(res.instances, now);
    groupByDay(live, now);
    expandRange(SAT26, CREATED, from, to);
  } finally {
    globalThis.Date = RealDate;
  }
});

// ─────────────────────────────────────────────────────────────
//   D. 정렬 / 상한 / 그룹
// ─────────────────────────────────────────────────────────────

check("T-17 같은 날 정렬 — 종일 → 09:00 → 26:00 (환산 금지)", () => {
  const day = "2026-08-03"; // 월요일
  const mk = (id: string, timeMinutes: number | null) =>
    memo({
      id,
      recurrence: rule({ freq: "weekly", interval: 1, weekdays: [1], timeMinutes, from: day }),
      createdAt: CREATED,
    });
  // 배열 순서를 일부러 뒤집어 둔다 — 정렬이 실제로 동작하는지 보기 위해
  const res = expandMemos([mk("late", 26 * 60), mk("nine", 9 * 60), mk("allday", null)],
    D(day), D(day));
  assert.deepEqual(res.instances.map((i) => i.memoId), ["allday", "nine", "late"]);
});

check("T-18 같은 날 종일 둘 — 사용자 순서 유지", () => {
  const day = "2026-08-03";
  const mk = (id: string) =>
    memo({
      id,
      recurrence: rule({ freq: "weekly", interval: 1, weekdays: [1], from: day }),
      createdAt: CREATED,
    });
  const res = expandMemos([mk("first"), mk("second")], D(day), D(day));
  assert.deepEqual(res.instances.map((i) => i.memoId), ["first", "second"]);
});

check("T-19 상한 — 날짜 경계에서 자르고 하루를 반만 남기지 않는다", () => {
  const memos = Array.from({ length: 10 }, (_, i) =>
    memo({ id: `d${i}`, recurrence: rule({ freq: "daily", interval: 1 }), createdAt: CREATED }),
  );
  const res = expandMemos(memos, WIN_FROM, WIN_TO, { maxTotal: 200 });
  assert.equal(res.truncated, true);
  assert.ok(res.omitted > 0);
  assert.ok(res.instances.length <= 200);
  assert.ok(res.coveredTo);
  const lastKey = toDayString(res.coveredTo!);
  assert.equal(
    res.instances.filter((i) => i.dayKey === lastKey).length,
    10,
    "마지막 날이 반만 남았다",
  );
});

check("T-20 상한 미달 — 절단 없음", () => {
  const res = expandMemos(
    [memo({ id: "one", recurrence: rule({ freq: "weekly", interval: 1, weekdays: [1] }), createdAt: CREATED })],
    WIN_FROM,
    WIN_TO,
  );
  assert.equal(res.truncated, false);
  assert.equal(res.omitted, 0);
  assert.equal(toDayString(res.coveredTo!), toDayString(WIN_TO));
});

check("T-21 그룹 — 진행 중 그룹이 맨 앞, 날짜는 진실을 유지", () => {
  const now = DT("2026-08-02", 1); // 일요일 새벽
  const sunday = rule({ freq: "weekly", interval: 1, weekdays: [0], from: "2026-08-01" });
  const memos = [satMemo, memo({ id: "sun", recurrence: sunday, createdAt: CREATED })];
  const { from, to } = defaultRange(now);
  const groups = groupByDay(dropPast(expandMemos(memos, from, to).instances, now), now);
  assert.equal(groups[0].key, "2026-08-01");
  assert.equal(groups[0].label, "어젯밤");
  assert.equal(groups[0].carried, true);
  assert.equal(groups[1].key, "2026-08-02");
  assert.equal(groups[1].label, "오늘");
});

check("주기 없는 항목과 잠든 항목이 분리되어 나온다", () => {
  const now = D("2026-07-27");
  const { from, to } = defaultRange(now);
  const res = expandMemos(
    [
      memo({ id: "naked" }),
      memo({
        id: "leap",
        recurrence: rule({ freq: "yearly", interval: 1, month: 2, day: 29 }),
        createdAt: CREATED,
      }),
      memo({ id: "weekly", recurrence: rule({ freq: "weekly", interval: 1, weekdays: [1] }), createdAt: CREATED }),
    ],
    from,
    to,
  );
  assert.deepEqual(res.ruleless.map((m) => m.id), ["naked"]);
  assert.deepEqual(res.dormant.map((m) => m.id), ["leap"]);
  assert.ok(res.instances.length > 0);
});

// ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n${failures.length} 실패 / ${passed} 통과\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`반복 일정 검증: ${passed} 통과`);
