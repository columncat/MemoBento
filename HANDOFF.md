# MemoBento — 인수인계

이 문서는 코드를 처음 여는 사람이 **왜 이렇게 되어 있는지**를 먼저 알 수 있게 쓴 것이다.
무엇을 하는지는 코드가 말해 준다. 여기에는 코드만 봐서는 알 수 없는 결정과 함정을 적는다.

---

## 1. 한 줄 요약

메모함(notebook) 단위로 텍스트·링크·이미지·PDF·파일을 모아 보는 개인 대시보드.
Synology NAS 의 Docker 로 돌고, 자매 앱 **MailBento** 와 일부 데이터를 공유한다.

---

## 2. 지형도

```
src/
  app/                      Next.js App Router
    api/                    모든 변경은 여기를 통한다. 응답은 대개 notebooks 전체 목록
    settings/               테마·열 수·백업·휴지통
  components/
    dashboard.tsx           상태의 중심. notebooks 배열 하나가 화면 전체를 만든다
    notebook-card.tsx       메모함 카드 (머리말 = 순서 손잡이)
    memo-list.tsx           kind 별 렌더 분기
    memo-item.tsx           일반 메모 행/타일 + DnD 규약(useItemDnd)
    checklist-item.tsx      체크리스트 / TODO 한 줄
    schedule-item.tsx       반복 일정 한 줄
    schedule-grid.tsx       반복 규칙 표 편집 (넓은 모달)
    due-picker.tsx          TODO 기한 선택기
  lib/
    memo-server.ts          메모함·메모의 단일 진입점 (SQLite + 레거시 JSON 통합)
    legacy-store.ts         MailBento widget_state 호환 계층
    recurrence.ts           반복 규칙 순수 로직 (날짜 계산만)
    schedule-instances.ts   규칙 → 실제 날짜 전개 (MemoDTO 를 아는 계층)
    trash.ts                30일 소프트 삭제
    file-store.ts           업로드 파일 저장/스트리밍
    upload-session.ts       조각 업로드
    crypto-client.ts        브라우저 측 AES-GCM
    transfer-queue.ts       업로드 큐
public/sw.js                암호화 파일 복호화 서비스 워커
```

---

## 3. 반드시 알고 있어야 하는 것

### 3.1 마이그레이션은 `when` 이 증가해야만 적용된다

`drizzle/meta/_journal.json` 의 `when` 값이 **마지막으로 적용된 값보다 크지 않으면
drizzle 은 예외 없이 조용히 건너뛴다.** 한 번 이 함정에 빠져 마이그레이션이 통째로
무시된 적이 있다. `npm run db:generate` 후에는 반드시 새 항목의 `when` 이 이전보다
큰지 눈으로 확인할 것.

`drizzle/` 는 **커밋 대상**이다. Docker 이미지가 이 폴더를 읽어 첫 DB 접근 때
자동 마이그레이션한다.

### 3.2 인증이 켜져 있으면 마이그레이션이 늦게 걸린다

DB 는 첫 쿼리 때 지연 초기화된다(`lib/db/index.ts`). 인증이 켜진 배포에서는
로그인 전 요청이 전부 307 로 튕겨 DB 를 열지 않으므로, 배포 직후에는 아직
마이그레이션이 안 된 상태다. 첫 로그인 시점에 적용된다.

### 3.3 시스템 예약 메모함 두 개는 MailBento 의 데이터다

`Corkboard`(링크만) / `Memo`(텍스트만) 는 MailBento 의 `widget_state` JSON 에 산다.
`MAILBENTO_DB_PATH` 를 주면 그 DB 를 직접 읽고 쓴다 — 양쪽이 실시간 동기화된다.

그래서 이 둘은 **이름 변경·삭제가 잠겨 있고**, 받을 수 있는 메모 종류도 고정이다.
파일 메모처럼 레거시 포맷으로 표현할 수 없는 것은 SQLite 쪽에 저장되고 화면에서만 합쳐진다.

`legacy-store.ts` 는 `folders` 키를 **절대 건드리지 않는다**. MailBento 의 폴더
위젯이 그걸 쓴다.

### 3.4 반복 일정: `anchor` 와 `from` 은 다른 것이다

- `anchor` — 주기의 **기준일**. 요일·일자를 고르지 않은 규칙("매주")이 어느 요일로
  도는지, `interval > 1` 의 위상이 어디서 시작하는지를 정한다.
- `from` / `to` — **표시 기간**. 순수 필터.

예전에는 `from` 이 둘 다 겸했다. 그래서 "9월부터 보이게" 처럼 범위만 좁혔는데
매주 화요일이던 일정이 매주 토요일로 옮겨 갔고, 요약 칩은 이동 전후 모두 "매주" 라
화면 어디에도 단서가 없었다. 지금은 분리되어 있고, `anchor` 가 없던 옛 규칙은
읽을 때 `withLegacyAnchor` 가 `from` 을 `anchor` 로 굳혀 기존 발생일을 유지한다.
**이 폴백을 지우면 이미 쓰던 일정의 요일이 바뀐다.**

### 3.5 시각은 26:59 까지 — 그리고 그건 참고용이다

"토요일 26:00" 은 실제로 일요일 새벽 2시지만 **토요일 항목으로 읽히는 것**이 생활
감각에 맞다. 그래서:

- 날짜 그룹은 토요일 그대로 둔다.
- 일요일 02:01 까지 살아 있다(`instanceEndMs`).
- 자정을 넘겨 살아 있는 항목을 잡으려고 표시 범위의 시작을 **어제**로 잡는다
  (`defaultRange`). 이 `-1` 을 지우면 일요일 새벽에 토요일 26:00 일정이 조용히 사라진다.

