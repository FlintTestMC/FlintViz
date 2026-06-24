export function isFailureOrShareRoute(pathname: string, hash: string): boolean {
  return (
    pathname === "/failure" ||
    pathname.startsWith("/failure/") ||
    hash.startsWith("#/failure") ||
    hash.startsWith("#/share")
  );
}

export function isBlockGalleryDebugRoute(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "blocks";
}
