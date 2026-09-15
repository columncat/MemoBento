# memobento-mcp

[MemoBento](../README.md) 의 메모함과 메모를 **에이전트가 읽고 고칠 수 있게** 해 주는
MCP 서버입니다. stdio 로 붙습니다.

앱의 HTTP API 를 그대로 씁니다. DB 파일을 직접 건드리지 않습니다 — 휴지통 30일 보관,
순서, 시스템 메모함(MailBento 공유) 규칙이 전부 서버 쪽에 있어서 우회하면 그게 다 깨집니다.

## 어디서 돌리나

MemoBento 에 HTTP 로 닿을 수 있으면 됩니다.

| 상황 | `MEMOBENTO_URL` |
| --- | --- |
| 같은 호스트 (Docker 로 앱을 띄운 머신) | `http://127.0.0.1:3001` |
| 같은 내부망의 다른 머신 | `http://<호스트>:3001` |
| SSH 로만 닿는 경우 | 아래 참고 |

## 설치

```bash
git clone https://github.com/columncat/MemoBento.git
cd MemoBento/mcp
npm install
npm run build
```

## 설정

환경변수 세 개입니다.

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `MEMOBENTO_URL` | `http://127.0.0.1:3001` | 앱 주소 |
| `MEMOBENTO_PASSWORD` | (없음) | `AUTH_PASSWORD` 를 켠 서버라면 필수 |
| `MEMOBENTO_TIMEOUT_MS` | `15000` | 요청 하나의 제한 시간 |

앱에는 API 토큰이 없어서, 사람이 쓰는 것과 같은 비밀번호로 세션 쿠키를 받아 씁니다.
세션이 만료되면 자동으로 다시 로그인하고 원래 요청을 재시도합니다.

### MCP 클라이언트에 등록

```json
{
  "mcpServers": {
    "memobento": {
      "command": "node",
      "args": ["/path/to/MemoBento/mcp/dist/index.js"],
      "env": {
        "MEMOBENTO_URL": "http://127.0.0.1:3001",
        "MEMOBENTO_PASSWORD": "…"
      }
    }
  }
}
```

Claude Code 라면:

```bash
claude mcp add memobento --env MEMOBENTO_URL=http://127.0.0.1:3001 --env MEMOBENTO_PASSWORD=… -- node /path/to/MemoBento/mcp/dist/index.js
```

### SSH 너머로 쓰기

stdio 서버라서 원격에서 그대로 실행하면 됩니다. 비밀번호는 명령줄이 아니라 원격의
환경에 두는 편이 안전합니다 (명령줄 인자는 그 호스트의 프로세스 목록에 보입니다).

```json
{
  "command": "ssh",
  "args": ["nas", "MEMOBENTO_URL=http://127.0.0.1:3001", "node", "/volume1/docker/MemoBento/mcp/dist/index.js"]
}
```

## 도구

| 도구 | 하는 일 |
| --- | --- |
| `list_notebooks` | 메모함과 메모 읽기. `includeMemos=false` 로 목록만, `textLimit` 로 본문 길이 조절 |
| `search_memos` | 본문·제목·URL·파일 이름 문자열 검색. `fileKind`(`image`/`pdf`/`text`/`file`)로 파일 메모만 추리기 |
| `read_file` | 파일 메모 열기. 그림은 그림으로(아래), PDF 는 쪽마다 뽑은 글자로 |
| `upload_file` | `MEMOBENTO_UPLOAD_DIR` 안의 파일을 메모함에 올리기 (그 변수가 있을 때만 보임) |
| `create_notebook` | 메모함 만들기 (`memo` / `checklist` / `todo` / `schedule`) |
| `update_notebook` | 이름·보기 방식 변경 |
| `delete_notebook` | 휴지통으로 (30일) |
| `reorder_notebooks` | 화면 배치 순서 |
| `create_memo` | 텍스트 또는 링크 메모 추가 |
| `update_memo` | 본문·제목·링크·완료·기한·색·반복규칙 변경, 다른 메모함으로 이동 |
| `delete_memo` | 휴지통으로 (30일) |
| `reorder_memos` | 메모함 안 순서 |
| `list_trash` / `restore_trash` / `purge_trash` | 휴지통 보기·되살리기·영구 삭제 |

메모함은 **id 또는 정확한 이름**으로 지정합니다. 같은 이름이 둘 이상이면 id 를 쓰라고
알려 줍니다.

### 응답을 줄여서 돌려줍니다

앱의 API 는 어떤 변경이든 메모함 **전체 목록**을 돌려줍니다. 화면에는 맞지만 도구
결과로 그대로 흘리면 메모 하나 고칠 때마다 수천 토큰이 대화에 쌓입니다. 그래서 바뀐
것만, 빈 필드는 빼고 돌려줍니다. 본문은 기본 400자에서 자르며 `textLimit: 0` 으로
전문을 받을 수 있습니다.

### 파일 읽기 (`read_file`)

MCP 응답에는 "문서" 라는 종류가 없고, 부르는 쪽이 넘기지 못하는 모양은 모델에게
닿지 않습니다. 그래서 넘어가는 것으로 확인한 모양으로만 돌려줍니다.

- **그림** — png·jpeg·gif·webp 이고 8MB 이하면 원본을 그림으로 돌려줍니다. 더 크거나
  다른 형식(heic·bmp·svg·tiff 등)이면 앱이 업로드 때 만든 미리보기(긴 변 400px 이하)를
  대신 보내고 `sent: "thumbnail"` 로 알립니다. 미리보기도 없으면 `read: false` 와 이유.
- **PDF** — 64MB 이하면 쪽마다 글자를 뽑아 **글**로 돌려줍니다 (`pdfjs-dist`).
  `pages` 로 쪽을 짚고(`"1-5"`, `"2,5-8"`, `"10-"`), 한 번에 20쪽·`maxChars`(기본
  12,000, 최대 20,000)자까지 담습니다. `totalPages` 와 `nextPages`(안 읽은 쪽)를 함께
  줍니다. 글자층이 없는 스캔본이면 `textFound: false` 로 알리고, 미리보기가 있으면 1쪽
  미리보기를 붙입니다. PDF 속 그림·도표는 담기지 않습니다.
- 뽑은 글은 JSON 머리글 뒤에 `<file-text>` 태그로 감싸 싣습니다.

## 안 되는 것

- **파일 메모 만들기(`create_memo`).** 파일은 `upload_file` 로만 올립니다.
- **글 파일·문서 파일 내용 읽기.** `read_file` 은 그림과 PDF 만 엽니다. 나머지는 이름과
  크기만 알려 줍니다.
- **메모함 종류 변경.** 만들 때 정해지고 앱에서도 바꿀 수 없습니다.
- **시스템 메모함(`Corkboard` / `Memo`) 이름 변경·삭제.** MailBento 와 공유하는
  자료구조라 잠겨 있습니다 (403). 안의 메모는 자유롭게 고칠 수 있습니다.

## 주의

이 서버를 붙인 에이전트는 **메모함을 지울 수 있습니다.** 지운 것은 30일 휴지통에
남으므로 되돌릴 수 있지만, `purge_trash` 는 되돌릴 수 없고 첨부 파일도 디스크에서
지웁니다.

## 개발

```bash
npm run check   # 타입 검사
npm run build   # dist/ 생성
npm start       # 직접 실행 (stdio 라 터미널에서는 조용합니다)
```
