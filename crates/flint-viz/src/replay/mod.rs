//! Replay engine: turn a static `TestSpec` into per-tick world + player state.
//!
//! M3 surface lives here. #0010 introduced the data model; #0011–#0013 walk
//! block actions; #0014/#0037–#0039 thread the player snapshot; #0015 collects
//! assertions; #0016 populates the JSON-pointer source map.

pub mod aabb;
pub mod assertions;
pub mod engine;
pub mod model;
pub mod player;
pub mod source_map;

#[allow(unused_imports)] // re-exported for the engine modules landing in #0014+.
pub use model::{
    Aabb, ActionEvent, AssertionView, BlockChange, GameModeChange, HotbarChange, PlayerDelta,
    PlayerSnapshot, Replay, ReplayError, SlotChange, SourceSpan, TickFrame,
};

pub use engine::compute;
#[allow(unused_imports)] // surfaced as a public knob; first internal user lands in #0026 (highlight tooltip).
pub use engine::MAX_FILL_BLOCKS;
