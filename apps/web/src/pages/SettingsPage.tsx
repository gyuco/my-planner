import type { Project } from "@my-planner/core";
import { useI18n } from "../i18n";
import { SETTINGS_TABS, type SettingsTab } from "../lib/routes";
import { UsersPanel } from "../components/UsersPanel";
import { GeminiSettingsPanel } from "../components/GeminiSettingsPanel";
import { WorkersAiSection } from "../components/WorkersAiSection";
import { EmailSettingsPanel } from "../components/EmailSettingsPanel";
import { StorageSettingsPanel } from "../components/StorageSettingsPanel";

interface SettingsPageProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  currentUserId: string;
  projects: Project[];
  /** Utenti modificati: ricarica sessione e progetti. */
  onUsersChanged: () => void;
  /** Impostazioni Gemini salvate: aggiorna il pulsante dell'assistente. */
  onGeminiSaved: () => void;
}

/**
 * Impostazioni globali (solo admin) in un'unica pagina a tab, raggiungibile
 * da /settings/:tab: utenti, Gemini (assistente vocale e pre-triage), email,
 * storage allegati. Il tab sta nell'URL, cosi' si puo' linkare direttamente.
 */
export function SettingsPage({
  tab,
  onTabChange,
  currentUserId,
  projects,
  onUsersChanged,
  onGeminiSaved,
}: SettingsPageProps) {
  const { t } = useI18n();
  const labels: Record<SettingsTab, string> = {
    users: t.settings.tabUsers,
    gemini: t.settings.tabGemini,
    email: t.settings.tabEmail,
    storage: t.settings.tabStorage,
  };

  return (
    <>
      <div className="view-tabs" role="tablist" aria-label={t.settings.title}>
        {SETTINGS_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`settings-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="settings-tabpanel"
            className={`view-tab${tab === key ? " active" : ""}`}
            onClick={() => onTabChange(key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <div className="settings-page" role="tabpanel" id="settings-tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <div className="settings-page-content">
          <h2 className="settings-page-title">{labels[tab]}</h2>
          {tab === "users" && (
            <UsersPanel currentUserId={currentUserId} projects={projects} onChanged={onUsersChanged} />
          )}
          {tab === "gemini" && (
            <>
              <GeminiSettingsPanel onSaved={onGeminiSaved} />
              <WorkersAiSection />
            </>
          )}
          {tab === "email" && <EmailSettingsPanel />}
          {tab === "storage" && <StorageSettingsPanel />}
        </div>
      </div>
    </>
  );
}
