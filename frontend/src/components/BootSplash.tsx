export default function BootSplash({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
      {message}
    </div>
  );
}
