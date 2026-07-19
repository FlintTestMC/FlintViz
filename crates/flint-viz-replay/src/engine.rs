//! Walk a `TestSpec` timeline and produce a `Replay`.
//!
//! All M3 action variants are dispatched. Each action / assertion becomes a
//! `TickEvent` on the frame, in source order; the frontend derives world and
//! inventory state by walking `events` (no separate `block_diff` /
//! `inventory_diff` arrays).

use std::collections::BTreeMap;

use flint_core::test_spec::{ActionType, TestSpec};

use super::assertions::views_from_check;
use super::model::{
    Aabb, AssertionView, PlayerSnapshot, Replay, ReplayError, SourceSpan, TickEvent, TickFrame,
};
use super::player;
use super::source_map::timeline_pointer;

/// Maximum number of block writes a single `fill` may produce client-side.
/// The backend no longer expands fills into per-cell changes, but it does
/// reject inverted regions; oversize fills are flagged for the frontend.
pub const MAX_FILL_BLOCKS: u64 = 100_000;

pub fn compute(spec: &TestSpec) -> Replay {
    let cleanup_region = spec
        .setup
        .as_ref()
        .and_then(|s| s.cleanup.as_ref())
        .map(|c| Aabb::from_pair(c.region));

    let initial_player = spec
        .setup
        .as_ref()
        .and_then(|s| s.player.as_ref())
        .map(|p| PlayerSnapshot {
            inventory: p.inventory.clone(),
            selected_hotbar: p.selected_hotbar,
            game_mode: p.game_mode.clone(),
        })
        .unwrap_or_default();

    let max_tick = spec.max_tick();

    let mut frames: BTreeMap<u32, TickFrame> = BTreeMap::new();
    let mut errors: Vec<ReplayError> = Vec::new();
    let mut snapshot = initial_player.clone();
    let mut pending_spans: Vec<PendingSpan> = Vec::new();

    for (timeline_idx, entry) in spec.timeline.iter().enumerate() {
        for tick in entry.at.to_vec() {
            let frame = frames.entry(tick).or_insert_with(|| TickFrame {
                tick,
                events: Vec::new(),
            });
            let events_before = frame.events.len();
            apply_action(frame, &entry.action_type, &mut snapshot, &mut errors);
            for local_idx in events_before..frame.events.len() {
                pending_spans.push(PendingSpan {
                    tick,
                    timeline_idx,
                    local_idx,
                });
            }
        }
    }

    let filtered_frames: Vec<TickFrame> = frames
        .into_values()
        .filter(|f| !f.events.is_empty())
        .collect();

    // After the empty-frame filter, every pending span corresponds to a
    // surviving event at the same `local_idx` since we never reorder events.
    let source_map: Vec<SourceSpan> = pending_spans
        .into_iter()
        .map(|p| SourceSpan {
            tick: p.tick,
            event_index: p.local_idx,
            json_pointer: timeline_pointer(p.timeline_idx),
        })
        .collect();

    Replay {
        name: spec.name.clone(),
        cleanup_region,
        initial_player,
        max_tick,
        frames: filtered_frames,
        breakpoints: spec.breakpoints.clone(),
        errors,
        source_map,
    }
}

#[derive(Debug, Clone, Copy)]
struct PendingSpan {
    tick: u32,
    timeline_idx: usize,
    local_idx: usize,
}

