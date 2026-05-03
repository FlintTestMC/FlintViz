//! Replay engine: turn a static `TestSpec` into per-tick world + player state.
//!
//! M3 surface lives here. This issue (#0010) introduces only the data model;
//! engine logic lands in #0011–#0016.

pub mod model;

#[allow(unused_imports)] // re-exported for the engine modules landing in #0011+.
pub use model::{
    Aabb, ActionEvent, AssertionView, BlockChange, GameModeChange, HotbarChange, PlayerDelta,
    PlayerSnapshot, Replay, SlotChange, SourceSpan, TickFrame,
};
