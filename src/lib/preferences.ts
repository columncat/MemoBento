/**
 * 클라이언트 사이드 표시 prefs — localStorage 에 보관.
 * (메모함별 리스트/그리드 보기는 서버 DB 에 저장되므로 여기 없음)
 */

export const THEMES = [
  { key: "forest", label: "Forest", swatch: "oklch(0.78 0.14 145)" },
  { key: "ocean", label: "Ocean", swatch: "oklch(0.78 0.14 220)" },
  { key: "sunset", label: "Sunset", swatch: "oklch(0.79 0.16 55)" },
  { key: "lavender", label: "Lavender", swatch: "oklch(0.80 0.13 295)" },
  { key: "mono", label: "Mono", swatch: "oklch(0.88 0.008 250)" },
  { key: "rose", label: "Rose", swatch: "oklch(0.79 0.15 15)" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];
export const DEFAULT_THEME: ThemeKey = "forest";

export const MODES = ["dark", "light"] as const;
export type ModePref = (typeof MODES)[number];
export const DEFAULT_MODE: ModePref = "dark";

/**
 * 메모함 그리드 열 개수. 위젯 윙이 없어 가로를 전부 쓸 수 있으므로 6단까지 연다.
 */
export const COLUMNS = ["auto", "1", "2", "3", "4", "5", "6"] as const;
export type ColumnsPref = (typeof COLUMNS)[number];
export const DEFAULT_COLUMNS: ColumnsPref = "auto";

export const STORAGE_KEYS = {
  theme: "memobento.theme",
  mode: "memobento.mode",
  columns: "memobento.columns",
} as const;

/**
 * 5·6단은 xl(1280px)에서 바로 펼치면 카드 폭이 250px 아래로 떨어져 헤더가 뭉갠다.
 * 그래서 xl 까지는 3단으로 두고 2xl(1536px) 이상에서만 선택한 단수로 펼친다.
 */
export const COLUMN_CLASS: Record<ColumnsPref, string> = {
  auto: "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  "1": "grid-cols-1",
  "2": "grid-cols-1 md:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  "4": "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
  "5": "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5",
  "6": "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6",
};

export function applyThemeAndModeToHtml(theme: ThemeKey, mode: ModePref) {
  const root = document.documentElement;
  Array.from(root.classList)
    .filter((c) => c.startsWith("theme-") || c.startsWith("mode-"))
    .forEach((c) => root.classList.remove(c));
  root.classList.add(`theme-${theme}`, `mode-${mode}`);
}
