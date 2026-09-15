import { useState } from "react";
import { saveToken } from "../auth";
import { useI18n } from "../i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

/**
 * Marchio del prodotto: tre colonne kanban stilizzate con altezze crescenti,
 * disegnate inline in SVG per evitare asset esterni (l'app gira anche offline).
 */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#5b5bd6" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="48" height="48" rx="14" fill="url(#brand-grad)" />
      <g fill="#fff">
        <rect x="10" y="26" width="7" height="12" rx="3.5" opacity="0.65" />
        <rect x="20.5" y="18" width="7" height="20" rx="3.5" opacity="0.85" />
        <rect x="31" y="10" width="7" height="28" rx="3.5" />
      </g>
    </svg>
  );
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? t.login.invalidCredentials);
        return;
      }
      saveToken(data.token);
      onLoggedIn();
    } catch {
      setError(t.login.cannotReachServer);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-language">
        <LanguageSwitcher />
      </div>
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-brand">
          <BrandMark />
          <h1>my-planner</h1>
          <p className="login-tagline">{t.login.tagline}</p>
        </div>
        <label>
          {t.login.username}
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label>
          {t.login.password}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? t.login.signingIn : t.login.signIn}
        </button>
      </form>
    </div>
  );
}
