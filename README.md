# MemoBento

메모함(Notebook) 단위로 메모·링크·이미지·PDF·파일을 모아보는 개인용 대시보드.
[MailBento](https://github.com/columncat/MailBento) 의 레이아웃·테마·배포 방식을 그대로 이어받아,
`Inbox > Email` 구조를 `메모함 > 메모` 구조로 옮긴 앱입니다.

## 구조

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- **Backend**: Next.js Route Handlers + Server Actions
- **DB**: SQLite + Drizzle ORM (`./data/memobento.db`)
- **첨부 파일**: 원본 바이트는 `./data/uploads` 에 저장하고 DB 에는 메타데이터만 보관
- **배포**: Docker (Next.js standalone output) → Synology Container Manager
- **접근**: Tailscale (인터넷 노출 없음)

MailBento 에 있던 **위젯 온/오프 토글은 없습니다** — MemoBento 는 처음부터 메모 전용입니다.

## 개발 시작

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` 은 전부 선택 항목입니다 (기본값으로도 동작). 인증을 켜려면
`AUTH_PASSWORD` / `AUTH_SECRET` 을 채우세요.

## 메모함과 메모

### 메모함

- 대시보드 그리드에 카드로 놓입니다. 카드 왼쪽 손잡이를 끌어 순서를 바꿉니다.
- **추가**: 그리드 맨 끝 `+ 새 메모함` 카드 → 이름 입력 → Enter. (설정 페이지로 갈 필요 없음)
- **이름 변경**: 제목 더블클릭 또는 연필 아이콘 → 인라인 편집.
- **삭제**: 휴지통 아이콘. 안의 메모와 첨부 파일도 함께 지워집니다.
- **보기 방식**: 메모함마다 리스트 / 그리드를 따로 지정하며 서버에 저장됩니다.

### 시스템 예약 메모함 (MailBento 호환)

`Corkboard` 와 `Memo` 두 개는 **시스템 예약 메모함**입니다.

|                | 메모함                          | 메모                      |
| -------------- | ------------------------------- | ------------------------- |
| 이름 변경/삭제 | ❌ 잠김                          | —                         |
| 내용 편집      | —                               | ✅ 가능 (양쪽 동기화)      |

- `Corkboard` ↔ MailBento 코크보드 **핀**(링크 메모)
- `Memo` ↔ MailBento **메모**(텍스트 메모)

두 메모함의 텍스트/링크 메모는 MailBento 와 완전히 같은 `widget_state` JSON 포맷으로
저장되므로, 한쪽에서 고친 내용이 다른 쪽에도 그대로 보입니다.
이미지·PDF·파일처럼 MailBento 포맷으로 표현할 수 없는 메모는 MemoBento DB 에 따로
저장되며, MailBento 쪽 데이터(폴더 위젯 포함)는 건드리지 않습니다.

**실시간 동기화 켜기** — 두 단계.

1. `docker-compose.yml` 이 MailBento 의 data 디렉터리를 `/app/mailbento` 로
   마운트합니다 (같은 호스트에 나란히 배포한 경우 기본 포함).
2. `.env.local` 에 컨테이너 내부 경로를 채웁니다.

```bash
MAILBENTO_DB_PATH=/app/mailbento/mailbento.db
```

켜지면 대시보드 헤더에 `MailBento 동기화` 배지가 뜹니다.
지정하지 않으면 MemoBento 자체 DB 에 저장되며, `/settings` 의 **불러오기**로
MailBento 백업 JSON(`app: "mailbento"`)을 그대로 가져올 수 있습니다.

> **주의 — 마지막 저장이 이깁니다.** 두 앱이 같은 `widget_state` 행을 통째로
> 쓰기 때문에, 양쪽 탭을 동시에 열어두고 각각 편집하면 나중에 저장한 쪽이
> 앞선 변경을 덮어씁니다. 한쪽에서 고쳤으면 다른 쪽은 새로고침 후 편집하세요.
> (MemoBento 는 창에 포커스가 돌아올 때 자동으로 다시 읽습니다.)
>
> 켜기 전에 MailBento DB 를 백업해 두는 것을 권합니다 — WAL 때문에 `cp` 는
> 최신 내용을 놓칠 수 있으니 반드시 sqlite 백업 API 를 쓰세요:
> ```bash
> python3 -c "import sqlite3;s=sqlite3.connect('data/mailbento.db');d=sqlite3.connect('data/backup.db');s.backup(d)"
> ```

### 앱 간 이동

두 앱 헤더에 서로를 여는 버튼이 있습니다 (MemoBento → `MailBento`,
MailBento → `MemoBento`). 주소는 **지금 접속한 호스트의 다른 포트**로 자동
유추하므로 LAN / Tailscale / MagicDNS 어느 쪽으로 들어와도 그대로 따라갑니다.
리버스 프록시 등으로 포트가 다르면 `MAILBENTO_URL` (MemoBento 쪽) /
`MEMOBENTO_URL` (MailBento 쪽) 에 전체 URL 을 적으세요.

### 메모 종류

| 종류        | 표시                     | 클릭했을 때                     |
| ----------- | ------------------------ | ------------------------------- |
| 텍스트      | 본문 미리보기            | 편집 모달                       |
| 링크        | 파비콘 + 제목 + URL      | 새 탭으로 이동                  |
| 이미지      | 파일명 + 썸네일          | 앱 안에서 열람 + 다운로드 버튼  |
| PDF         | 파일명 + 1쪽 썸네일      | 앱 안에서 열람 + 다운로드 버튼  |
| 텍스트 파일 | 파일명 + 아이콘          | 앱 안에서 내용 표시 + 다운로드  |
| 일반 파일   | 파일명 + 아이콘          | **즉시 다운로드**               |

형식 판별은 **확장자** 기준입니다 (`src/lib/file-kind.ts`). 브라우저가 보낸
MIME 은 신뢰하지 않습니다.

### 파일 추가

- **드래그&드롭** — 파일을 메모함 카드 위에 떨어뜨리면 **그 메모함에 바로** 추가됩니다.
  URL/텍스트를 끌어다 놓아도 링크/텍스트 메모가 됩니다.
- **복사&붙여넣기** — `Ctrl+V` 하면 **어느 메모함에 넣을지 묻는 플로팅 창**이 뜹니다
  (숫자키로 빠른 선택, `Esc` 취소). 클립보드 이미지·파일·텍스트·URL 모두 지원.
- **클립 아이콘** — 파일 선택 대화상자.

썸네일은 브라우저에서 만들어 함께 올립니다 (이미지는 canvas, PDF 는 pdf.js 로 1쪽 렌더).
서버에 이미지 처리용 네이티브 의존성이 필요 없고, 실패하면 조용히 아이콘으로 폴백합니다.

## 환경변수

`.env.example` 참고.

| 이름                | 기본값                  | 설명                                        |
| ------------------- | ----------------------- | ------------------------------------------- |
| `DATABASE_PATH`     | `./data/memobento.db`   | SQLite 파일                                 |
| `UPLOAD_DIR`        | `./data/uploads`        | 첨부 원본/썸네일 저장 위치                  |
| `MAX_UPLOAD_MB`     | `50`                    | 업로드 1건당 최대 크기                      |
| `MAILBENTO_DB_PATH` | (없음)                  | 지정 시 MailBento DB 와 실시간 동기화       |
| `AUTH_PASSWORD`     | (없음)                  | plaintext 또는 bcrypt 해시. 비우면 인증 off |
| `AUTH_SECRET`       | (없음)                  | 세션 쿠키 암호화 키 (32바이트 base64)       |

## Docker 배포

```bash
cp .env.example .env.local
mkdir -p data/uploads && chmod -R 777 data   # ← 첫 배포 시 1회 (아래 설명)
docker compose up -d --build
```

> **`chmod 777 data` 가 필요한 이유** — 컨테이너는 uid 1001(`nodejs`)로 실행되는데
> Synology 바인드 마운트는 uid 를 매핑하지 않습니다. 호스트 디렉터리에 쓰기 권한이
> 없으면 `SQLITE_CANTOPEN` 으로 모든 페이지가 500 이 됩니다.
> (MailBento 도 같은 이유로 `data` 가 777 입니다.)

- 첫 부팅 시 **마이그레이션이 자동 적용**되어 빈 DB에서도 테이블이 생성됩니다.
- `./data` 볼륨에 DB 와 업로드 원본이 함께 영속화됩니다 → 재배포해도
  **메모함·메모·첨부가 유지**됩니다.
- 기본 포트는 `3001` 로 두어 MailBento(`3000`)와 같은 호스트에서 동시에 띄울 수 있습니다.
- MailBento 와 실시간 동기화하려면 `docker-compose.yml` 의 주석 처리된 볼륨을 풀고
  `MAILBENTO_DB_PATH` 를 그 경로로 지정하세요.

## 백업 / 복원

`/settings → 백업 / 복원`

- **내보내기**: 메모함 구조 + 메모 + 시스템 메모함(`widget`) + 표시설정을 JSON 한 파일로.
- **불러오기**: MemoBento 백업과 **MailBento 백업** 둘 다 인식합니다.
  MailBento 백업은 `widget` 필드만 반영되어 `Corkboard` / `Memo` 를 채웁니다.

> 첨부 파일의 **바이트는 JSON 에 포함되지 않습니다**. 서버를 옮길 때는 백업 JSON 과
> 함께 `data/uploads` 디렉터리도 복사하세요.

## 보안 메모

- 업로드된 파일은 신뢰할 수 없는 내용이므로, 서빙할 때 항상
  `Content-Security-Policy: sandbox` + `X-Content-Type-Options: nosniff` 를 붙여
  같은 오리진에서 스크립트가 실행되지 않게 막습니다.
- 저장 경로는 uid 로 생성하고, 읽을 때 `UPLOAD_DIR` 밖을 가리키는 경로는 거부합니다.
- 인증을 켜면 모든 로그인 시도(성공/실패, 수동/자동)가 `login_log` 에 기록되며
  앱에는 삭제 엔드포인트가 없습니다 (`/history` 에서 열람).
