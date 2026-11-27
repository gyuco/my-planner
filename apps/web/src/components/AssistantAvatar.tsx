import { useEffect, useRef } from "react";
import type { VoicePhase } from "../lib/voice/liveSession";

interface AssistantAvatarProps {
  phase: VoicePhase;
  /** Volumi correnti (0..1): voce dell'assistente e microfono. Letti a ogni frame. */
  levels: () => { output: number; input: number };
}

/**
 * Sagoma dell'assistente: la bocca e l'alone seguono la voce del modello,
 * l'anello esterno il microfono. I livelli sono applicati come variabili CSS
 * direttamente sul nodo (niente re-render React a 60 fps).
 */
export function AssistantAvatar({ phase, levels }: AssistantAvatarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  useEffect(() => {
    let frame = 0;
    let out = 0;
    let inp = 0;
    const tick = () => {
      const { output, input } = levelsRef.current();
      // Smorzamento: movimenti morbidi invece di scatti a ogni blocco audio.
      out += (output - out) * (output > out ? 0.5 : 0.18);
      inp += (input - inp) * (input > inp ? 0.5 : 0.15);
      const el = ref.current;
      if (el) {
        el.style.setProperty("--out", out.toFixed(3));
        el.style.setProperty("--in", inp.toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div ref={ref} className={`assistant-avatar assistant-avatar-${phase}`} aria-hidden="true">
      <div className="assistant-avatar-aura" />
      <div className="assistant-avatar-aura assistant-avatar-aura-2" />
      <div className="assistant-avatar-ring" />
      <svg className="assistant-avatar-figure" viewBox="0 0 200 200">
        <defs>
          <linearGradient id="assistant-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-500)" />
            <stop offset="100%" stopColor="var(--accent-700)" />
          </linearGradient>
          <clipPath id="assistant-clip">
            <circle cx="100" cy="100" r="92" />
          </clipPath>
        </defs>
        <circle cx="100" cy="100" r="92" className="assistant-avatar-bg" />
        <g clipPath="url(#assistant-clip)">
          {/* Spalle e collo */}
          <path d="M28 205 C30 158 62 140 100 140 C138 140 170 158 172 205 Z" fill="url(#assistant-fill)" />
          <rect x="88" y="112" width="24" height="34" rx="10" fill="var(--accent-600)" />
          {/* Testa */}
          <ellipse cx="100" cy="84" rx="36" ry="41" fill="url(#assistant-fill)" />
          {/* Viso */}
          <g className="assistant-avatar-eyes">
            <ellipse cx="86" cy="80" rx="4" ry="5" />
            <ellipse cx="114" cy="80" rx="4" ry="5" />
          </g>
          <ellipse className="assistant-avatar-mouth" cx="100" cy="104" rx="9" ry="6" />
        </g>
      </svg>
    </div>
  );
}
