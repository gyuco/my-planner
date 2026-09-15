import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DATE_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  getStoredLocale,
  type Locale,
} from "./config";
import { en, type Dictionary } from "./en";
import { it } from "./it";

const dictionaries: Record<Locale, Dictionary> = { en, it };

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
  /** Locale BCP-47 da usare per toLocaleDateString/toLocaleString (en-US / it-IT). */
  dateLocale: string;
  formatDate: (iso: string | null | undefined) => string;
  formatDateTime: (iso: string | null | undefined) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Messaggi API fuori dal tree React: leggono la lingua salvata (default inglese). */
export function getApiLocale(): Locale {
  return getStoredLocale();
}

export function apiErrorMessage(status: number): string {
  return getApiLocale() === "it" ? `Errore ${status}` : `Error ${status}`;
}

export function apiDownloadErrorMessage(status: number): string {
  return getApiLocale() === "it"
    ? `Errore ${status} durante il download`
    : `Error ${status} during download`;
}

export function apiSessionExpiredMessage(): string {
  return dictionaries[getApiLocale()].api.sessionExpired;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window === "undefined" ? DEFAULT_LOCALE : getStoredLocale(),
  );

  useEffect(() => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const t = dictionaries[locale];
    const dateLocale = DATE_LOCALES[locale];
    const formatDate = (iso: string | null | undefined) => {
      if (!iso) return "";
      return new Date(iso).toLocaleDateString(dateLocale);
    };
    const formatDateTime = (iso: string | null | undefined) => {
      if (!iso) return "";
      return new Date(iso).toLocaleString(dateLocale);
    };
    return { locale, setLocale, t, dateLocale, formatDate, formatDateTime };
  }, [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n deve essere usato dentro <LanguageProvider>");
  return ctx;
}
