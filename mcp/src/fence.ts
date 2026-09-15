/**
 * 파일에서 꺼낸 글을 태그로 감싼다.
 *
 * PDF 결과는 JSON 머리글과 뽑은 본문을 한 글 덩어리로 싣는다. 본문이 어디서
 * 시작해 어디서 끝나는지 보이도록 `<kind>` … `</kind>` 로 감싼다.
 *
 * 본문에 같은 이름의 태그 꼴(`</file-text>`, `< / file-text >` 등)이 있으면
 * `[태그]` 로 바꿔, 감싼 경계가 하나로만 읽히게 한다.
 */
export function fence(text: string, kind: string): string {
  // `kind` 는 코드에 박힌 글자지만 정규식에 이어 붙이는 자리라 escape 한다.
  const tag = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const same = new RegExp(`<\\s*/?\\s*${tag}\\s*>`, "gi");
  return `<${kind}>\n${text.replace(same, "[태그]")}\n</${kind}>`;
}
