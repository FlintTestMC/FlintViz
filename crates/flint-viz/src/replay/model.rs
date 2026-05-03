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
    /// Sparse: only ticks with at least one action or assertion appear.
    pub frames: Vec<TickFrame>,
    pub breakpoints: Vec<u32>,
    /// Populated by #0016. Empty until then.
    pub source_map: Vec<SourceSpan>,
}

/// Everything that happens on one tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickFrame {
    pub tick: u32,
    pub actions: Vec<ActionEvent>,
    pub block_diff: Vec<BlockChange>,
    pub inventory_diff: Option<PlayerDelta>,
    pub assertions: Vec<AssertionView>,
}

/// Forward-applicable mutation to the world block grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BlockChange {
    Set { pos: [i32; 3], block: Block },
    Remove { pos: [i32; 3] },
}

/// Visual/timeline event recording what action ran. Block actions produce both
/// an `ActionEvent` (for the timeline scrubber + highlight overlay) and one or
/// more `BlockChange`s (for world reconstruction). Player actions produce an
/// `ActionEvent` and optionally a `PlayerDelta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionEvent {
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
}

/// What the test asserted at this tick. Static replay does not evaluate
/// assertions — it only records what the test claims should be true.
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
    /// Catch-all for state checks (`expected_count`, comparators, ...) the
    /// frontend renders as a free-text line. Populated in #0015.
    Other {
        description: String,
    },
}

/// Aggregated player-state changes for one tick. A single tick may contain
/// multiple slot writes plus a hotbar selection plus a gamemode change, so
/// each field is independently optional.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlayerDelta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub slots: Vec<SlotChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_hotbar: Option<HotbarChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_mode: Option<GameModeChange>,
}

impl PlayerDelta {
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty() && self.selected_hotbar.is_none() && self.game_mode.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotChange {
    pub slot: PlayerSlot,
    /// New value (`None` clears the slot).
    pub item: Option<Item>,
    /// Prior value, captured so reverse-scrubbing in the frontend store is O(1).
    pub previous: Option<Item>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotbarChange {
    pub slot: u8,
    pub previous: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameModeChange {
    pub mode: GameMode,
    pub previous: GameMode,
}

/// Full player state at tick 0. The frontend forward-applies `PlayerDelta`s
/// to reach any later tick.
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
                actions: vec![ActionEvent::Place {
                    pos: [1, 2, 3],
                    block: Block::new("minecraft:stone"),
                }],
                block_diff: vec![BlockChange::Set {
                    pos: [1, 2, 3],
                    block: Block::new("minecraft:stone"),
                }],
                inventory_diff: None,
                assertions: vec![AssertionView::Inventory {
                    slot: PlayerSlot::Hotbar1,
                    expected: None,
                }],
            }],
            breakpoints: vec![3],
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
        assert_eq!(back.breakpoints, vec![3]);
        assert_eq!(back.source_map[0].json_pointer, "/timeline/0");
    }

    #[test]
    fn block_change_tagged_serialization() {
        let set = BlockChange::Set {
            pos: [0, 1, 2],
            block: Block::new("minecraft:dirt"),
        };
        let json = serde_json::to_value(&set).unwrap();
        assert_eq!(json["kind"], "set");
        assert_eq!(json["pos"], serde_json::json!([0, 1, 2]));

        let remove = BlockChange::Remove { pos: [3, 4, 5] };
        let json = serde_json::to_value(&remove).unwrap();
        assert_eq!(json["kind"], "remove");
    }

    #[test]
    fn assertion_view_tagged_serialization() {
        let view = AssertionView::Block {
            position: [1, 1, 1],
            expected: Block::new("minecraft:stone"),
        };
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["kind"], "block");
        assert_eq!(json["position"], serde_json::json!([1, 1, 1]));

        let other = AssertionView::Other {
            description: "expected_count >= 3".into(),
        };
        let json = serde_json::to_value(&other).unwrap();
        assert_eq!(json["kind"], "other");
        assert_eq!(json["description"], "expected_count >= 3");
    }

    #[test]
    fn player_delta_skips_empty_fields() {
        let delta = PlayerDelta::default();
        assert!(delta.is_empty());
        let json = serde_json::to_value(&delta).unwrap();
        assert!(json.get("slots").is_none());
        assert!(json.get("selected_hotbar").is_none());
        assert!(json.get("game_mode").is_none());
    }

    #[test]
    fn aabb_from_pair() {
        let a = Aabb::from_pair([[1, 2, 3], [4, 5, 6]]);
        assert_eq!(a.min, [1, 2, 3]);
        assert_eq!(a.max, [4, 5, 6]);
    }
}
