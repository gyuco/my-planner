import { SUPPORTED_LOCALES, type Locale } from "../i18n/config";
import { useI18n } from "../i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="language-switcher" title={t.language.label}>
      <span className="language-switcher-label" aria-hidden="true">
        🌐
      </span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t.language.label}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
