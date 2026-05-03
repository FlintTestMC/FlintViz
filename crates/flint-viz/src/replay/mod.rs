//! Replay engine: turn a static `TestSpec` into per-tick world + player state.
//!
//! M3 surface lives here. #0010 introduced the data model; #0011 implements
//! `place` and `fill` walking. Player actions, assertions, and the source
//! map land in #0014–#0016 / #0037–#0039.

pub mod aabb;
pub mod engine;
pub mod model;
pub mod player;

#[allow(unused_imports)] // re-exported for the engine modules landing in #0014+.
pub use model::{
    Aabb, ActionEvent, AssertionView, BlockChange, GameModeChange, HotbarChange, PlayerDelta,
    PlayerSnapshot, Replay, ReplayError, SlotChange, SourceSpan, TickFrame,
};

pub use engine::compute;
#[allow(unused_imports)] // surfaced as a public knob; first internal user lands in #0026 (highlight tooltip).
pub use engine::MAX_FILL_BLOCKS;
