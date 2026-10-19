import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityLogItem } from "@my-planner/core";
import { getActivity, type ActivityQuery } from "../api";

const MAX_POLL_BATCH = 200;

interface ActivityFeedOptions {
  /** Polling dei nuovi eventi attivo (solo con tab visibile). */
  live: boolean;
  intervalMs: number;
  pageSize?: number;
  /** Messaggio mostrato quando una richiesta fallisce. */
  errorMessage: string;
}

export interface ActivityFeed {
  items: ActivityLogItem[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMore: () => void;
  /** Recupera subito gli eventi nuovi (es. dopo un'azione dell'utente). */
  pollNow: () => void;
}

/**
 * Log attivita' "in tempo reale": prima pagina al cambio filtri, poi polling
 * con `afterId` (solo eventi nuovi, merge in testa) e paginazione all'indietro
 * con `beforeId`. Come per le notifiche niente SSE/WebSocket: il backend gira
 * anche su Workers/D1.
 *
 * Ogni cambio di filtri incrementa `generation`: le risposte arrivate per i
 * filtri precedenti vengono scartate invece di mescolarsi alla nuova lista.
 */
export function useActivityFeed(query: ActivityQuery, options: ActivityFeedOptions): ActivityFeed {
  const { live, intervalMs, pageSize = 50, errorMessage } = options;
  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = JSON.stringify(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  const generation = useRef(0);
  const latestId = useRef(0);
  const oldestId = useRef<number | null>(null);
  const polling = useRef(false);
  // Il polling parte solo dopo la prima pagina: con latestId ancora a 0
  // scaricherebbe di nuovo gli stessi eventi in parallelo.
  const ready = useRef(false);

  useEffect(() => {
    const gen = ++generation.current;
    latestId.current = 0;
    oldestId.current = null;
    ready.current = false;
    setItems([]);
    setHasMore(false);
    setLoading(true);
    setError(null);
    getActivity({ ...queryRef.current, limit: pageSize })
      .then((res) => {
        if (gen !== generation.current) return;
        setItems(res.items);
        setHasMore(res.hasMore);
        latestId.current = res.items[0]?.id ?? 0;
        oldestId.current = res.items[res.items.length - 1]?.id ?? null;
      })
      .catch(() => {
        if (gen === generation.current) setError(errorMessage);
      })
      .finally(() => {
        if (gen !== generation.current) return;
        // Anche dopo un errore: il polling (afterId 0) ricarica la lista.
        ready.current = true;
        setLoading(false);
      });
  }, [queryKey, pageSize, errorMessage]);

  const pollNow = useCallback(async () => {
    if (polling.current || !ready.current) return;
    polling.current = true;
    const gen = generation.current;
    try {
      const res = await getActivity({ ...queryRef.current, afterId: latestId.current, limit: MAX_POLL_BATCH });
      if (gen !== generation.current || res.items.length === 0) return;
      latestId.current = res.items[0].id;
      if (oldestId.current === null) oldestId.current = res.items[res.items.length - 1].id;
      setItems((prev) => {
        const known = new Set(prev.map((i) => i.id));
        return [...res.items.filter((i) => !known.has(i.id)), ...prev];
      });
      setError(null);
    } catch {
      if (gen === generation.current) setError(errorMessage);
    } finally {
      polling.current = false;
    }
  }, [errorMessage]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") pollNow();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") pollNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [live, intervalMs, pollNow, queryKey]);

  const loadMore = useCallback(async () => {
    if (oldestId.current === null) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const res = await getActivity({ ...queryRef.current, beforeId: oldestId.current, limit: pageSize });
      if (gen !== generation.current) return;
      setItems((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
      if (res.items.length > 0) oldestId.current = res.items[res.items.length - 1].id;
    } catch {
      if (gen === generation.current) setError(errorMessage);
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [pageSize, errorMessage]);

  return { items, hasMore, loading, loadingMore, error, loadMore, pollNow };
}
