#![allow(dead_code)] // engine logic (#0011–#0016) consumes these next.

//! Serializable data model produced by the replay engine.
//!
//! This is the type surface the HTTP layer sends to the frontend and the
//! engine modules (#0011–#0016) populate. No engine logic lives here — only
//! types, serde, and tiny conversion helpers.
//!
//! Block / item / slot / face / gamemode types are intentionally re-exported
//! from `flint_core::test_spec` so the wire format stays in lockstep with the
//! authoritative schema.

use std::collections::HashMap;

use flint_core::test_spec::{Block, BlockFace, BlockPlacement, GameMode, Item, PlayerSlot};
use serde::{Deserialize, Serialize};

/// Top-level replay artifact for a single test.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Replay {
    pub name: String,
    pub cleanup_region: Option<Aabb>,
    pub initial_player: PlayerSnapshot,
    pub max_tick: u32,
    /// Sparse: only ticks with at least one event appear.
    pub frames: Vec<TickFrame>,
    pub breakpoints: Vec<u32>,
    /// Engine-level rejections (e.g. invalid hotbar slot). Visible to the
    /// frontend so it can surface the cause.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ReplayError>,
    /// Populated by #0016.
    pub source_map: Vec<SourceSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayError {
    pub tick: u32,
    pub message: String,
}

/// Everything that happens on one tick, in source order. The frontend walks
/// `events` to derive both world state and assertion ghosts — there are no
/// separate `block_diff` / `inventory_diff` / `assertions` arrays.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickFrame {
    pub tick: u32,
    pub events: Vec<TickEvent>,
}

/// Ordered union of actions and assertions occurring on a tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TickEvent {
    Place {
        pos: [i32; 3],
        block: Block,
    },
    PlaceEach {
        placements: Vec<BlockPlacement>,
    },
    Fill {
        region: Aabb,
        block: Block,
    },
    Remove {
        pos: [i32; 3],
    },
    UseItemOn {
        pos: [i32; 3],
        face: BlockFace,
        item: Option<String>,
        resolved_item: Option<Item>,
    },
    SetSlot {
        slot: PlayerSlot,
        item: Option<String>,
        count: u8,
    },
    SelectHotbar {
        slot: u8,
    },
    /// One `assert` timeline action — may carry multiple checks (block alts
    /// via `BlockSpec::Multiple`, multiple checks in one action). All views
    /// belong to the same event for picker / source-map purposes.
    Assert {
        views: Vec<AssertionView>,
    },
}

/// What the test claims should be true. Lives inside `TickEvent::Assert`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AssertionView {
    Block {
        position: [i32; 3],
        expected: Block,
    },
    Inventory {
        slot: PlayerSlot,
        expected: Option<Item>,
    },
    Other {
        description: String,
    },
}

/// Full player state at tick 0. The frontend forward-applies events to reach
/// any later tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSnapshot {
    pub inventory: HashMap<PlayerSlot, Item>,
    pub selected_hotbar: u8,
    pub game_mode: GameMode,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            inventory: HashMap::new(),
            selected_hotbar: 1,
            game_mode: GameMode::Creative,
        }
    }
}

/// JSON-pointer back to the originating timeline entry. Populated in #0016.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSpan {
    pub tick: u32,
    pub event_index: usize,
    pub json_pointer: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Aabb {
    pub min: [i32; 3],
    pub max: [i32; 3],
}

impl Aabb {
    pub fn from_pair(pair: [[i32; 3]; 2]) -> Self {
        Self {
            min: pair[0],
            max: pair[1],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_roundtrips_through_serde_json() {
        let replay = Replay {
            name: "alpha".into(),
            cleanup_region: Some(Aabb {
                min: [0, 0, 0],
                max: [4, 4, 4],
            }),
            initial_player: PlayerSnapshot::default(),
            max_tick: 7,
            frames: vec![TickFrame {
                tick: 3,
                events: vec![
                    TickEvent::Place {
                        pos: [1, 2, 3],
                        block: Block::new("minecraft:stone"),
                    },
                    TickEvent::Assert {
                        views: vec![AssertionView::Inventory {
                            slot: PlayerSlot::Hotbar1,
                            expected: None,
                        }],
                    },
                ],
            }],
            breakpoints: vec![3],
            errors: Vec::new(),
            source_map: vec![SourceSpan {
                tick: 3,
                event_index: 0,
                json_pointer: "/timeline/0".into(),
            }],
        };

        let json = serde_json::to_string(&replay).unwrap();
        let back: Replay = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "alpha");
        assert_eq!(back.max_tick, 7);
        assert_eq!(back.frames.len(), 1);
        assert_eq!(back.frames[0].tick, 3);
        assert_eq!(back.frames[0].events.len(), 2);
        assert_eq!(back.breakpoints, vec![3]);
        assert_eq!(back.source_map[0].json_pointer, "/timeline/0");
    }

    #[test]
    fn tick_event_tagged_serialization() {
        let place = TickEvent::Place {
            pos: [0, 1, 2],
            block: Block::new("minecraft:dirt"),
        };
        let json = serde_json::to_value(&place).unwrap();
        assert_eq!(json["kind"], "place");
        assert_eq!(json["pos"], serde_json::json!([0, 1, 2]));

        let assert = TickEvent::Assert {
            views: vec![
                AssertionView::Block {
                    position: [1, 1, 1],
                    expected: Block::new("minecraft:stone"),
                },
                AssertionView::Other {
                    description: "expected_count >= 3".into(),
                },
            ],
        };
        let json = serde_json::to_value(&assert).unwrap();
        assert_eq!(json["kind"], "assert");
        assert_eq!(json["views"][0]["kind"], "block");
        assert_eq!(json["views"][1]["kind"], "other");
    }

    #[test]
    fn aabb_from_pair() {
        let a = Aabb::from_pair([[1, 2, 3], [4, 5, 6]]);
        assert_eq!(a.min, [1, 2, 3]);
        assert_eq!(a.max, [4, 5, 6]);
    }
}
