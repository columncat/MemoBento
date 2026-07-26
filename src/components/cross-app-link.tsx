"use client";

import { ArrowUpRight, Mail } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 형제 앱 주소 유추.
 *
 * 접속 경로에 따라 정답이 다르다:
 *   - `memobento.columncat.cc` 처럼 서브도메인으로 들어왔으면 → 형제 서브도메인.
 *     도메인에는 앱 포트가 열려 있지 않으므로 포트를 붙이면 깨진다.
 *   - LAN IP / Tailscale IP / MagicDNS 로 들어왔으면 → 같은 호스트의 다른 포트.
 *
 * 덕분에 들어온 경로를 그대로 따라간다. 서버가 `href`(환경변수 override)를 주면
 * 그 값이 항상 이긴다.
 */
export function siblingAppUrl(
  self: string,
  sibling: string,
  defaultPort: number,
): string {
  const { protocol, hostname } = window.location;
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[0].toLowerCase() === self) {
    return `${protocol}//${[sibling, ...parts.slice(1)].join(".")}`;
  }
  return `${protocol}//${hostname}:${defaultPort}`;
}

/** 자매 앱(MailBento)으로 건너가는 버튼. */
export function MailBentoLink({
  href,
  defaultPort = 3000,
}: {
  href?: string | null;
  defaultPort?: number;
}) {
  const [url, setUrl] = useState(href ?? "");

  useEffect(() => {
    if (href) {
      setUrl(href);
      return;
    }
    setUrl(siblingAppUrl("memobento", "mailbento", defaultPort));
  }, [href, defaultPort]);

  return (
    <a
      href={url || "#"}
      className="group flex items-center gap-2 rounded-full bg-(--color-surface) px-4 py-2 text-sm text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-2)"
      title={url ? `MailBento 로 이동 (${url})` : "MailBento 로 이동"}
    >
      <Mail className="h-4 w-4" />
      <span className="hidden sm:inline">MailBento</span>
      <ArrowUpRight className="h-3 w-3 text-(--color-fg-4) transition group-hover:text-(--color-fg-2)" />
    </a>
  );
}
