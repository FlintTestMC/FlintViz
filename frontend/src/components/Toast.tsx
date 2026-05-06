import { useToastStore } from "./toastStore";

// Single toast container — render once at the app root.
export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "pointer-events-auto flex items-start gap-2 rounded-md px-3 py-2 text-xs shadow-lg ring-1",
            t.kind === "error"
              ? "bg-red-950/90 text-red-100 ring-red-800/70"
              : "bg-neutral-900/90 text-neutral-100 ring-neutral-700",
          ].join(" ")}
        >
          <span className="flex-1 whitespace-pre-wrap break-words">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded px-1 text-neutral-400 hover:bg-black/30 hover:text-neutral-100"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
