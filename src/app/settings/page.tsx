import { ArrowLeft, ChevronRight, Clock, Database, Link2, LogOut } from "lucide-react";
import Link from "next/link";

import { isAuthEnabled } from "@/lib/auth";
import { isExternalLegacy } from "@/lib/legacy-store";
import { SYSTEM_NOTEBOOKS, listNotebooks } from "@/lib/memo-server";
import { RETENTION_DAYS } from "@/lib/trash";

import { PreferencesPanel } from "./preferences-panel";
import { SettingsIO } from "./settings-io";
import { apiPath } from "@/lib/api-path";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const authEnabled = isAuthEnabled();
  const synced = isExternalLegacy();
  const notebooks = listNotebooks();
  const memoCount = notebooks.reduce((s, n) => s + n.memos.length, 0);

  return (
    <main className="relative mx-auto flex min-h-screen max-w-[860px] flex-col gap-6 px-6 py-10 lg:px-0">
      <header className="flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-(--color-fg-3) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" />
          메모함으로
        </Link>
        <div className="flex items-center gap-2">
          {authEnabled && (
            <>
              <Link
                href="/history"
                className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
              >
                <Clock className="h-3.5 w-3.5" />
                로그인 기록
              </Link>
              <form action={apiPath("/api/logout")} method="POST">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-full bg-(--color-surface) px-3 py-1.5 text-xs text-(--color-fg-3) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-danger)/15 hover:text-(--color-danger)"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  로그아웃
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <h1
        className="text-2xl leading-tight"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        설정
      </h1>

      {/* 저장 현황 + MailBento 연동 상태 */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <div className="mb-4 flex items-center gap-2 text-base font-medium text-(--color-fg)">
          <Database className="h-4 w-4 text-(--color-fg-3)" />
          저장 현황
        </div>

        <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="메모함" value={String(notebooks.length)} />
          <Stat label="메모" value={String(memoCount)} />
          <Stat
            label="시스템 예약"
            value={String(SYSTEM_NOTEBOOKS.length)}
          />
        </dl>

        <div className="rounded-lg bg-(--color-bg-2) px-4 py-3 ring-1 ring-(--color-border-soft)">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-(--color-fg-2)">
            <Link2 className="h-3.5 w-3.5" />
            MailBento 호환
          </div>
          {synced ? (
            <p className="text-[11.5px] leading-relaxed text-(--color-fg-3)">
              <span className="text-(--color-accent-strong)">
                실시간 동기화 켜짐
              </span>{" "}
              — <code className="font-mono">MAILBENTO_DB_PATH</code> 가 지정되어
              시스템 메모함 <b>Corkboard</b> / <b>Memo</b> 가 MailBento 의
              위젯 데이터를 직접 읽고 씁니다. 한쪽에서 고친 메모가 다른 쪽에도
              그대로 보입니다.
            </p>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-(--color-fg-3)">
              현재는 MemoBento 자체 DB 에 저장됩니다. 아래{" "}
              <b>불러오기</b>로 MailBento 백업 JSON 을 그대로 가져올 수 있고,{" "}
              <code className="font-mono">MAILBENTO_DB_PATH</code> 를 MailBento
              의 <code className="font-mono">.db</code> 파일로 지정하면 실시간
              양방향 동기화가 됩니다.
            </p>
          )}
        </div>

        <p className="mt-3 text-[11px] text-(--color-fg-4)">
          시스템 예약 메모함은 이름 변경·삭제가 잠겨 있고, 안의 메모는 자유롭게
          편집할 수 있습니다.
        </p>
      </section>

      {/* 표시 설정 */}
      <PreferencesPanel />

      {/* 백업 / 복원 */}
      <SettingsIO />

      {/*
        휴지통과 에이전트 기록은 한 단계 들어가서 본다.

        둘 다 항목이 얼마든지 쌓이는 목록이라, 여기 펼쳐 두면 설정 페이지가
        끝없이 길어진다. 자주 보는 것도 아니다.
      */}
      <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
        <h2 className="mb-1 text-lg font-medium text-(--color-fg)">기록</h2>
        <p className="mb-4 text-sm text-(--color-fg-4)">
          지운 것과, 에이전트가 고친 것.
        </p>
        <div className="flex flex-col gap-2">
          <SubPageLink
            href="/settings/trash"
            title="휴지통"
            desc={`지운 메모함·메모를 ${RETENTION_DAYS}일간 보관합니다`}
          />
          <SubPageLink
            href="/settings/agent-log"
            title="에이전트 기록"
            desc="MCP 로 연결된 에이전트가 무엇을 고쳤는지"
          />
        </div>
      </section>
    </main>
  );
}

function SubPageLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg bg-(--color-bg-2) px-4 py-3 ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi)"
    >
      <span className="min-w-0">
        <span className="block text-sm text-(--color-fg)">{title}</span>
        <span className="block text-[12px] break-keep text-(--color-fg-4)">{desc}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-(--color-fg-4)" />
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-(--color-bg-2) px-4 py-3 ring-1 ring-(--color-border-soft)">
      <dt className="text-[10.5px] uppercase tracking-wider text-(--color-fg-4)">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-lg text-(--color-fg)">{value}</dd>
    </div>
  );
}
