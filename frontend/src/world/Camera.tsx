import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Camera as ThreeCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { useReplayStore } from "../store/replay";
import { computeFraming, type Framing } from "./cameraFraming";
import { useCameraStore } from "./cameraStore";

// Shared handle for the main R3F camera so overlay canvases (separate R3F
// trees, e.g. CompassGizmo) can read its quaternion in useFrame without going
// through a store. Read-only outside this file.
export let mainCameraRef: ThreeCamera | null = null;

// Per-frame lerp rate. With `t = 1 - exp(-RATE * dt)` and RATE ≈ 6, a 0.4 s
// transition reaches ~91 % of its target — matches the "about 400 ms" feel
// called out in #0031 for fly-to.
const ANIM_RATE = 6;

// Distance at which we consider an animation settled and stop lerping. Below
// this, continued lerping would just fight the user's OrbitControls input.
const SETTLE_EPSILON = 0.001;

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

  useEffect(() => {
    mainCameraRef = camera;
    return () => {
      mainCameraRef = null;
    };
  }, [camera]);

  const cleanup = useReplayStore((s) => s.replay?.cleanup_region ?? null);
  const worldState = useReplayStore((s) => s.worldState);
  const testId = useReplayStore((s) => s.testId);

  const desiredTarget = useRef(new Vector3(0, 0, 0));
  const desiredPosition = useRef(new Vector3(6, 6, 6));
  // Active flags: we only lerp while these are true. Each turns off once the
  // value has converged on its desired target so OrbitControls input (rotate,
  // pan, zoom) isn't dragged back every frame.
  const targetActive = useRef(false);
  const positionActive = useRef(false);

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
    targetActive.current = true;
    positionActive.current = true;
  }, [framing, testId]);

  // Any direct user interaction with OrbitControls (rotate / pan / zoom) wins
  // over an in-flight animation. Without this, dragging to rotate during an
  // auto-frame lerp results in the camera snapping back toward the framed
  // pose as soon as you let go.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onStart = () => {
      targetActive.current = false;
      positionActive.current = false;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, []);

  useEffect(() => {
    return useCameraStore.subscribe((state, prev) => {
      if (state.resetToken !== prev.resetToken) {
        const f = framingRef.current;
        if (f) {
          desiredTarget.current.set(...f.target);
          desiredPosition.current.set(...f.position);
          targetActive.current = true;
          positionActive.current = true;
        }
      }
      if (
        state.flyToToken !== prev.flyToToken &&
        state.flyToTarget
      ) {
        desiredTarget.current.set(...state.flyToTarget);
        targetActive.current = true;
        positionActive.current = false;
      }
    });
  }, []);

  useFrame((_state, dt) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const t = 1 - Math.exp(-ANIM_RATE * dt);
    if (targetActive.current) {
      controls.target.lerp(desiredTarget.current, t);
      if (controls.target.distanceToSquared(desiredTarget.current) < SETTLE_EPSILON * SETTLE_EPSILON) {
        controls.target.copy(desiredTarget.current);
        targetActive.current = false;
      }
    }
    if (positionActive.current) {
      camera.position.lerp(desiredPosition.current, t);
      if (camera.position.distanceToSquared(desiredPosition.current) < SETTLE_EPSILON * SETTLE_EPSILON) {
        camera.position.copy(desiredPosition.current);
        positionActive.current = false;
      }
    }
    controls.update();
  });

  return <OrbitControls ref={controlsRef} makeDefault />;
}
