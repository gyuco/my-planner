import { useEffect, useState } from "react";
import { DEFAULT_PRETRIAGE_MODEL, DEFAULT_VOICE_MODEL } from "@my-planner/core";
import {
  ApiRequestError,
  getVoiceSettings,
  testPretriageSettings,
  testVoiceSettings,
  updateVoiceSettings,
} from "../api";
import { useI18n } from "../i18n";

interface VoiceSettingsModalProps {
  onClose: () => void;
}

/** Voci predefinite di Gemini Live (vuoto = scelta del modello). */
const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];

type TestResult = { ok: boolean; message: string } | null;

/**
 * Impostazioni Gemini (solo admin): chiave Google AI Studio condivisa,
 * salvata cifrata sul server e mai rimandata al browser (si vede solo se e'
 * impostata); assistente vocale (Gemini Live) e pre-triage dei task, ognuno
 * con il suo interruttore e il suo modello.
 */
export function VoiceSettingsModal({ onClose }: VoiceSettingsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [model, setModel] = useState(DEFAULT_VOICE_MODEL);
  const [voiceName, setVoiceName] = useState("");
  const [pretriageEnabled, setPretriageEnabled] = useState(false);
  const [pretriageActive, setPretriageActive] = useState(false);
  const [pretriageModel, setPretriageModel] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [testingPretriage, setTestingPretriage] = useState(false);
  const [pretriageTestResult, setPretriageTestResult] = useState<TestResult>(null);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getVoiceSettings();
        setEnabled(settings.enabled);
        setConfigured(settings.configured);
        setApiKeySet(settings.apiKeySet);
        setModel(settings.model);
        setVoiceName(settings.voiceName ?? "");
        setPretriageEnabled(settings.pretriageEnabled);
        setPretriageActive(settings.pretriageEnabled && settings.apiKeySet);
        setPretriageModel(settings.pretriageModel === DEFAULT_PRETRIAGE_MODEL ? "" : settings.pretriageModel);
      } catch (err) {
        setLoadError(err instanceof ApiRequestError ? err.message : t.voiceSettings.loadError);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(extra: { removeApiKey?: boolean } = {}) {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateVoiceSettings({
        // Senza chiave nessuna delle due funzioni puo' restare attiva.
        enabled: extra.removeApiKey ? false : enabled,
        pretriageEnabled: extra.removeApiKey ? false : pretriageEnabled,
        apiKey: apiKey.trim() || undefined,
        model: model.trim() || undefined,
        voiceName: voiceName || null,
        pretriageModel: pretriageModel.trim(),
        ...extra,
      });
      setEnabled(updated.enabled);
      setConfigured(updated.configured);
      setApiKeySet(updated.apiKeySet);
      setPretriageEnabled(updated.pretriageEnabled);
      setPretriageActive(updated.pretriageEnabled && updated.apiKeySet);
      setPretriageModel(updated.pretriageModel === DEFAULT_PRETRIAGE_MODEL ? "" : updated.pretriageModel);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : t.voiceSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setTesting(true);
    try {
      const res = await testVoiceSettings();
      setTestResult({ ok: true, message: t.voiceSettings.testOk.replace("{model}", res.model) });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof ApiRequestError ? err.message : t.voiceSettings.testError });
    } finally {
      setTesting(false);
    }
  }

  async function handlePretriageTest() {
    setPretriageTestResult(null);
    setTestingPretriage(true);
    try {
      const res = await testPretriageSettings();
      setPretriageTestResult({ ok: true, message: t.voiceSettings.pretriageTestOk.replace("{model}", res.model) });
    } catch (err) {
      setPretriageTestResult({
        ok: false,
        message: err instanceof ApiRequestError ? err.message : t.voiceSettings.testError,
      });
    } finally {
      setTestingPretriage(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.voiceSettings.title}</h2>

        {loading ? (
          <p>{t.voiceSettings.loading}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {loadError && <p className="login-error">{loadError}</p>}

            <section className="drawer-section">
              <h3>{t.voiceSettings.keySection}</h3>
              <label>
                {t.voiceSettings.apiKeyLabel}
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeySet ? t.voiceSettings.apiKeySetPlaceholder : "AIza…"}
                  required={(enabled || pretriageEnabled) && !apiKeySet}
                />
              </label>
              <p className="drawer-empty">{t.voiceSettings.apiKeyHint}</p>
              {apiKeySet && (
                <button type="button" onClick={() => void save({ removeApiKey: true })} disabled={saving}>
                  {t.voiceSettings.removeKey}
                </button>
              )}
            </section>

            <section className="drawer-section">
              <h3>{t.voiceSettings.voiceSection}</h3>
              <label className="storage-backend-option">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                {t.voiceSettings.enabledLabel}
              </label>
              <p className="drawer-empty">
                {configured ? t.voiceSettings.statusActive : t.voiceSettings.statusInactive}
              </p>
              <p className="drawer-empty">{t.voiceSettings.hint}</p>
              <label>
                {t.voiceSettings.modelLabel}
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_VOICE_MODEL} />
              </label>
              <label>
                {t.voiceSettings.voiceLabel}
                <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
                  <option value="">{t.voiceSettings.voiceDefault}</option>
                  {VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <p className="drawer-empty">{t.voiceSettings.testHint}</p>
              <button type="button" onClick={handleTest} disabled={testing || !apiKeySet}>
                {testing ? t.voiceSettings.testing : t.voiceSettings.test}
              </button>
              {testResult && <p className={testResult.ok ? "drawer-empty" : "login-error"}>{testResult.message}</p>}
            </section>

            <section className="drawer-section">
              <h3>{t.voiceSettings.pretriageSection}</h3>
              <label className="storage-backend-option">
                <input
                  type="checkbox"
                  checked={pretriageEnabled}
                  onChange={(e) => setPretriageEnabled(e.target.checked)}
                />
                {t.voiceSettings.pretriageEnabledLabel}
              </label>
              <p className="drawer-empty">
                {pretriageActive ? t.voiceSettings.pretriageStatusActive : t.voiceSettings.statusInactive}
              </p>
              <p className="drawer-empty">{t.voiceSettings.pretriageHint}</p>
              <label>
                {t.voiceSettings.pretriageModelLabel}
                <input
                  value={pretriageModel}
                  onChange={(e) => setPretriageModel(e.target.value)}
                  placeholder={DEFAULT_PRETRIAGE_MODEL}
                />
              </label>
              <p className="drawer-empty">
                {t.voiceSettings.pretriageModelHint.replace("{model}", DEFAULT_PRETRIAGE_MODEL)}
              </p>
              <p className="drawer-empty">{t.voiceSettings.pretriageTestHint}</p>
              <button type="button" onClick={handlePretriageTest} disabled={testingPretriage || !apiKeySet}>
                {testingPretriage ? t.voiceSettings.testing : t.voiceSettings.pretriageTest}
              </button>
              {pretriageTestResult && (
                <p className={pretriageTestResult.ok ? "drawer-empty" : "login-error"}>{pretriageTestResult.message}</p>
              )}
            </section>

            {saveError && <p className="login-error">{saveError}</p>}

            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t.voiceSettings.close}
              </button>
              <button type="submit" disabled={saving}>
                {saving ? t.voiceSettings.saving : saved ? t.voiceSettings.saved : t.voiceSettings.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
