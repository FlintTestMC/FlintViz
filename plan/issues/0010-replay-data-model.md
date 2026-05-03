# 0010 — Replay data model

**Milestone:** M3
**Depends on:** #0008

## Goal
Define the serializable types the replay engine produces. No logic yet — just types and serde.

## Outcome
```rust
pub struct Replay {
    pub name: String,
    pub cleanup_region: Option<Aabb>,
    pub initial_player: PlayerSnapshot,
    pub max_tick: u32,
    pub frames: Vec<TickFrame>,
    pub breakpoints: Vec<u32>,
    pub source_map: Vec<SourceSpan>, // populated in #0016
}

pub struct TickFrame {
    pub tick: u32,
    pub actions: Vec<ActionEvent>,
    pub block_diff: Vec<BlockChange>,
    pub inventory_diff: Option<PlayerDelta>,
    pub assertions: Vec<AssertionView>,
}

pub enum BlockChange { Set { pos, block }, Remove { pos } }
pub struct AssertionView { pub kind, pub expected, pub position }
pub struct PlayerDelta { /* slot deltas, hotbar selection, gamemode */ }
pub struct PlayerSnapshot { /* full player state at tick 0 */ }
pub struct SourceSpan { pub tick, pub event_index, pub json_pointer: String }
pub struct Aabb { pub min: [i32;3], pub max: [i32;3] }
```
- All types `Serialize`/`Deserialize`/`Debug`.
- `pub use` from a single module so the API layer can import cleanly.

## Implementation notes
- Reuse `flint_core::test_spec::Block`, `Item`, `PlayerSlot` — don't redefine them.
- Frames only emitted for ticks that have at least one action or assertion (sparse).

## Files
- `crates/flint-viz/src/replay/mod.rs` (new)
- `crates/flint-viz/src/replay/model.rs` (new)
