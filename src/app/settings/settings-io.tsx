"use client";

import { AlertTriangle, Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

import {
  STORAGE_KEYS,
  applyThemeAndModeToHtml,
  type ModePref,
  type ThemeKey,
} from "@/lib/preferences";

type Status = { kind: "idle" | "ok" | "err"; msg?: string };

interface Prefs {
  theme?: string;
  mode?: string;
  columns?: string;
}

function readPrefs(): Prefs {
  try {
    return {
      theme: localStorage.getItem(STORAGE_KEYS.theme) ?? undefined,
      mode: localStorage.getItem(STORAGE_KEYS.mode) ?? undefined,
      columns: localStorage.getItem(STORAGE_KEYS.columns) ?? undefined,
    };
  } catch {
    return {};
  }
}

function writePrefs(prefs?: Prefs) {
  if (!prefs) return;
  try {
    if (prefs.theme) localStorage.setItem(STORAGE_KEYS.theme, prefs.theme);
    if (prefs.mode) localStorage.setItem(STORAGE_KEYS.mode, prefs.mode);
    if (prefs.columns)
      localStorage.setItem(STORAGE_KEYS.columns, prefs.columns);
    if (prefs.theme && prefs.mode)
      applyThemeAndModeToHtml(prefs.theme as ThemeKey, prefs.mode as ModePref);
  } catch {
    /* */
  }
}

export function SettingsIO() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/export", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      payload.prefs = readPrefs();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memobento-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: "ok", msg: "내보내기 완료" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "내보내기 실패",
      });
    } finally {
      setBusy(false);
    }
  };

  const onImportFile = async (file: File) => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const data = JSON.parse(await file.text());
      const app = data?.app;
      if (app !== "memobento" && app !== "mailbento") {
        throw new Error("MemoBento / MailBento 백업 파일이 아닙니다");
      }
      const isMailBento = app === "mailbento";
      const confirmMsg = isMailBento
        ? "MailBento 백업입니다. 시스템 메모함(Corkboard / Memo)의 내용이 이 파일로 교체됩니다. 진행할까요?"
        : "사용자 메모함이 파일 내용으로 교체되고 시스템 메모함도 덮어써집니다. 진행할까요?";
      if (!confirm(confirmMsg)) {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }

      const res = await fetch("/api/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // MailBento 백업에는 notebooks 가 없다 — widget 만 반영된다.
          notebooks: isMailBento ? undefined : data.notebooks,
          widget: data.widget,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      writePrefs(data.prefs);
      setStatus({ kind: "ok", msg: "불러오기 완료 — 새로고침합니다" });
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "불러오기 실패",
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-medium text-(--color-fg)">
            백업 / 복원
          </div>
          <div className="text-xs text-(--color-fg-4)">
            메모함·메모·표시설정을 한 파일로 내보내고 불러옵니다. MailBento
            백업 JSON 도 그대로 읽을 수 있습니다.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-(--color-bg-2) px-3 py-1.5 text-xs text-(--color-fg-2) ring-1 ring-(--color-border-soft) transition hover:bg-(--color-surface-hi) disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            내보내기
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-(--color-accent-soft) px-3 py-1.5 text-xs text-(--color-accent-strong) ring-1 ring-(--color-accent)/40 transition hover:bg-(--color-accent)/25 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            불러오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      </header>

      <p className="flex items-start gap-1.5 text-[11px] text-(--color-fg-4)">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#d08700]" />
        첨부 파일의 <b>바이트는 백업 JSON 에 포함되지 않습니다</b> — 원본은{" "}
        <code className="font-mono">data/uploads</code> 볼륨에 있습니다. 서버를
        옮길 때는 JSON 과 함께 그 디렉터리도 복사하세요.
      </p>

      {status.kind !== "idle" && (
        <p
          className={
            "mt-2 text-xs " +
            (status.kind === "ok"
              ? "text-(--color-accent-strong)"
              : "text-(--color-danger)")
          }
        >
          {status.msg}
        </p>
      )}
    </section>
  );
}
