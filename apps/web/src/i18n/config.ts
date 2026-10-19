export type Locale = "en" | "it" | "es";

export const LOCALE_STORAGE_KEY = "my-planner-locale";
export const DEFAULT_LOCALE: Locale = "en";
export const SUPPORTED_LOCALES: Locale[] = ["en", "it", "es"];

export const DATE_LOCALES: Record<Locale, string> = {
  en: "en-US",
  it: "it-IT",
  es: "es-ES",
};

export function getStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) return stored as Locale;
  } catch {
    /* ignore (SSR / storage non disponibile) */
  }
  return DEFAULT_LOCALE;
}
