export default function PaneFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[8rem] items-center justify-center bg-neutral-950 text-xs text-neutral-500">
      Loading {label}…
    </div>
  );
}
