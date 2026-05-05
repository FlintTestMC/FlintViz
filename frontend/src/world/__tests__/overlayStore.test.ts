import { beforeEach, describe, expect, it } from "vitest";

import { useOverlayStore } from "../overlayStore";

describe("useOverlayStore", () => {
  beforeEach(() => {
    useOverlayStore.setState({ cleanupVisible: true });
  });

  it("starts visible — cleanup region should be on by default", () => {
    expect(useOverlayStore.getState().cleanupVisible).toBe(true);
  });

  it("toggles cleanup visibility on each call", () => {
    const { toggleCleanup } = useOverlayStore.getState();
    toggleCleanup();
    expect(useOverlayStore.getState().cleanupVisible).toBe(false);
    toggleCleanup();
    expect(useOverlayStore.getState().cleanupVisible).toBe(true);
  });

  it("setCleanupVisible writes the explicit value", () => {
    const { setCleanupVisible } = useOverlayStore.getState();
    setCleanupVisible(false);
    expect(useOverlayStore.getState().cleanupVisible).toBe(false);
    setCleanupVisible(true);
    expect(useOverlayStore.getState().cleanupVisible).toBe(true);
  });
});
