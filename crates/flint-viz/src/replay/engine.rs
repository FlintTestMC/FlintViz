//! Walk a `TestSpec` timeline and produce a `Replay`.
//!
//! All M3 action variants are dispatched. Block actions (#0011–#0013) emit
//! into `actions` + `block_diff`; player actions (#0014, #0037–#0039) emit
//! into `actions` and (where relevant) `inventory_diff`; `assert` (#0015)
//! emits exclusively into `assertions`.

use std::collections::{BTreeMap, HashMap};

use flint_core::test_spec::{ActionType, Item, TestSpec};

use super::aabb::iter_aabb;
use super::assertions::views_from_check;
use super::model::{
    Aabb, ActionEvent, BlockChange, PlayerSnapshot, Replay, ReplayError, SourceSpan, TickFrame,
};
use super::player;
use super::source_map::timeline_pointer;

/// Maximum number of block writes a single `fill` may emit. Anything larger
/// is rejected with a `ReplayError` and the offending fill produces no
/// `BlockChange`s (the `ActionEvent::Fill` is still emitted so the timeline
/// surfaces *that* the fill was attempted).
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
    // Tracked during the walk; resolved into final `SourceSpan`s after the
    // frame-empty filter so an `event_index` for an assertion span can be
    // computed against the surviving frame's final action count (assertions
    // are placed *after* actions in the merged ordering — see post-#0011
    // status in 0016).
    let mut pending_spans: Vec<PendingSpan> = Vec::new();

    for (timeline_idx, entry) in spec.timeline.iter().enumerate() {
        for tick in entry.at.to_vec() {
            let frame = frames.entry(tick).or_insert_with(|| TickFrame {
                tick,
                actions: Vec::new(),
                block_diff: Vec::new(),
                inventory_diff: None,
                assertions: Vec::new(),
            });
            let actions_before = frame.actions.len();
            let assertions_before = frame.assertions.len();
            apply_action(frame, &entry.action_type, &mut snapshot, &mut errors);
            for local_idx in actions_before..frame.actions.len() {
                pending_spans.push(PendingSpan {
                    tick,
                    timeline_idx,
                    stream: SpanStream::Action,
                    local_idx,
                });
            }
            for local_idx in assertions_before..frame.assertions.len() {
                pending_spans.push(PendingSpan {
                    tick,
                    timeline_idx,
                    stream: SpanStream::Assertion,
                    local_idx,
                });
            }
        }
    }

    // Drop ticks that ended up fully empty (no actions, no block_diff, no
    // assertions, no inventory_diff). Also drop a `PlayerDelta` that was
    // lazily allocated but ended up empty, so empty deltas never reach the
    // wire.
    let filtered_frames: Vec<TickFrame> = frames
        .into_values()
        .map(|mut f| {
            if let Some(delta) = &f.inventory_diff {
                if delta.is_empty() {
                    f.inventory_diff = None;
                }
            }
            f
        })
        .filter(|f| !is_frame_empty(f))
        .collect();

    // Lookup of final action count per surviving tick. Every pending span
    // corresponds to a surviving tick (any tick with a span has at least one
    // action or assertion, so `is_frame_empty` is false), but the filter_map
    // below still guards defensively.
    let action_counts: HashMap<u32, usize> = filtered_frames
        .iter()
        .map(|f| (f.tick, f.actions.len()))
        .collect();

    let source_map: Vec<SourceSpan> = pending_spans
        .into_iter()
        .filter_map(|p| {
            let actions_in_frame = *action_counts.get(&p.tick)?;
            let event_index = match p.stream {
                SpanStream::Action => p.local_idx,
                SpanStream::Assertion => actions_in_frame + p.local_idx,
            };
            Some(SourceSpan {
                tick: p.tick,
                event_index,
                json_pointer: timeline_pointer(p.timeline_idx),
            })
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
enum SpanStream {
    Action,
    Assertion,
}

#[derive(Debug, Clone, Copy)]
struct PendingSpan {
    tick: u32,
    timeline_idx: usize,
    stream: SpanStream,
    local_idx: usize,
}

fn is_frame_empty(frame: &TickFrame) -> bool {
    frame.actions.is_empty()
        && frame.block_diff.is_empty()
        && frame.assertions.is_empty()
        && frame.inventory_diff.is_none()
}

fn apply_action(
    frame: &mut TickFrame,
    action: &ActionType,
    snapshot: &mut PlayerSnapshot,
    errors: &mut Vec<ReplayError>,
) {
    match action {
        ActionType::Place { pos, block } => {
            frame.actions.push(ActionEvent::Place {
                pos: *pos,
                block: block.clone(),
            });
            frame.block_diff.push(BlockChange::Set {
                pos: *pos,
                block: block.clone(),
            });
        }
        ActionType::Fill { region, with } => {
            let aabb = Aabb::from_pair(*region);
            frame.actions.push(ActionEvent::Fill {
                region: aabb,
                block: with.clone(),
            });
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
                        "fill at tick {} would emit {} block changes (cap is {}); skipped",
                        frame.tick, volume, MAX_FILL_BLOCKS
                    ),
                });
                return;
            }
            for pos in iter_aabb(aabb) {
                frame.block_diff.push(BlockChange::Set {
                    pos,
                    block: with.clone(),
                });
            }
        }
        ActionType::PlaceEach { blocks } => {
            frame.actions.push(ActionEvent::PlaceEach {
                placements: blocks.clone(),
            });
            for placement in blocks {
                frame.block_diff.push(BlockChange::Set {
                    pos: placement.pos,
                    block: placement.block.clone(),
                });
            }
        }
        ActionType::Remove { pos } => {
            frame.actions.push(ActionEvent::Remove { pos: *pos });
            frame.block_diff.push(BlockChange::Remove { pos: *pos });
        }
        ActionType::SetSlot { slot, item, count } => {
            frame.actions.push(ActionEvent::SetSlot {
                slot: *slot,
                item: item.clone(),
                count: *count,
            });
            let new_item = item.as_ref().map(|id| Item {
                id: id.clone(),
                count: *count,
                data: Default::default(),
            });
            let delta = player::inventory_diff_mut(frame);
            player::record_slot_change(snapshot, delta, *slot, new_item);
        }
        // `use_item_on` is intentionally a no-op on world + inventory state in
        // static replay: we cannot know without an MC registry whether the
        // resolved item is consumable, places a block, etc. The visualizer
        // surfaces it as a highlight (#0026) at `pos` with a face indicator;
        // any downstream world change should appear via subsequent `assert`s.
        ActionType::UseItemOn { pos, face, item } => {
            let resolved_item = player::resolve_active_item(snapshot, item);
            frame.actions.push(ActionEvent::UseItemOn {
                pos: *pos,
                face: *face,
                item: item.clone(),
                resolved_item,
            });
        }
        ActionType::SelectHotbar { slot } => {
            frame
                .actions
                .push(ActionEvent::SelectHotbar { slot: *slot });
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
            let delta = player::inventory_diff_mut(frame);
            player::record_hotbar_change(snapshot, delta, *slot);
        }
        // Assertions are purely declarative — they emit no `ActionEvent`,
        // only `AssertionView`s on `frame.assertions`. The frame-empty filter
        // already considers `assertions`, so assert-only ticks materialise as
        // their own `TickFrame` once this arm runs.
        ActionType::Assert { checks } => {
            for check in checks {
                views_from_check(check, &mut frame.assertions);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::AssertionView;
    use super::*;

    fn parse(json: &str) -> TestSpec {
        serde_json::from_str(json).expect("fixture parses")
    }

    #[test]
    fn basic_placement_emits_place_actions_at_their_ticks() {
        // Mirrors ~/flint/FlintCLI/example_tests/basic_placement.json.
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
        assert_eq!(replay.cleanup_region.unwrap().min, [-5, 95, -5]);
        assert!(replay.errors.is_empty());

        // Both `place` ticks and both assert-only ticks materialise as frames.
        assert_eq!(replay.frames.len(), 4);
        let ticks: Vec<u32> = replay.frames.iter().map(|f| f.tick).collect();
        assert_eq!(ticks, vec![0, 1, 2, 3]);

        let f0 = &replay.frames[0];
        assert_eq!(f0.actions.len(), 1);
        assert!(matches!(
            &f0.actions[0],
            ActionEvent::Place { pos, .. } if *pos == [0, 100, 0]
        ));
        assert_eq!(f0.block_diff.len(), 1);
        assert!(matches!(
            &f0.block_diff[0],
            BlockChange::Set { pos, block } if *pos == [0, 100, 0] && block.id == "minecraft:stone"
        ));
        assert!(f0.assertions.is_empty());

        // Assert-only tick: no actions, no block_diff, one assertion.
        let f1 = &replay.frames[1];
        assert!(f1.actions.is_empty());
        assert!(f1.block_diff.is_empty());
        assert!(f1.inventory_diff.is_none());
        assert_eq!(f1.assertions.len(), 1);
        match &f1.assertions[0] {
            AssertionView::Block { position, expected } => {
                assert_eq!(*position, [0, 100, 0]);
                assert_eq!(expected.id, "minecraft:stone");
            }
            other => panic!("expected Block assertion, got {:?}", other),
        }

        let f3 = &replay.frames[3];
        assert!(f3.actions.is_empty());
        assert_eq!(f3.assertions.len(), 1);
        match &f3.assertions[0] {
            AssertionView::Block { position, expected } => {
                assert_eq!(*position, [1, 100, 0]);
                assert_eq!(expected.id, "minecraft:oak_planks");
            }
            other => panic!("expected Block assertion, got {:?}", other),
        }
    }

    #[test]
    fn fill_expands_into_one_set_per_position() {
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
        assert_eq!(frame.actions.len(), 1);
        assert!(
            matches!(&frame.actions[0], ActionEvent::Fill { region, .. } if region.min == [0,0,0] && region.max == [1,1,1])
        );
        // 2 * 2 * 2 = 8 positions
        assert_eq!(frame.block_diff.len(), 8);
        for change in &frame.block_diff {
            assert!(
                matches!(change, BlockChange::Set { block, .. } if block.id == "minecraft:dirt")
            );
        }
    }

    #[test]
    fn oversize_fill_is_rejected_with_an_error() {
        // 50 * 50 * 50 = 125000 > MAX_FILL_BLOCKS (100000).
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
        // Action is still emitted for the timeline; block_diff is skipped.
        assert_eq!(replay.frames.len(), 1);
        assert_eq!(replay.frames[0].actions.len(), 1);
        assert!(replay.frames[0].block_diff.is_empty());
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
            assert_eq!(frame.actions.len(), 1);
            assert_eq!(frame.block_diff.len(), 1);
        }
    }

    #[test]
    fn place_each_emits_event_and_one_set_per_placement() {
        // Mirrors the first `place_each` entry in
        // ~/flint/FlintCLI/FlintBenchmark/tests/non_breaking_cactus.json.
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
        assert_eq!(frame.tick, 0);
        assert_eq!(frame.actions.len(), 1);
        match &frame.actions[0] {
            ActionEvent::PlaceEach { placements } => {
                assert_eq!(placements.len(), 4);
                assert_eq!(placements[0].pos, [0, 0, 0]);
                assert_eq!(placements[0].block.id, "minecraft:sand");
                assert_eq!(placements[3].block.id, "minecraft:cactus");
                assert_eq!(
                    placements[3]
                        .block
                        .properties
                        .get("age")
                        .map(String::as_str),
                    Some("0")
                );
            }
            other => panic!("expected PlaceEach, got {:?}", other),
        }

        assert_eq!(frame.block_diff.len(), 4);
        let positions: Vec<[i32; 3]> = frame
            .block_diff
            .iter()
            .map(|c| match c {
                BlockChange::Set { pos, .. } => *pos,
                BlockChange::Remove { pos } => *pos,
            })
            .collect();
        assert_eq!(
            positions,
            vec![[0, 0, 0], [1, 0, -1], [-1, -1, -1], [0, 1, 0]]
        );
        match &frame.block_diff[3] {
            BlockChange::Set { block, .. } => {
                assert_eq!(block.id, "minecraft:cactus");
                assert_eq!(block.properties.get("age").map(String::as_str), Some("0"));
            }
            other => panic!("expected Set, got {:?}", other),
        }
    }

    #[test]
    fn remove_emits_event_and_block_diff() {
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

        let f1 = &replay.frames[1];
        assert_eq!(f1.tick, 1);
        assert_eq!(f1.actions.len(), 1);
        assert!(matches!(
            &f1.actions[0],
            ActionEvent::Remove { pos } if *pos == [1, 1, 1]
        ));
        assert_eq!(f1.block_diff.len(), 1);
        assert!(matches!(
            &f1.block_diff[0],
            BlockChange::Remove { pos } if *pos == [1, 1, 1]
        ));
    }

    #[test]
    fn remove_at_position_with_no_recorded_block_still_emits_remove() {
        // Per #0013 Outcome: removing an empty position emits a `Remove`
        // (frontend treats it as "definitely empty after this tick").
        let spec = parse(
            r#"{
                "name": "synthetic_remove_empty",
                "setup": { "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] } },
                "timeline": [
                    { "at": 5, "do": "remove", "pos": [2, 2, 2] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.tick, 5);
        assert!(matches!(
            &frame.actions[0],
            ActionEvent::Remove { pos } if *pos == [2, 2, 2]
        ));
        assert!(matches!(
            &frame.block_diff[0],
            BlockChange::Remove { pos } if *pos == [2, 2, 2]
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
    fn initial_player_mirrors_setup_player_field_by_field() {
        use flint_core::test_spec::{GameMode, PlayerSlot};

        let spec = parse(
            r#"{
                "name": "with_player_config",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": {
                        "inventory": {
                            "hotbar1": { "id": "minecraft:honeycomb", "count": 8 }
                        },
                        "selected_hotbar": 3,
                        "game_mode": "Survival"
                    }
                },
                "timeline": []
            }"#,
        );
        let replay = compute(&spec);
        assert_eq!(replay.initial_player.selected_hotbar, 3);
        assert!(matches!(
            replay.initial_player.game_mode,
            GameMode::Survival
        ));
        let item = replay
            .initial_player
            .inventory
            .get(&PlayerSlot::Hotbar1)
            .expect("hotbar1 populated");
        assert_eq!(item.id, "minecraft:honeycomb");
        assert_eq!(item.count, 8);
    }

    #[test]
    fn block_only_timeline_never_attaches_inventory_diff() {
        // #0014 threads the snapshot through `apply_action` but the per-tick
        // player arms (#0037–#0039) haven't landed yet. With only block
        // actions on the timeline the inventory_diff post-pass must leave
        // every frame's `inventory_diff` as None — never an empty delta.
        let spec = parse(
            r#"{
                "name": "blocks_only",
                "setup": { "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} },
                    { "at": 1, "do": "remove", "pos": [0, 0, 0] }
                ]
            }"#,
        );
        let replay = compute(&spec);
        assert!(replay.frames.iter().all(|f| f.inventory_diff.is_none()));
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
    fn set_slot_writes_item_and_records_previous_value() {
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
                      "count": 7 }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.tick, 3);

        match &frame.actions[0] {
            ActionEvent::SetSlot { slot, item, count } => {
                assert_eq!(*slot, PlayerSlot::Hotbar1);
                assert_eq!(item.as_deref(), Some("minecraft:honeycomb"));
                assert_eq!(*count, 7);
            }
            other => panic!("expected SetSlot event, got {:?}", other),
        }

        let delta = frame
            .inventory_diff
            .as_ref()
            .expect("set_slot must produce a PlayerDelta");
        assert_eq!(delta.slots.len(), 1);
        let change = &delta.slots[0];
        assert_eq!(change.slot, PlayerSlot::Hotbar1);
        let new_item = change.item.as_ref().expect("new item present");
        assert_eq!(new_item.id, "minecraft:honeycomb");
        assert_eq!(new_item.count, 7);
        let prev = change.previous.as_ref().expect("previous captured");
        assert_eq!(prev.id, "minecraft:stone");
        assert_eq!(prev.count, 4);
        assert!(delta.selected_hotbar.is_none());
        assert!(delta.game_mode.is_none());
    }

    #[test]
    fn set_slot_without_item_clears_the_slot() {
        use flint_core::test_spec::PlayerSlot;

        let spec = parse(
            r#"{
                "name": "set_slot_clear",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": {
                        "inventory": {
                            "hotbar2": { "id": "minecraft:dirt", "count": 2 }
                        }
                    }
                },
                "timeline": [
                    { "at": 0, "do": "set_slot", "slot": "hotbar2" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let delta = replay.frames[0]
            .inventory_diff
            .as_ref()
            .expect("delta present");
        assert_eq!(delta.slots.len(), 1);
        let change = &delta.slots[0];
        assert_eq!(change.slot, PlayerSlot::Hotbar2);
        assert!(change.item.is_none());
        let prev = change.previous.as_ref().expect("previous captured");
        assert_eq!(prev.id, "minecraft:dirt");
        assert_eq!(prev.count, 2);
    }

    #[test]
    fn use_item_on_emits_event_and_resolves_active_hotbar_item() {
        use flint_core::test_spec::BlockFace;

        let spec = parse(
            r#"{
                "name": "use_item_on_active",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] },
                    "player": {
                        "inventory": {
                            "hotbar3": { "id": "minecraft:honeycomb", "count": 5 }
                        },
                        "selected_hotbar": 3,
                        "game_mode": "Survival"
                    }
                },
                "timeline": [
                    { "at": 1, "do": "use_item_on",
                      "pos": [1, 2, 3], "face": "top" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.tick, 1);

        // No world or inventory side-effects.
        assert!(frame.block_diff.is_empty());
        assert!(frame.inventory_diff.is_none());

        assert_eq!(frame.actions.len(), 1);
        match &frame.actions[0] {
            ActionEvent::UseItemOn {
                pos,
                face,
                item,
                resolved_item,
            } => {
                assert_eq!(*pos, [1, 2, 3]);
                assert!(matches!(face, BlockFace::Top));
                assert!(item.is_none());
                let resolved = resolved_item.as_ref().expect("hotbar3 resolved");
                assert_eq!(resolved.id, "minecraft:honeycomb");
                // count comes from the snapshot's hotbar entry, not from a
                // synthesized count-1.
                assert_eq!(resolved.count, 5);
            }
            other => panic!("expected UseItemOn, got {:?}", other),
        }
    }

    #[test]
    fn use_item_on_with_explicit_item_overrides_hotbar() {
        use flint_core::test_spec::BlockFace;

        let spec = parse(
            r#"{
                "name": "use_item_on_override",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [3, 3, 3]] },
                    "player": {
                        "inventory": {
                            "hotbar1": { "id": "minecraft:stone", "count": 1 }
                        },
                        "selected_hotbar": 1
                    }
                },
                "timeline": [
                    { "at": 0, "do": "use_item_on",
                      "pos": [0, 1, 0], "face": "north",
                      "item": "minecraft:honeycomb" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.frames.len(), 1);
        match &replay.frames[0].actions[0] {
            ActionEvent::UseItemOn {
                face,
                item,
                resolved_item,
                ..
            } => {
                assert!(matches!(face, BlockFace::North));
                assert_eq!(item.as_deref(), Some("minecraft:honeycomb"));
                let resolved = resolved_item.as_ref().expect("override resolved");
                assert_eq!(resolved.id, "minecraft:honeycomb");
                assert_eq!(resolved.count, 1);
            }
            other => panic!("expected UseItemOn, got {:?}", other),
        }
    }

    #[test]
    fn use_item_on_with_empty_hotbar_yields_no_resolved_item() {
        let spec = parse(
            r#"{
                "name": "use_item_on_empty",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "use_item_on",
                      "pos": [0, 0, 0], "face": "south" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.frames.len(), 1);
        match &replay.frames[0].actions[0] {
            ActionEvent::UseItemOn { resolved_item, .. } => {
                assert!(resolved_item.is_none());
            }
            other => panic!("expected UseItemOn, got {:?}", other),
        }
        // Confirm no spurious inventory delta was attached.
        assert!(replay.frames[0].inventory_diff.is_none());
    }

    #[test]
    fn select_hotbar_updates_snapshot_and_records_previous() {
        let spec = parse(
            r#"{
                "name": "select_hotbar_basic",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": { "selected_hotbar": 1 }
                },
                "timeline": [
                    { "at": 2, "do": "select_hotbar", "slot": 3 }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.tick, 2);

        match &frame.actions[0] {
            ActionEvent::SelectHotbar { slot } => assert_eq!(*slot, 3),
            other => panic!("expected SelectHotbar, got {:?}", other),
        }
        let delta = frame
            .inventory_diff
            .as_ref()
            .expect("select_hotbar must produce a PlayerDelta");
        let change = delta
            .selected_hotbar
            .as_ref()
            .expect("hotbar change recorded");
        assert_eq!(change.slot, 3);
        assert_eq!(change.previous, 1);
        assert!(delta.slots.is_empty());
        assert!(delta.game_mode.is_none());
        assert!(!frame.block_diff.iter().any(|_| true));
    }

    #[test]
    fn select_hotbar_drives_subsequent_use_item_on_resolution() {
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
                    { "at": 1, "do": "use_item_on",
                      "pos": [0, 1, 0], "face": "top" }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 2);

        match &replay.frames[1].actions[0] {
            ActionEvent::UseItemOn { resolved_item, .. } => {
                let resolved = resolved_item
                    .as_ref()
                    .expect("hotbar4 should resolve after select_hotbar");
                assert_eq!(resolved.id, "minecraft:honeycomb");
                assert_eq!(resolved.count, 6);
            }
            other => panic!("expected UseItemOn, got {:?}", other),
        }
    }

    #[test]
    fn select_hotbar_out_of_range_pushes_replay_error_and_skips_change() {
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
        assert_eq!(replay.errors[0].tick, 5);
        assert!(replay.errors[0].message.contains("slot 0"));
        assert_eq!(replay.errors[1].tick, 6);
        assert!(replay.errors[1].message.contains("slot 12"));

        // The ActionEvents are still emitted (so the timeline shows the
        // attempt), but no PlayerDelta is attached.
        assert_eq!(replay.frames.len(), 2);
        for frame in &replay.frames {
            assert_eq!(frame.actions.len(), 1);
            assert!(frame.inventory_diff.is_none());
        }
    }

    #[test]
    fn select_hotbar_repeats_within_a_tick_collapse_to_last_with_start_of_tick_previous() {
        let spec = parse(
            r#"{
                "name": "select_hotbar_repeats",
                "setup": {
                    "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] },
                    "player": { "selected_hotbar": 2 }
                },
                "timeline": [
                    { "at": 0, "do": "select_hotbar", "slot": 5 },
                    { "at": 0, "do": "select_hotbar", "slot": 8 }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        // Both ActionEvents still appear on the tick (timeline visibility).
        assert_eq!(frame.actions.len(), 2);
        let change = frame
            .inventory_diff
            .as_ref()
            .expect("delta present")
            .selected_hotbar
            .as_ref()
            .expect("hotbar change recorded");
        assert_eq!(change.slot, 8);
        // previous reflects start-of-tick (2), not the intermediate 5.
        assert_eq!(change.previous, 2);
    }

    #[test]
    fn assert_block_with_multiple_alternatives_emits_one_view_per_alternative() {
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
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert!(frame.actions.is_empty());
        assert!(frame.block_diff.is_empty());
        assert_eq!(frame.assertions.len(), 2);
        let ids: Vec<&str> = frame
            .assertions
            .iter()
            .map(|v| match v {
                AssertionView::Block { position, expected } => {
                    assert_eq!(*position, [0, 0, 0]);
                    expected.id.as_str()
                }
                other => panic!("expected Block assertion, got {:?}", other),
            })
            .collect();
        assert_eq!(ids, vec!["minecraft:stone", "minecraft:dirt"]);
    }

    #[test]
    fn assert_inventory_check_emits_inventory_view() {
        use flint_core::test_spec::PlayerSlot;

        let spec = parse(
            r#"{
                "name": "assert_inventory",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 4, "do": "assert", "checks": [
                        { "slot": "hotbar2", "is": {"id": "minecraft:honeycomb", "count": 3} }
                    ] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.tick, 4);
        assert!(frame.actions.is_empty());
        assert_eq!(frame.assertions.len(), 1);
        match &frame.assertions[0] {
            AssertionView::Inventory { slot, expected } => {
                assert_eq!(*slot, PlayerSlot::Hotbar2);
                let item = expected.as_ref().expect("item present");
                assert_eq!(item.id, "minecraft:honeycomb");
                assert_eq!(item.count, 3);
            }
            other => panic!("expected Inventory assertion, got {:?}", other),
        }
    }

    #[test]
    fn source_map_records_one_span_per_action_per_tick() {
        let spec = parse(
            r#"{
                "name": "src_basic",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": 0, "do": "place", "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} },
                    { "at": 1, "do": "remove", "pos": [0, 0, 0] }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.source_map.len(), 2);
        assert_eq!(replay.source_map[0].tick, 0);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
        assert_eq!(replay.source_map[1].tick, 1);
        assert_eq!(replay.source_map[1].event_index, 0);
        assert_eq!(replay.source_map[1].json_pointer, "/timeline/1");
    }

    #[test]
    fn source_map_assertion_event_index_follows_actions_in_merged_order() {
        // Per the merged-list convention (actions first, then assertions),
        // an assert on a tick that also has a `place` lands at event_index 1.
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
        assert_eq!(replay.frames.len(), 1);
        assert_eq!(replay.source_map.len(), 2);

        let action_span = &replay.source_map[0];
        assert_eq!(action_span.tick, 0);
        assert_eq!(action_span.event_index, 0);
        assert_eq!(action_span.json_pointer, "/timeline/0");

        let assert_span = &replay.source_map[1];
        assert_eq!(assert_span.tick, 0);
        // After the single action; not the natural per-stream local index of 0.
        assert_eq!(assert_span.event_index, 1);
        assert_eq!(assert_span.json_pointer, "/timeline/1");
    }

    #[test]
    fn source_map_blockspec_multiple_emits_consecutive_indices_same_pointer() {
        // `BlockSpec::Multiple` expands to one `AssertionView::Block` per
        // alternative — all under the same `/timeline/N` pointer with
        // consecutive `event_index` values.
        let spec = parse(
            r#"{
                "name": "src_multi",
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
        assert_eq!(replay.source_map.len(), 2);
        assert_eq!(replay.source_map[0].tick, 0);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
        assert_eq!(replay.source_map[1].tick, 0);
        assert_eq!(replay.source_map[1].event_index, 1);
        assert_eq!(replay.source_map[1].json_pointer, "/timeline/0");
    }

    #[test]
    fn source_map_multi_tick_at_emits_one_span_per_resulting_tick() {
        // `at: [0, 2, 4]` produces three frames; each gets its own span
        // pointing at the same `/timeline/0` entry.
        let spec = parse(
            r#"{
                "name": "src_multi_tick",
                "setup": { "cleanup": { "region": [[0, 0, 0], [1, 1, 1]] } },
                "timeline": [
                    { "at": [0, 2, 4], "do": "place",
                      "pos": [0, 0, 0], "block": {"id": "minecraft:stone"} }
                ]
            }"#,
        );

        let replay = compute(&spec);
        assert_eq!(replay.source_map.len(), 3);
        let ticks: Vec<u32> = replay.source_map.iter().map(|s| s.tick).collect();
        assert_eq!(ticks, vec![0, 2, 4]);
        for span in &replay.source_map {
            assert_eq!(span.event_index, 0);
            assert_eq!(span.json_pointer, "/timeline/0");
        }
    }

    #[test]
    fn source_map_place_each_emits_one_span_for_the_whole_entry() {
        // Per post-#0012: a `place_each` of N placements emits one
        // ActionEvent (and therefore one SourceSpan) at /timeline/N — not
        // one span per /timeline/N/blocks/M. The placements are inspectable
        // off the ActionEvent payload.
        let spec = parse(
            r#"{
                "name": "src_place_each",
                "setup": { "cleanup": { "region": [[-2, -2, -2], [2, 3, 2]] } },
                "timeline": [
                    { "at": 0, "do": "place_each", "blocks": [
                        { "pos": [0, 0, 0], "block": {"id": "minecraft:sand"} },
                        { "pos": [1, 0, 0], "block": {"id": "minecraft:sand"} },
                        { "pos": [2, 0, 0], "block": {"id": "minecraft:stone"} }
                    ] }
                ]
            }"#,
        );
        let replay = compute(&spec);
        assert_eq!(replay.source_map.len(), 1);
        assert_eq!(replay.source_map[0].tick, 0);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
    }

    #[test]
    fn source_map_interleaved_entries_keep_per_stream_local_indices() {
        // Two `place` entries and one `assert` interleaved on the same tick:
        // emission order is place(idx=0), assert(idx=1), place(idx=2). Final
        // frame.actions = [place0, place2]; frame.assertions = [assert1].
        // Expected merged event_indices: place0 → 0, assert1 → 2, place2 → 1.
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
        assert_eq!(replay.source_map.len(), 3);

        let span0 = &replay.source_map[0];
        assert_eq!(span0.json_pointer, "/timeline/0");
        assert_eq!(span0.event_index, 0);

        let span1 = &replay.source_map[1];
        assert_eq!(span1.json_pointer, "/timeline/1");
        // After both surviving actions in the merged list.
        assert_eq!(span1.event_index, 2);

        let span2 = &replay.source_map[2];
        assert_eq!(span2.json_pointer, "/timeline/2");
        assert_eq!(span2.event_index, 1);
    }

    #[test]
    fn source_map_empty_assert_check_list_emits_no_span() {
        // An `assert` with zero checks pushes nothing onto frame.assertions
        // and therefore must not generate a SourceSpan. (The frame itself
        // also gets dropped by the empty-frame filter.)
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
    fn source_map_oversize_fill_still_emits_span_for_the_action_event() {
        // A rejected fill still emits its `ActionEvent::Fill` so the timeline
        // surfaces the attempt — its source span should land alongside it.
        let spec = parse(
            r#"{
                "name": "src_huge_fill",
                "setup": { "cleanup": { "region": [[0, 0, 0], [49, 49, 49]] } },
                "timeline": [
                    { "at": 7, "do": "fill",
                      "region": [[0, 0, 0], [49, 49, 49]],
                      "with": {"id": "minecraft:stone"} }
                ]
            }"#,
        );
        let replay = compute(&spec);
        assert_eq!(replay.source_map.len(), 1);
        assert_eq!(replay.source_map[0].tick, 7);
        assert_eq!(replay.source_map[0].event_index, 0);
        assert_eq!(replay.source_map[0].json_pointer, "/timeline/0");
    }

    #[test]
    fn assert_alongside_place_on_same_tick_keeps_both() {
        let spec = parse(
            r#"{
                "name": "place_then_assert_same_tick",
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
        assert!(replay.errors.is_empty());
        assert_eq!(replay.frames.len(), 1);
        let frame = &replay.frames[0];
        assert_eq!(frame.actions.len(), 1);
        assert_eq!(frame.block_diff.len(), 1);
        assert_eq!(frame.assertions.len(), 1);
    }
}
