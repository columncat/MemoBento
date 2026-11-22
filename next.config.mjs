/**
 * 하위 경로에 얹을 때 쓰는 값.
 *
 * `bento.example.com/memo` 처럼 도메인 하나를 나눠 쓰는 배포에서 필요하다.
 * 앞단에서 경로만 갈라 보내면 앱은 자기가 `/memo` 아래 있다는 것을 모르고
 * `/settings` 같은 절대 경로를 만들어 낸다 — 브라우저는 그걸 도메인 뿌리로
 * 해석해서 엉뚱한 곳으로 간다.
 *
 * **빌드 시점에 박히는 값이다.** 이미지를 만들 때 정해야 하고 나중에
 * 환경변수로 바꿀 수 없다. Next 가 이 값을 산출물 곳곳(정적 자산 주소,
 * 라우트 표, 클라이언트 번들)에 미리 심기 때문이다.
 *
 * 비워 두면 예전처럼 뿌리에서 돈다. 하위 도메인을 쓰는 배포는 건드릴 필요가 없다.
 */
const basePath = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

/**
 * 모든 화면에 붙이는 Content-Security-Policy.
 *
 * 무엇을 왜 열어 두는지 — 하나라도 빼면 화면이 깨진다:
 * - script-src 'unsafe-inline': App Router 가 HTML 안에 인라인 스크립트
 *   (`self.__next_f.push(…)`)로 화면 자료를 싣고, layout.tsx 의 테마 스크립트도
 *   인라인이다. 막으면 빈 화면이 된다. nonce 로 가면 모든 화면이 동적 렌더링이
 *   되어야 해서 택하지 않았다.
 * - 'unsafe-eval' 은 `next dev` 에서만 — React 개발 도구가 eval 을 쓴다.
 * - style-src 'unsafe-inline': Tailwind·React 의 style 속성.
 *   글꼴 CSS 는 jsdelivr(Pretendard)와 Google Fonts 에서 받는다(layout.tsx).
 * - font-src: 위 두 CSS 가 가리키는 글꼴 파일 자리.
 * - img-src https: — 링크 메모의 아이콘은 Google favicon 서비스(→ gstatic 으로
 *   리다이렉트)가 기본이지만, 사용자나 MailBento 위젯이 **아무 주소나** 넣을 수
 *   있다(`iconUrl`). 그림만 여는 것이라 스크립트가 실릴 길은 없다.
 *   data:/blob: 는 업로드 전 썸네일(canvas → data URL)과 내보내기 파일.
 * - media-src: 소리·영상 메모는 우리 파일 라우트에서 Range 로 받는다.
 * - frame-src 'self': PDF 미리보기 iframe 이 우리 파일 라우트를 연다.
 * - worker-src: pdf.js 워커(/_next/static 아래)와, 물러나기만 하는 public/sw.js.
 * - frame-ancestors 'self': 남의 사이트가 이 화면을 액자에 넣지 못하게.
 *   DENY 가 아닌 것은 같은 오리진의 PDF iframe 때문이다.
 * - form-action 'self', base-uri 'self', object-src 'none': 쓰지 않는 문을 닫는다.
 *
 * `/api/…` 에는 붙이지 않는다. 파일 라우트(`/api/files/…`)가 응답마다 자기
 * CSP(`sandbox …`, lib/file-kind.ts)를 단다 — 둘이 겹치면 브라우저는 **둘 다**
 * 적용하므로, 이 정책의 frame-ancestors·sandbox 조합이 PDF 내장 뷰어를 깰 수
 * 있다. JSON 응답에는 CSP 가 필요 없기도 하다.
 */
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // 응답마다 "X-Powered-By: Next.js" 를 붙여 판을 알려 줄 이유가 없다.
  poweredByHeader: false,
  /*
   * `/_next/image` 를 쓰지 않는다 (next/image 를 부르는 곳이 없다).
   *
   * 그 라우트는 미들웨어 matcher 밖이라 로그인 없이 닿고, Next 의 이미지
   * 최적화기는 최근 원격 코드 실행 취약점이 거듭 나온 자리다. 꺼 두면 쓰지도
   * 않는 문이 하나 닫힌다.
   */
  images: { unoptimized: true },
  serverExternalPackages: ["better-sqlite3"],
  ...(basePath ? { basePath } : {}),
  env: {
    /*
     * 브라우저 코드에도 알려 준다.
     *
     * Next 는 <Link> 와 router 와 정적 자산에는 접두어를 알아서 붙이지만
     * **fetch 는 손대지 않는다.** `fetch("/api/…")` 는 도메인 뿌리로 가서
     * 404 를 받는다. 그래서 부를 때 직접 붙여야 하고, 그러려면 값이 필요하다.
     */
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  /*
   * 보안 헤더. 경로는 basePath 기준이다 — Next 가 접두어를 알아서 붙인다.
   * HSTS 는 여기 두지 않는다. Cloudflare 엣지에서 붙일 일이다.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          /*
           * no-referrer 가 아니라 same-origin.
           * no-referrer 면 크롬이 같은 오리진 폼 POST 에 `Origin: null` 을 실어
           * 보내고, 서버 액션(로그인 화면)의 Origin 검사가 그걸 거절한다.
           */
          { key: "Referrer-Policy", value: "same-origin" },
          // CSP 의 frame-ancestors 를 모르는 옛 브라우저용. PDF iframe 때문에 DENY 가 아니다.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        /*
         * 첫 화면을 따로 적는다. basePath 가 있으면 아래 패턴은
         * `/memo/:path` 가 되어 `/memo` 자체(메모함 본 화면)에는 걸리지 않는다
         * — 실제로 빌드해 보니 그 화면만 CSP 없이 나갔다.
         */
        source: "/",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
      {
        // `/api` 와 `/api/…` 만 뺀다 (위 csp 주석 참고).
        source: "/:path((?!api(?:/|$)).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
