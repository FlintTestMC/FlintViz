# 0031 — Assertion panel

**Milestone:** M6
**Depends on:** #0018, #0024

## Goal
List all assertions at the current tick in a side panel, with click-to-fly camera behavior.

## Outcome
- Each row: kind icon (block/inventory/other), summary text ("expect stone @ (0,100,0)"), and a "📍" button.
- Clicking 📍 on a block assertion flies the camera to that position.
- Inventory assertions highlight the relevant slot in the inventory panel.
- Empty state when no assertions at this tick.

## Implementation notes
- "Fly to" is a smooth lerp of the OrbitControls target; about 400 ms feels right.

## Files
- `frontend/src/panels/Assertions.tsx`
- `frontend/src/world/cameraFlyTo.ts`
