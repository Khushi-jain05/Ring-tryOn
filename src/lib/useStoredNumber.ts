"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A number persisted in localStorage, read in a way that survives hydration.
 *
 * The obvious approach — `useState` plus an effect that loads the stored value —
 * renders the fallback first and then immediately re-renders, which React now
 * flags as a cascading render. `useSyncExternalStore` expresses the same thing
 * honestly: localStorage *is* an external store, with a distinct server
 * snapshot, and React can then read it without a wasted render pass.
 */
export function useStoredNumber(
  key: string,
  fallback: number,
): [number, (value: number) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      // `storage` only fires for other tabs, so same-tab writes notify manually.
      const handler = (event: Event) => {
        if (event instanceof StorageEvent && event.key !== null && event.key !== key) return;
        onChange();
      };
      window.addEventListener("storage", handler);
      window.addEventListener(`stored-number:${key}`, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(`stored-number:${key}`, handler);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }, [key, fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);

  const set = useCallback(
    (next: number) => {
      localStorage.setItem(key, String(next));
      window.dispatchEvent(new Event(`stored-number:${key}`));
    },
    [key],
  );

  return [value, set];
}
