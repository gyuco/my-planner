import { useEffect, useState } from "react";
import type { AuthUser, Project } from "@my-planner/core";
import { ApiRequestError, updateMyProfile } from "../api";
import { useI18n } from "../i18n";
import { displayName, userInitials } from "../lib/user";

interface ProfilePageProps {
  user: AuthUser;
  /** Progetti visibili all'utente: tutti per l'admin, solo gli assegnati per il manager. */
  projects: Project[];
  onBack: () => void;
  onUserUpdated: (user: AuthUser) => void;
}

/**
 * Pagina profilo dell'utente loggato: anagrafica (nome, cognome), ruolo,
 * progetti associati e modifica self-service di nome, cognome ed email.
 */
export function ProfilePage({ user, projects, onBack, onUserUpdated }: ProfilePageProps) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Se l'utente cambia (refresh sessione, modifica dal pannello admin) i campi
  // tornano a riflettere i valori persistiti.
  useEffect(() => {
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setEmail(user.email);
  }, [user.firstName, user.lastName, user.email]);

  const isAdmin = user.role === "admin";
  const trimmedFirstName = firstName.trim();
  const trimmedLastName = lastName.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const unchanged =
    trimmedFirstName === user.firstName.trim() &&
    trimmedLastName === user.lastName.trim() &&
    trimmedEmail === user.email.trim().toLowerCase();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t.profile.invalidEmail);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateMyProfile({
        email: trimmedEmail,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
      });
      onUserUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t.profile.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-page">
      <button type="button" className="profile-back" onClick={onBack}>
        ← {t.profile.backToBoard}
      </button>

      <div className="profile-card">
        <div className="profile-head">
          <div className="profile-avatar" aria-hidden="true">
            {userInitials(user)}
          </div>
          <div className="profile-identity">
            <h2>{displayName(user)}</h2>
            {(!user.firstName.trim() || !user.lastName.trim()) && (
              <p className="profile-hint">{t.profile.missingName}</p>
            )}
          </div>
        </div>

        <div className="profile-facts">
          <div className="profile-fact">
            <span className="field-label">{t.profile.role}</span>
            <span className={`role-badge role-${user.role}`}>
              {user.role === "admin" ? t.users.roleAdmin : t.users.roleManager}
            </span>
          </div>
        </div>

        <div className="profile-section">
          <span className="field-label">{t.profile.associatedProjects}</span>
          {isAdmin && <p className="profile-hint">{t.profile.allProjectsAccess}</p>}
          {projects.length === 0 ? (
            <p className="profile-hint">{t.profile.noProjects}</p>
          ) : (
            <div className="profile-projects">
              {projects.map((project) => (
                <span key={project.id} className="profile-project-chip">
                  {project.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <form className="profile-section" onSubmit={handleSubmit}>
          <span className="field-label">{t.profile.personalData}</span>
          <div className="profile-name-row">
            <label className="profile-field">
              {t.profile.firstName}
              <input
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  setSaved(false);
                }}
                autoComplete="given-name"
                maxLength={100}
              />
            </label>
            <label className="profile-field">
              {t.profile.lastName}
              <input
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  setSaved(false);
                }}
                autoComplete="family-name"
                maxLength={100}
              />
            </label>
          </div>

          <span className="field-label profile-subsection">{t.profile.emailTitle}</span>
          <label className="profile-field">
            {t.profile.emailLabel}
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSaved(false);
              }}
              autoComplete="email"
              required
              maxLength={200}
            />
          </label>
          <p className="profile-hint">{t.profile.emailHint}</p>
          {error && <p className="login-error">{error}</p>}
          {saved && <p className="profile-saved">{t.profile.saved}</p>}
          <div className="profile-actions">
            <button type="submit" disabled={saving || unchanged}>
              {saving ? t.profile.saving : t.profile.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