fn apply_action(
    frame: &mut TickFrame,
    action: &ActionType,
    snapshot: &mut PlayerSnapshot,
    errors: &mut Vec<ReplayError>,
) {
    match action {
        ActionType::Place { pos, block } => {
            frame.events.push(TickEvent::Place {
                pos: *pos,
                block: block.clone(),
            });
        }
        ActionType::Fill { region, with } => {
            let aabb = Aabb::from_pair(*region);
            let volume = aabb.volume();
            if volume == 0 {
                errors.push(ReplayError {
                    tick: frame.tick,
                    message: format!(
                        "fill at tick {} has an inverted region (min > max on some axis); skipped",
                        frame.tick
                    ),
                });
                return;
            }
            if volume > MAX_FILL_BLOCKS {
                errors.push(ReplayError {
                    tick: frame.tick,
                    message: format!(
                        "fill at tick {} would emit {} block changes (cap is {}); visualization may degrade",
                        frame.tick, volume, MAX_FILL_BLOCKS
                    ),
                });
                // Still emit the event so the timeline + frontend can decide
                // how to handle it.
            }
            frame.events.push(TickEvent::Fill {
                region: aabb,
                block: with.clone(),
            });
        }
        ActionType::PlaceEach { blocks } => {
            frame.events.push(TickEvent::PlaceEach {
                placements: blocks.clone(),
            });
        }
        ActionType::Remove { pos } => {
            frame.events.push(TickEvent::Remove { pos: *pos });
        }
        ActionType::Summon {
            entity_alias,
            entity_type,
            pos,
            nbt,
        } => frame.events.push(TickEvent::Summon {
            entity_alias: entity_alias.clone(),
            entity_type: entity_type.clone(),
            pos: *pos,
            nbt: nbt.clone(),
        }),
        ActionType::SetSlot { slot, item, count } => {
            frame.events.push(TickEvent::SetSlot {
                slot: *slot,
                item: item.clone(),
                count: *count,
            });
            player::apply_slot_change(snapshot, *slot, item.as_deref(), *count);
        }
        ActionType::Tp {
            entity_alias,
            pos,
            rot,
        } => frame.events.push(TickEvent::Tp {
            entity_alias: entity_alias.clone(),
            pos: *pos,
            rot: *rot,
        }),
        // Interactions are event-only: static replay cannot infer Minecraft
        // side effects without a live registry and world simulation.
        ActionType::Interact { item } => {
            let resolved_item = player::resolve_active_item(snapshot, item);
            frame.events.push(TickEvent::Interact {
                item: item.clone(),
                resolved_item,
            });
        }
        ActionType::SelectHotbar { slot } => {
            frame.events.push(TickEvent::SelectHotbar { slot: *slot });
            if !(1..=9).contains(slot) {
                errors.push(ReplayError {
                    tick: frame.tick,
                    message: format!(
                        "select_hotbar at tick {} has slot {} out of range (1..=9); skipped",
                        frame.tick, slot
                    ),
                });
                return;
            }
            snapshot.selected_hotbar = *slot;
        }
        ActionType::Assert { checks } => {
            let mut views: Vec<AssertionView> = Vec::new();
            for check in checks {
                views_from_check(check, &mut views);
            }
            if !views.is_empty() {
                frame.events.push(TickEvent::Assert { views });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> TestSpec {
        serde_json::from_str(json).expect("fixture parses")
    }

    fn events_of(frame: &TickFrame) -> &[TickEvent] {
        &frame.events
    }

    #[test]
    fn basic_placement_emits_place_events_at_their_ticks() {
        let spec = parse(
            r#"{
                "name": "basic_block_placement",
                "tags": ["basic"],
                "setup": { "cleanup": { "region": [[-5, 95, -5], [5, 105, 5]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [0, 100, 0], "block": {"id": "minecraft:stone"} },
                    { "at": 1, "do": "assert", "checks": [
                        {"pos": [0, 100, 0], "is": {"id": "minecraft:stone"}}
                    ] },
                    { "at": 2, "do": "place", "pos": [1, 100, 0], "block": {"id": "minecraft:oak_planks"} },
                    { "at": 3, "do": "assert", "checks": [
                        {"pos": [1, 100, 0], "is": {"id": "minecraft:oak_planks"}}
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.name, "basic_block_placement");
        assert_eq!(replay.max_tick, 3);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 4);

        let f0 = &replay.frames[0];
        assert_eq!(f0.events.len(), 1);
        assert!(matches!(
            &f0.events[0],
            TickEvent::Place { pos, .. } if *pos == [0, 100, 0]
        ));

        let f1 = &replay.frames[1];
        assert_eq!(f1.events.len(), 1);
        match &f1.events[0] {
            TickEvent::Assert { views } => {
                assert_eq!(views.len(), 1);
                match &views[0] {
                    AssertionView::Block {
                        position, expected, ..
                    } => {
                        assert_eq!(*position, [0, 100, 0]);
                        assert_eq!(expected.id, "minecraft:stone");
                    }
                    other => panic!("expected Block view, got {:?}", other),
                }
            }
            other => panic!("expected Assert event, got {:?}", other),
        }
    }

    #[test]
    fn fill_emits_one_event_no_block_expansion() {
        let spec = parse(
            r#"{
                "name": "synthetic_fill",
                "setup": { "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] } },
                "timeline": [
                    { "at": 0, "do": "fill",
                      "region": [[0, 0, 0], [1, 1, 1]],
                      "with": {"id": "minecraft:dirt"} }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(events_of(frame).len(), 1);
        assert!(
            matches!(&frame.events[0], TickEvent::Fill { region, .. } if region.min == [0,0,0] && region.max == [1,1,1])
        );
    }

    #[test]
    fn oversize_fill_records_error_but_still_emits_event() {
        let spec = parse(
            r#"{
                "name": "huge_fill",
                "setup": { "cleanup": { "region": [[0, 0, 0], [49, 49, 49]] } },
                "timeline": [
                    { "at": 0, "do": "fill",
                      "region": [[0, 0, 0], [49, 49, 49]],
                      "with": {"id": "minecraft:stone"} }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.errors.len(), 1);
        assert_eq!(replay.errors[0].tick, 0);
        assert_eq!(replay.frames.len(), 1);
        assert_eq!(replay.frames[0].events.len(), 1);
    }

    #[test]
    fn multi_tick_entry_emits_into_each_listed_tick() {
        let spec = parse(
            r#"{
                "name": "multi",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": [0, 2, 4], "do": "place",
                      "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.max_tick, 4);
        assert_eq!(
            replay.frames.iter().map(|f| f.tick).collect::<Vec<_>>(),
            vec![0, 2, 4]
        );
        for frame in &replay.frames {
            assert_eq!(frame.events.len(), 1);
        }
    }

    #[test]
    fn place_each_emits_single_event_with_placement_list() {
        let spec = parse(
            r#"{
                "name": "non_breaking_cactus_excerpt",
                "setup": { "cleanup": { "region": [[-2, -2, -2], [2, 3, 2]] } },
                "timeline": [
                    { "at": 0, "do": "place_each", "blocks": [
                        { "pos": [ 0,  0,  0], "block": {"id": "minecraft:sand"} },
                        { "pos": [ 1,  0, -1], "block": {"id": "minecraft:sand"} },
                        { "pos": [-1, -1, -1], "block": {"id": "minecraft:stone"} },
                        { "pos": [ 0,  1,  0], "block": {"id": "minecraft:cactus", "age": "0"} }
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.events.len(), 1);
        match &frame.events[0] {
            TickEvent::PlaceEach { placements } => {
                assert_eq!(placements.len(), 4);
                assert_eq!(placements[3].block.id, "minecraft:cactus");
            }
            other => panic!("expected PlaceEach, got {:?}", other),
        }
    }

    #[test]
    fn remove_emits_remove_event() {
        let spec = parse(
            r#"{
                "name": "synthetic_remove",
                "setup": { "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [1, 1, 1], "block": {"id": "minecraft:stone"} },
                    { "at": 1, "do": "remove", "pos": [1, 1, 1] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 2);
        assert!(matches!(
            &replay.frames[1].events[0],
            TickEvent::Remove { pos } if *pos == [1, 1, 1]
        ));
    }

    #[test]
    fn initial_player_falls_back_to_default_when_setup_player_absent() {
        use flint_core::test_spec::GameMode;

        let spec = parse(
            r#"{
                "name": "no_player_config",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": []
            }"#,
        );
        let replay = compute(&spec);
        assert!(replay.initial_player.inventory.is_empty());
        assert_eq!(replay.initial_player.selected_hotbar, 1);
        assert!(matches!(
            replay.initial_player.game_mode,
            GameMode::Creative
        ));
    }

    #[test]
    fn empty_timeline_yields_empty_frames() {
        let spec = parse(
            r#"{
                "name": "empty",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": []
            }"#,
        );
        let replay = compute(&spec);
        assert_eq!(replay.max_tick, 0);
        assert!(replay.frames.is_empty());
        assert!(replay.errors.is_empty());
    }

    #[test]
    fn set_slot_emits_event_and_updates_snapshot() {
        use flint_core::test_spec::PlayerSlot;

        let spec = parse(
            r#"{
                "name": "set_slot_write",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": {
                        "inventory": {
                            "hotbar1": { "id": "minecraft:stone", "count": 4 }
                        },
                        "selected_hotbar": 1,
                        "game_mode": "Creative"
                    }
                },
                "timeline": [
                    { "at": 3, "do": "set_slot",
                      "slot": "hotbar1",
                      "item": "minecraft:honeycomb",
                      "count": 7 },
                    { "at": 4, "do": "interact" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 2);
        match &replay.frames[0].events[0] {
            TickEvent::SetSlot { slot, item, count } => {
                assert_eq!(*slot, PlayerSlot::Hotbar1);
                assert_eq!(item.as_deref(), Some("minecraft:honeycomb"));
                assert_eq!(*count, 7);
            }
            other => panic!("expected SetSlot, got {:?}", other),
        }
        // interact resolves the updated snapshot.
        match &replay.frames[1].events[0] {
            TickEvent::Interact { resolved_item, .. } => {
                let resolved = resolved_item.as_ref().expect("resolved item");
                assert_eq!(resolved.id, "minecraft:honeycomb");
                assert_eq!(resolved.count, 7);
            }
            other => panic!("expected Interact, got {:?}", other),
        }
    }

    #[test]
    fn select_hotbar_updates_snapshot_for_subsequent_interact() {
        let spec = parse(
            r#"{
                "name": "select_hotbar_then_use",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] },
                    "player": {
                        "inventory": {
                            "hotbar1": { "id": "minecraft:stone", "count": 1 },
                            "hotbar4": { "id": "minecraft:honeycomb", "count": 6 }
                        },
                        "selected_hotbar": 1
                    }
                },
                "timeline": [
                    { "at": 0, "do": "select_hotbar", "slot": 4 },
                    { "at": 1, "do": "interact" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        match &replay.frames[1].events[0] {
            TickEvent::Interact { resolved_item, .. } => {
                let resolved = resolved_item.as_ref().expect("hotbar4 should resolve");
                assert_eq!(resolved.id, "minecraft:honeycomb");
                assert_eq!(resolved.count, 6);
            }
            other => panic!("expected UseItemOn, got {:?}", other),
        }
    }

    #[test]
    fn select_hotbar_out_of_range_records_error_but_keeps_event() {
        let spec = parse(
            r#"{
                "name": "select_hotbar_oor",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": { "selected_hotbar": 2 }
                },
                "timeline": [
                    { "at": 5, "do": "select_hotbar", "slot": 0 },
                    { "at": 6, "do": "select_hotbar", "slot": 12 }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.errors.len(), 2);
        assert_eq!(replay.frames.len(), 2);
        for frame in &replay.frames {
            assert_eq!(frame.events.len(), 1);
        }
    }

    #[test]
    fn assert_block_with_multiple_alternatives_bundles_views_in_one_event() {
        let spec = parse(
            r#"{
                "name": "assert_multi",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "assert", "checks": [
                        { "pos": [0, 0, 0], "is": [
                            {"id": "minecraft:stone"},
                            {"id": "minecraft:dirt"}
                        ] }
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        // One assert action → one event, regardless of view count.
        assert_eq!(replay.frames[0].events.len(), 1);
        match &replay.frames[0].events[0] {
            TickEvent::Assert { views } => {
                assert_eq!(views.len(), 2);
                let ids: Vec<&str> = views
                    .iter()
                    .map(|v| match v {
                        AssertionView::Block { expected, .. } => expected.id.as_str(),
                        other => panic!("expected Block view, got {:?}", other),
                    })
                    .collect();
                assert_eq!(ids, vec!["minecraft:stone", "minecraft:dirt"]);
            }
            other => panic!("expected Assert, got {:?}", other),
        }
    }

    #[test]
    fn multiple_assert_actions_become_multiple_assert_events() {
        let spec = parse(
            r#"{
                "name": "two_asserts",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "assert", "checks": [
                        { "pos": [0, 0, 0], "is": {"id": "minecraft:stone"} }
                    ] },
                    { "at": 0, "do": "assert", "checks": [
                        { "pos": [1, 0, 0], "is": {"id": "minecraft:dirt"} }
                    ] }
                ]
            }"#,
        );
        let replay = compute(&spec);
        assert_eq!(replay.frames[0].events.len(), 2);
        for ev in &replay.frames[0].events {
            assert!(matches!(ev, TickEvent::Assert { .. }));
        }
    }

    #[test]
    fn source_map_event_index_is_direct_index_into_events() {
        // place at tick 0 (idx 0), assert at tick 0 (idx 1).
        let spec = parse(
            r#"{
                "name": "src_merged",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} },
                    { "at": 0, "do": "assert", "checks": [
                        { "pos": [0, 0, 0], "is": {"id": "minecraft:stone"} }
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.source_map.len(), 2);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
        assert_eq!(replay.source_map[1].event_index, 1);
        assert_eq!(replay.source_map[1].json_pointer, "/timeline/1");
    }

    #[test]
    fn source_map_preserves_source_ordering_across_actions_and_asserts() {
        // place(0), assert(1), place(2) — emitted in source order so spans
        // align directly with their `local_idx`.
        let spec = parse(
            r#"{
                "name": "src_interleave",
                "setup": { "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} },
                    { "at": 0, "do": "assert", "checks": [
                        { "pos": [0, 0, 0], "is": {"id": "minecraft:stone"} }
                    ] },
                    { "at": 0, "do": "place", "pos": [1, 0, 0], "block": {"id": "minecraft:dirt"} }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.frames[0].events.len(), 3);
        assert!(matches!(
            replay.frames[0].events[0],
            TickEvent::Place { .. }
        ));
        assert!(matches!(
            replay.frames[0].events[1],
            TickEvent::Assert { .. }
        ));
        assert!(matches!(
            replay.frames[0].events[2],
            TickEvent::Place { .. }
        ));

        assert_eq!(replay.source_map.len(), 3);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
        assert_eq!(replay.source_map[1].event_index, 1);
        assert_eq!(replay.source_map[1].json_pointer, "/timeline/1");
        assert_eq!(replay.source_map[2].event_index, 2);
        assert_eq!(replay.source_map[2].json_pointer, "/timeline/2");
    }

    #[test]
    fn empty_assert_check_list_emits_no_event() {
        let spec = parse(
            r#"{
                "name": "src_empty_assert",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "assert", "checks": [] }
                ]
            }"#,
        );
        let replay = compute(&spec);
        assert!(replay.source_map.is_empty());
        assert!(replay.frames.is_empty());
    }

    #[test]
    fn latest_entity_actions_and_assertions_are_replayed() {
        let spec = parse(
            r#"{
                "name": "entities-and-time",
                "setup": { "cleanup": { "region": [[0, 0, 0], [4, 80, 4]] } },
                "timeline": [
                    { "at": 0, "do": "summon", "entity_alias": "falling",
                      "entity_type": "minecraft:falling_block", "pos": [1.5, 64, 2],
                      "nbt": { "NoGravity": "1b" } },
                    { "at": 1, "do": "tp", "entity_alias": "falling",
                      "pos": [2.5, 65, 2], "rot": [90, 0] },
                    { "at": 2, "do": "interact", "item": "minecraft:bone_meal" },
                    { "at": 3, "do": "assert", "checks": [
                      { "time": 6000 },
                      { "entity_alias": "falling", "is": "minecraft:falling_block",
                        "pos": [2.5, 65, 2] },
                      { "is": "minecraft:item", "pos": [1.5, 64, 1.5],
                        "Item": { "id": "minecraft:diamond", "count": 1 } }
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(matches!(
            replay.frames[0].events[0],
            TickEvent::Summon { .. }
        ));
        assert!(matches!(replay.frames[1].events[0], TickEvent::Tp { .. }));
        assert!(matches!(
            replay.frames[2].events[0],
            TickEvent::Interact { .. }
        ));
        match &replay.frames[3].events[0] {
            TickEvent::Assert { views } => {
                assert!(matches!(views[0], AssertionView::Time { expected: 6000 }));
                assert!(matches!(views[1], AssertionView::Entity { .. }));
                match &views[2] {
                    AssertionView::Entity { expected } => {
                        assert_eq!(expected.entity_type.as_deref(), Some("minecraft:item"));
                        assert!(expected.nbt.to_snbt().contains("minecraft:diamond"));
                    }
                    other => panic!("expected item entity assertion, got {other:?}"),
                }
            }
            other => panic!("expected Assert, got {other:?}"),
        }
    }
}
