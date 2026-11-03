import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const TOAST_DURATION_MS = 3200;
/** Stesso messaggio entro questa finestra = un solo toast (es. piu' blur di fila). */
const DEDUPE_WINDOW_MS = 800;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const lastShown = useRef<{ key: string; at: number } | null>(null);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const key = `${kind}:${message}`;
      const now = Date.now();
      if (lastShown.current && lastShown.current.key === key && now - lastShown.current.at < DEDUPE_WINDOW_MS) {
        return;
      }
      lastShown.current = { key, at: now };
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message) => show(message, "success"),
      error: (message) => show(message, "error"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <span className="toast-icon" aria-hidden="true">
              {toast.kind === "success" ? "✓" : toast.kind === "error" ? "!" : "i"}
            </span>
            <span className="toast-message">{toast.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="×">
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve essere usato dentro <ToastProvider>");
  return ctx;
}
