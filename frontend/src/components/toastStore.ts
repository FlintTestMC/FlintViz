// Lightweight toast channel for transient errors / status (#0033). Module-
// scope store so any caller can `showToast(...)` without prop-drilling a
// dispatcher; `<Toast />` renders the queue.

import { create } from "zustand";

export type ToastKind = "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const DEFAULT_TTL_MS = 6000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Public API. Auto-dismisses after `ttlMs` (set to 0 for sticky).
export function showToast(opts: {
  kind: ToastKind;
  message: string;
  ttlMs?: number;
}): number {
  const id = useToastStore.getState().push({
    kind: opts.kind,
    message: opts.message,
  });
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl > 0) {
    window.setTimeout(() => {
      useToastStore.getState().dismiss(id);
    }, ttl);
  }
  return id;
}
