import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Hält ein Element nach dem Schließen noch kurz im DOM, damit es ausblenden kann.
 * `state` ist 'open' oder 'closing'; als data-state gesetzt, greift die Ausblend-Animation im CSS.
 */
export function usePresence(open: boolean, ms = 160): { mounted: boolean; state: 'open' | 'closing' } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setMounted(false), reduce ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, state: open ? 'open' : 'closing' };
}

/** Wechselt das Design mit kurzem Farbübergang statt hartem Umspringen. */
export function withThemeTransition(apply: () => void): void {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  apply();
  window.setTimeout(() => root.classList.remove('theme-switching'), 400);
}

/* ---------------- Meldungen ---------------- */

export interface ToastInput {
  text: string;
  action?: { label: string; run: () => void };
  /** Anzeigedauer in ms; mit Aktion länger, damit man sie erwischt. */
  ms?: number;
}

interface Toast extends ToastInput {
  id: number;
  closing: boolean;
}

const ToastContext = createContext<(t: ToastInput) => void>(() => undefined);

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      // Höchstens drei gleichzeitig; die älteste weicht.
      setToasts((ts) => [...ts.slice(-2), { ...input, id, closing: false }]);
      setTimeout(() => dismiss(id), input.ms ?? (input.action ? 6000 : 3200));
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-state={t.closing ? 'closing' : 'open'} data-testid="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
