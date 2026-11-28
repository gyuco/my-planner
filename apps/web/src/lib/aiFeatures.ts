import { useEffect, useState } from "react";
import type { AiFeatures } from "@my-planner/core";
import { getAiFeatures } from "../api";

/**
 * Funzioni Workers AI disponibili sul server (GET /ai/features): chiesta una
 * volta per sessione e condivisa tra i componenti. Finche' la risposta non
 * arriva sono tutte spente, cosi' i controlli non compaiono e spariscono.
 */

const NONE: AiFeatures = { semanticSearch: false, voiceNotes: false, standupSummary: false };

let cached: AiFeatures | null = null;
let pending: Promise<AiFeatures> | null = null;

function loadAiFeatures(): Promise<AiFeatures> {
  if (!pending) {
    pending = getAiFeatures().then(
      (features) => {
        cached = features;
        return features;
      },
      () => {
        // Errore (rete, server vecchio senza la route): tutto spento, ma si
        // riprova al prossimo componente che monta.
        pending = null;
        return NONE;
      },
    );
  }
  return pending;
}

export function useAiFeatures(): AiFeatures {
  const [features, setFeatures] = useState<AiFeatures>(cached ?? NONE);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    loadAiFeatures().then((f) => {
      if (alive) setFeatures(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return features;
}
