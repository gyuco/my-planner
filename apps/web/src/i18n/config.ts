export type Locale = "en" | "it";

export const LOCALE_STORAGE_KEY = "my-planner-locale";
export const DEFAULT_LOCALE: Locale = "en";
export const SUPPORTED_LOCALES: Locale[] = ["en", "it"];

export const DATE_LOCALES: Record<Locale, string> = {
  en: "en-US",
  it: "it-IT",
};

export function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "it") return stored;
  } catch {
    /* ignore (SSR / storage non disponibile) */
  }
  return DEFAULT_LOCALE;
}
