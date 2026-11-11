import { useEffect, useState } from "react";

/**
 * Su schermi stretti o dispositivi touch il drag & drop della board e'
 * scomodo (si attiva scorrendo la pagina): li' le card si spostano dal menu
 * "Sposta in…" invece che trascinandole.
 */
const QUERY = "(max-width: 700px), (pointer: coarse)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

export function useTouchBoard(): boolean {
  const [touch, setTouch] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setTouch(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return touch;
}
