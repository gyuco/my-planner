import { useEffect, useState } from "react";
import { getVoiceStatus } from "../api";
import { useI18n } from "../i18n";
import { MicIcon } from "./Icons";

interface VoiceAssistantButtonProps {
  active: boolean;
  onOpen: () => void;
}

/**
 * Pulsante microfono nella topbar: apre l'assistente a schermo intero.
 * Solo per gli admin, e solo se l'assistente e' configurato.
 */
export function VoiceAssistantButton({ active, onOpen }: VoiceAssistantButtonProps) {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    getVoiceStatus()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  return (
    <button
      type="button"
      className={`topbar-icon-btn voice-button${active ? " active" : ""}`}
      onClick={onOpen}
      aria-label={t.assistant.open}
      title={t.assistant.open}
    >
      <MicIcon />
    </button>
  );
}
