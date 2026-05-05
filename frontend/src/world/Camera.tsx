import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useReplayStore } from "../store/replay";
import { computeFraming, type Framing } from "./cameraFraming";
import { useCameraStore } from "./cameraStore";

// Per-frame lerp rate. With `t = 1 - exp(-RATE * dt)` and RATE ≈ 6, a 0.4 s
// transition reaches ~91 % of its target — matches the "about 400 ms" feel
// called out in #0031 for fly-to.
const ANIM_RATE = 6;

// Owns OrbitControls and the camera-framing state machine.
//
// Auto-frame: on test load, lerp camera + target to fit the cleanup region
// (or block bounds when no cleanup region is defined). Subsequent edits to
// `worldState` do *not* re-frame — auto-framing yanks the user out of any
// view they've manually set, so we only re-frame on explicit signals (new
// test, Reset View).
//
// Reset View: re-runs auto-framing against the current replay.
//
// Fly-to: lerps only the orbit target, preserving the user's current
// camera angle and distance (the published handoff for #0031).
export default function Camera() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);

  const cleanup = useReplayStore((s) => s.replay?.cleanup_region ?? null);
  const worldState = useReplayStore((s) => s.worldState);
  const testId = useReplayStore((s) => s.testId);

  const desiredTarget = useRef(new Vector3(0, 0, 0));
  const desiredPosition = useRef(new Vector3(6, 6, 6));
  // Whether the next animation step should also lerp camera.position.
  // `false` for fly-to (target-only); `true` for reset / auto-frame.
  const animatePosition = useRef(false);

  const framing = useMemo<Framing | null>(
    () => computeFraming(cleanup, worldState),
    [cleanup, worldState],
  );

  // Hold the latest framing in a ref so the Reset View handler can read the
  // freshest value without re-binding the subscription on every change.
  const framingRef = useRef<Framing | null>(framing);
  framingRef.current = framing;

  // Auto-frame once per test. Re-arms when `testId` changes; `framing` going
  // from null to non-null on the same test (e.g. world hadn't populated yet)
  // also triggers a single frame so empty worlds settle before snapping.
  const lastFramedTestId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!framing) return;
    if (lastFramedTestId.current === testId) return;
    lastFramedTestId.current = testId;
    desiredTarget.current.set(...framing.target);
    desiredPosition.current.set(...framing.position);
    animatePosition.current = true;
  }, [framing, testId]);

  useEffect(() => {
    return useCameraStore.subscribe((state, prev) => {
      if (state.resetToken !== prev.resetToken) {
        const f = framingRef.current;
        if (f) {
          desiredTarget.current.set(...f.target);
          desiredPosition.current.set(...f.position);
          animatePosition.current = true;
        }
      }
      if (
        state.flyToToken !== prev.flyToToken &&
        state.flyToTarget
      ) {
        desiredTarget.current.set(...state.flyToTarget);
        animatePosition.current = false;
      }
    });
  }, []);

  useFrame((_state, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const t = 1 - Math.exp(-ANIM_RATE * dt);
    controls.target.lerp(desiredTarget.current, t);
    if (animatePosition.current) {
      camera.position.lerp(desiredPosition.current, t);
    }
    controls.update();
  });

  return <OrbitControls ref={controlsRef} makeDefault />;
}
