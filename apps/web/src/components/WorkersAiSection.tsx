import { useState } from "react";
import { ApiRequestError, reindexSemanticSearch } from "../api";
import { useI18n } from "../i18n";
import { useAiFeatures } from "../lib/aiFeatures";

/**
 * Impostazioni → Workers AI (solo admin): ricostruisce l'indice della ricerca
 * semantica. Serve una volta dopo l'attivazione, per i task che esistevano
 * gia', o se la ricerca sembra non trovare task vecchi. Nascosta se il server
 * non ha Workers AI + Vectorize.
 */
export function WorkersAiSection() {
  const { t } = useI18n();
  const { semanticSearch } = useAiFeatures();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (!semanticSearch) return null;

  async function handleReindex() {
    setResult(null);
    setRunning(true);
    try {
      const res = await reindexSemanticSearch();
      setResult({ ok: true, message: t.semantic.reindexDone.replace("{count}", String(res.indexed)) });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiRequestError ? err.message : t.semantic.reindexError });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="settings-panel">
      <section className="drawer-section">
        <h3>{t.semantic.reindexSection}</h3>
        <p className="drawer-empty">{t.semantic.reindexHint}</p>
        <button type="button" onClick={handleReindex} disabled={running}>
          {running ? t.semantic.reindexRunning : t.semantic.reindex}
        </button>
        {result && <p className={result.ok ? "drawer-empty" : "login-error"}>{result.message}</p>}
      </section>
    </div>
  );
}
