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
| `search_memos` | 본문·제목·URL 문자열 검색 |
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

## 안 되는 것

- **파일 첨부 업로드.** 브라우저에서 AES-GCM 으로 암호화해 8MB 조각으로 올리는 구조라
  서버 밖에서 재현할 수 없습니다. 기존 첨부의 메타데이터(이름·크기·종류)는 읽힙니다.
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
