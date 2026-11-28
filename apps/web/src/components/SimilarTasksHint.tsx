import { useEffect, useState } from "react";
import type { SemanticTaskMatch } from "@my-planner/core";
import { findSimilarTasks } from "../api";
import { useI18n } from "../i18n";
import { useAiFeatures } from "../lib/aiFeatures";
import { projectPath } from "../lib/routes";

/** Pausa dopo l'ultima battuta prima di chiedere i duplicati. */
const DEBOUNCE_MS = 700;
/** Sotto questa lunghezza il titolo e' troppo generico per un confronto utile. */
const MIN_TITLE_CHARS = 6;

interface SimilarTasksHintProps {
  projectId: string;
  title: string;
  description: string;
  /** Task in modifica, da non segnalare come duplicato di se stesso. */
  excludeTaskId?: string;
}

/**
 * Avviso non bloccante di possibili duplicati mentre si scrive un task:
 * ricerca semantica (Workers AI + Vectorize) nello stesso progetto. Non
 * mostra nulla se la funzione non e' disponibile o non ci sono match.
 */
export function SimilarTasksHint({ projectId, title, description, excludeTaskId }: SimilarTasksHintProps) {
  const { t } = useI18n();
  const { semanticSearch } = useAiFeatures();
  const [matches, setMatches] = useState<SemanticTaskMatch[]>([]);

  useEffect(() => {
    const trimmed = title.trim();
    if (!semanticSearch || trimmed.length < MIN_TITLE_CHARS) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      findSimilarTasks(projectId, { title: trimmed, description: description.trim() || undefined, excludeTaskId }, controller.signal)
        .then(setMatches)
        // Best-effort: un errore (quota, rete) non deve disturbare la scrittura.
        .catch(() => {
          if (!controller.signal.aborted) setMatches([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [semanticSearch, projectId, title, description, excludeTaskId]);

  if (matches.length === 0) return null;

  const statusLabel: Record<string, string> = {
    draft: t.board.draft,
    todo: t.board.todo,
    in_progress: t.board.inProgress,
    testing: t.board.testing,
    done: t.board.done,
  };

  return (
    <div className="similar-tasks" role="status">
      <strong className="similar-tasks-title">{t.semantic.similarTitle}</strong>
      <span className="similar-tasks-hint">{t.semantic.similarHint}</span>
      <ul>
        {matches.map((m) => (
          <li key={m.taskId}>
            <a href={`${projectPath(m.projectId)}?task=${encodeURIComponent(m.taskId)}`} target="_blank" rel="noreferrer">
              {m.title}
            </a>
            <span className="similar-tasks-meta">
              {statusLabel[m.status] ?? m.status} · {t.semantic.similarScore.replace("{score}", String(Math.round(m.score * 100)))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