시각 계산은 벽시계 분을 고정 ms 로 더하지 않는다. 서머타임이 있는 지역에서
전환일 하루는 23/25시간이라 어긋난다. 국내에서는 증상이 없지만 계약이 깨진다.

### 3.6 매월 31일은 없는 달을 건너뛴다

말일로 당기지 않는다. RFC 5545 `BYMONTHDAY` 및 구글·애플 캘린더와 같은 동작이다.
규칙 편집기가 29일 이상을 고르면 그 사실을 안내한다.

### 3.7 `expandRange` 는 `matchesDay` 를 통째로 믿는다

하루씩 훑으며 판정을 물어본다. 산술 점프로 다시 구현하면 31일·주 정렬·윤년 판정이
`matchesDay` 와 갈라져 "목록엔 있는데 행에는 오늘 강조가 없다" 같은 버그가 난다.
하나가 틀리는 편이 둘이 갈라지는 것보다 낫다는 선택이고, 그 대가로
`npm run check:recurrence` 의 **브루트포스 대조**가 필수다.

### 3.8 휴지통·백업은 스키마에서 파생한다

컬럼을 손으로 나열하던 시절에 `kind` / `recurrence` / `done` / `dueAt` / `position` 이
전부 빠져 있었다 — 반복 일정 메모함을 지웠다 되살리면 평범한 메모함이 되고 주기가
사라졌다. 지금 휴지통 스냅샷 타입은 `Snap<typeof schema.memos.$inferSelect>` 로
파생되어 **다음 컬럼은 컴파일 단계에서 걸린다**. 백업(export/import)은 필드를
명시하되 구버전 백업도 읽히도록 폴백을 둔다.

### 3.9 파일은 브라우저에서 암호화해 올린다

서버는 복호화하지 않는다. 디스크에는 `[IV(12) || ciphertext || tag(16)]` 레코드가
8MiB 평문 단위로 이어붙어 있다. 열람은 서비스 워커(`public/sw.js`)가 `/dl/...` 를
가로채 스트리밍 복호화한다.

- `middleware.ts` 의 `PUBLIC_PREFIXES` 에 **`/sw.js` 가 반드시 있어야 한다.**
  없으면 워커가 로그인으로 튕겨 암호화 파일이 전부 안 열린다.
- 다운로드 경로는 배압을 지켜야 한다. `Readable.toWeb()` 을 쓰는 이유다 —
  예전에 4.4GB ISO 를 받다가 메모리가 터지고, 조용히 잘린 파일이 "성공"으로
  저장된 적이 있다. 지금은 길이가 안 맞으면 오류를 던진다.
- 다중 GB 응답에 `Cache-Control: immutable` 을 붙이지 말 것. 브라우저 캐시가
  항목을 잘라 저장한다.

### 3.10 Tailwind v4 는 안 쓰는 테마 변수를 떨어낸다

`@theme` 에 선언한 변수라도 유틸리티가 참조하지 않으면 빌드 결과에서 사라진다.
인라인 `style={{ color: "var(--...)" }}` 로만 쓰는 값(항목 글자 색 팔레트,
메모함 제목 글꼴)은 **`:root` 에 두어야 한다**.

---

## 4. 자주 건드리게 되는 곳

| 하고 싶은 일 | 손댈 곳 |
|---|---|
| 메모함 종류 추가 | `db/schema.ts` 의 `NOTEBOOK_KINDS` → `memo-server.ts` 의 `acceptedTypes` → `memo-list.tsx` 분기 → `notebook-card.tsx` 의 `KIND_META` |
| 반복 규칙 필드 추가 | `recurrence.ts` 의 `Recurrence` + `normalizeRecurrence` → `schedule-grid.tsx` 열 추가 → `check:recurrence` 케이스 추가 |
| 메모 컬럼 추가 | `db/schema.ts` → `types.ts` 의 `MemoDTO` → `memo-server.ts`(읽기/쓰기) → **백업 export/import** → 휴지통은 자동 |
| 화면 색 | `app/globals.css` 의 토큰. 테마별로 6벌 있다 |

---

## 5. 운영

```bash
npm run dev                # 로컬
npm run build && npm start # 프로덕션 확인
npm run check:recurrence   # 반복 일정 순수 로직 검증 (28 케이스)
npm run db:generate        # 스키마 변경 후 마이그레이션 생성
```

배포는 NAS 에서 `docker-compose up -d --build`. 코드 트리를 교체할 때는
**`src` / `drizzle` / `public` 을 먼저 지우고** 풀어야 한다 — `tar -xzf` 는 덮어쓰기만
하므로 삭제된 파일이 남아 빌드를 깨뜨린 적이 있다.

`data/` 는 DB 와 업로드 원본이 사는 곳이다. **커밋 금지**이고, 컨테이너 uid(1001)가
쓸 수 있어야 한다. 백업은 반드시 sqlite `.backup` API 로 — `cp` 는 WAL 내용을 놓친다.

---

## 6. 남아 있는 것

- 첨부가 아주 많은 메모함에서 목록 응답이 커진다. 지금은 썸네일 바이트를 안 실어
  견디고 있지만, 언젠가 페이지네이션이 필요하다.
- `nextOccurrence` 의 일/주/월 경로는 여전히 하루씩 훑는다(상한 800). 연 단위만
  O(1) 로 바꿔 뒀다.
- 인스턴스 목록의 화면 상한(20건)과 데이터 상한(200건)이 따로 논다. 의도된 분리지만
  둘 다 사용자에게 보이지는 않는다.
