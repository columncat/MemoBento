import { z } from "zod";

const envSchema = z.object({
  DATABASE_PATH: z.string().default("./data/memobento.db"),

  /** 업로드 원본/썸네일이 저장되는 디렉터리. Docker 에서는 볼륨 내부. */
  UPLOAD_DIR: z.string().default("./data/uploads"),
  /** 업로드 1건당 최대 크기 (MB). */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(2048).default(50),

  /**
   * MailBento SQLite 파일 경로 (선택).
   * 지정하면 시스템 메모함(Corkboard / Memo)이 그 DB 의 widget_state 를
   * 직접 읽고 써서 MailBento 와 실시간 동기화된다.
   */
  MAILBENTO_DB_PATH: z.string().optional(),

  /**
   * MailBento 로 건너가는 버튼의 주소 (선택).
   * 비우면 지금 접속한 호스트의 3000 포트로 유추한다 — LAN / Tailscale 어느
   * 주소로 들어왔든 같은 경로를 따라가므로 보통 비워두면 된다.
   */
  MAILBENTO_URL: z.string().optional(),

  /**
   * 인증 설정 — 둘 다 비우면 인증 비활성 (앱 그대로 공개).
   * - AUTH_PASSWORD: plaintext 또는 bcrypt 해시 ($2a$ / $2b$ 시작). 둘 다 자동 감지.
   * - AUTH_SECRET: 세션 쿠키 암호화 키 (32바이트 base64).
   */
  AUTH_PASSWORD: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
