"use client";

import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  COLUMNS,
  DELETE_CONFIRM,
  DELETE_CONFIRM_LABEL,
  DEFAULT_COLUMNS,
  DEFAULT_DELETE_CONFIRM,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  STORAGE_KEYS,
  THEMES,
  applyThemeAndModeToHtml,
  readDeleteConfirmPref,
  type ColumnsPref,
  type DeleteConfirmPref,
  type ModePref,
  type ThemeKey,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

export function PreferencesPanel() {
  const [theme, setTheme] = useState<ThemeKey>(DEFAULT_THEME);
  const [mode, setMode] = useState<ModePref>(DEFAULT_MODE);
  const [columns, setColumns] = useState<ColumnsPref>(DEFAULT_COLUMNS);
  const [delConfirm, setDelConfirm] =
    useState<DeleteConfirmPref>(DEFAULT_DELETE_CONFIRM);

  useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEYS.theme) as ThemeKey | null;
      const m = localStorage.getItem(STORAGE_KEYS.mode) as ModePref | null;
      const c = localStorage.getItem(STORAGE_KEYS.columns) as ColumnsPref | null;
      if (t) setTheme(t);
      if (m) setMode(m);
      if (c) setColumns(c);
      setDelConfirm(readDeleteConfirmPref());
    } catch {
      /* */
    }
  }, []);

  const onTheme = (t: ThemeKey) => {
    setTheme(t);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, t);
    } catch {
      /* */
    }
    applyThemeAndModeToHtml(t, mode);
  };
  const onMode = (m: ModePref) => {
    setMode(m);
    try {
      localStorage.setItem(STORAGE_KEYS.mode, m);
    } catch {
      /* */
    }
    applyThemeAndModeToHtml(theme, m);
  };
  const onDeleteConfirm = (v: DeleteConfirmPref) => {
    setDelConfirm(v);
    try {
      localStorage.setItem(STORAGE_KEYS.deleteConfirm, v);
      // 규칙을 바꾸면 "오늘 이미 물어봤음" 기록도 지워 새 규칙이 바로 적용되게 한다
      localStorage.removeItem(STORAGE_KEYS.deleteConfirmedOn);
    } catch {
      /* */
    }
  };

  const onColumns = (c: ColumnsPref) => {
    setColumns(c);
    try {
      localStorage.setItem(STORAGE_KEYS.columns, c);
    } catch {
      /* */
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] bg-(--color-surface) p-6 ring-1 ring-(--color-border-soft)">
      <div className="mb-4 text-base font-medium text-(--color-fg)">
        표시 설정
      </div>

      {/* 모드 */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
          모드
        </div>
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium transition",
                mode === m
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {m === "dark" ? (
                <Moon className="h-3.5 w-3.5" />
              ) : (
                <Sun className="h-3.5 w-3.5" />
              )}
              {m === "dark" ? "다크" : "라이트"}
            </button>
          ))}
        </div>
      </div>

      {/* 테마 */}
      <div className="mb-5">
        <div className="mb-2.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
          <Palette className="h-3 w-3" />
          테마
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTheme(t.key)}
              className={cn(
                "group relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition",
                theme === t.key
                  ? "bg-(--color-bg-2) ring-1 ring-(--color-accent)/60"
                  : "hover:bg-(--color-surface-hi)",
              )}
            >
              <div
                aria-hidden
                className="h-7 w-7 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                style={{ background: t.swatch }}
              />
              <span className="text-[10.5px] text-(--color-fg-2)">
                {t.label}
              </span>
              {theme === t.key && (
                <Check className="absolute top-1.5 right-1.5 h-2.5 w-2.5 text-(--color-accent-strong)" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 열 개수 */}
      <div className="mb-5">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
          메모함 열 개수
        </div>
        <div className="flex gap-1.5">
          {COLUMNS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColumns(c)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                columns === c
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {c === "auto" ? "Auto" : c}
            </button>
          ))}
        </div>
      </div>

      {/* 메모 삭제 확인 */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-(--color-fg-4)">
          메모 삭제 확인
        </div>
        <div className="flex gap-1.5">
          {DELETE_CONFIRM.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onDeleteConfirm(v)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-medium transition",
                delConfirm === v
                  ? "bg-(--color-accent-soft) text-(--color-accent-strong) ring-1 ring-(--color-accent)/40"
                  : "bg-(--color-bg-2) text-(--color-fg-3) ring-1 ring-(--color-border-soft) hover:bg-(--color-surface-hi)",
              )}
            >
              {DELETE_CONFIRM_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] break-keep text-(--color-fg-4)">
          지운 메모는 30일간 휴지통에 남으므로 <b>묻지 않음</b>도 안전합니다.
          메모함 삭제는 이 설정과 무관하게 항상 확인합니다.
        </p>
      </div>
    </section>
  );
}
