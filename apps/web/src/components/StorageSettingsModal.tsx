import { useEffect, useState } from "react";
import type { StorageBackendType } from "@my-planner/core";
import { ApiRequestError, getStorageSettings, updateStorageSettings } from "../api";
import { useI18n } from "../i18n";

interface StorageSettingsModalProps {
  onClose: () => void;
}

export function StorageSettingsModal({ onClose }: StorageSettingsModalProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [backend, setBackend] = useState<StorageBackendType>("local");
  const [localDir, setLocalDir] = useState("./attachments/local");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKeyId, setS3AccessKeyId] = useState("");
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState("");
  const [secretAlreadySet, setSecretAlreadySet] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getStorageSettings();
        setBackend(settings.backend);
        setLocalDir(settings.localDir);
        setS3Endpoint(settings.s3Endpoint ?? "");
        setS3Bucket(settings.s3Bucket ?? "");
        setS3Region(settings.s3Region ?? "");
        setS3AccessKeyId(settings.s3AccessKeyId ?? "");
        setSecretAlreadySet(settings.s3SecretAccessKeySet);
      } catch (err) {
        setLoadError(err instanceof ApiRequestError ? err.message : t.storageSettings.loadError);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const updated = await updateStorageSettings({
        backend,
        localDir: backend === "local" ? localDir.trim() : undefined,
        s3Endpoint: s3Endpoint.trim() || null,
        s3Bucket: s3Bucket.trim() || null,
        s3Region: s3Region.trim() || null,
        s3AccessKeyId: s3AccessKeyId.trim() || null,
        s3SecretAccessKey: s3SecretAccessKey.trim() || undefined,
      });
      setSecretAlreadySet(updated.s3SecretAccessKeySet);
      setS3SecretAccessKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : t.storageSettings.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.storageSettings.title}</h2>

        {loading ? (
          <p>{t.storageSettings.loading}</p>
        ) : (
          <form onSubmit={handleSave}>
            <section className="drawer-section">
              <h3>{t.storageSettings.backendLabel}</h3>
              {loadError && <p className="login-error">{loadError}</p>}
              <label className="storage-backend-option">
                <input
                  type="radio"
                  name="storage-backend"
                  value="local"
                  checked={backend === "local"}
                  onChange={() => setBackend("local")}
                />
                {t.storageSettings.backendLocal}
              </label>
              <label className="storage-backend-option">
                <input
                  type="radio"
                  name="storage-backend"
                  value="s3"
                  checked={backend === "s3"}
                  onChange={() => setBackend("s3")}
                />
                {t.storageSettings.backendS3}
              </label>
            </section>

            {backend === "local" && (
              <section className="drawer-section">
                <h3>{t.storageSettings.localSection}</h3>
                <label>
                  {t.storageSettings.localDirLabel}
                  <input value={localDir} onChange={(e) => setLocalDir(e.target.value)} required />
                </label>
              </section>
            )}

            {backend === "s3" && (
              <section className="drawer-section">
                <h3>{t.storageSettings.s3Section}</h3>
                <p className="drawer-empty">{t.storageSettings.s3Hint}</p>
                <label>
                  {t.storageSettings.s3EndpointLabel}
                  <input
                    value={s3Endpoint}
                    onChange={(e) => setS3Endpoint(e.target.value)}
                    placeholder="http://localhost:9000"
                  />
                </label>
                <label>
                  {t.storageSettings.s3BucketLabel}
                  <input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} required />
                </label>
                <label>
                  {t.storageSettings.s3RegionLabel}
                  <input value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" />
                </label>
                <label>
                  {t.storageSettings.s3AccessKeyLabel}
                  <input value={s3AccessKeyId} onChange={(e) => setS3AccessKeyId(e.target.value)} />
                </label>
                <label>
                  {t.storageSettings.s3SecretKeyLabel}
                  <input
                    type="password"
                    value={s3SecretAccessKey}
                    onChange={(e) => setS3SecretAccessKey(e.target.value)}
                    placeholder={secretAlreadySet ? t.storageSettings.secretUnchangedPlaceholder : ""}
                  />
                </label>
              </section>
            )}

            {saveError && <p className="login-error">{saveError}</p>}

            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                {t.storageSettings.close}
              </button>
              <button type="submit" disabled={saving}>
                {saving ? t.storageSettings.saving : saved ? t.storageSettings.saved : t.storageSettings.save}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
