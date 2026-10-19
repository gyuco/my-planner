import { SUPPORTED_LOCALES, type Locale } from "../i18n/config";
import { useI18n } from "../i18n";
import { GlobeIcon } from "./Icons";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="language-switcher" title={t.language.label}>
      <GlobeIcon className="language-switcher-icon" />
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
