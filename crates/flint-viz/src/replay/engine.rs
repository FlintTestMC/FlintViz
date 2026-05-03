//! Walk a `TestSpec` timeline and produce a `Replay`.
//!
//! #0011 covers `place` and `fill` only. Other action variants are accepted
//! by the dispatch but currently no-op — they get filled in by #0012–#0015,
//! #0037–#0039.

use std::collections::BTreeMap;

use flint_core::test_spec::{ActionType, TestSpec};

use super::aabb::iter_aabb;
use super::model::{
    Aabb, ActionEvent, BlockChange, PlayerSnapshot, Replay, ReplayError, TickFrame,
};

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

    for entry in &spec.timeline {
        for tick in entry.at.to_vec() {
            let frame = frames.entry(tick).or_insert_with(|| TickFrame {
                tick,
                actions: Vec::new(),
                block_diff: Vec::new(),
                inventory_diff: None,
                assertions: Vec::new(),
            });
            apply_action(frame, &entry.action_type, &mut snapshot, &mut errors);
        }
    }

    Replay {
        name: spec.name.clone(),
        cleanup_region,
        initial_player,
        max_tick,
        // Drop ticks that ended up empty — happens when every action on that
        // tick is from a variant the engine doesn't handle yet (e.g. `assert`
        // before #0015 lands). Also drop a `PlayerDelta` that was lazily
        // allocated but ended up empty, so empty deltas never reach the wire.
        frames: frames
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
            .collect(),
        breakpoints: spec.breakpoints.clone(),
        errors,
        source_map: Vec::new(),
    }
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
    _snapshot: &mut PlayerSnapshot,
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
        // Variants below land in #0014–#0015, #0037–#0039.
        ActionType::Assert { .. }
        | ActionType::UseItemOn { .. }
        | ActionType::SetSlot { .. }
        | ActionType::SelectHotbar { .. } => {}
    }
}

#[cfg(test)]
mod tests {
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

        // Frames only exist for ticks with handled actions (assertions are
        // collected by #0015), so we get exactly the two `place` ticks.
        assert_eq!(replay.frames.len(), 2);
        assert_eq!(replay.frames[0].tick, 0);
        assert_eq!(replay.frames[1].tick, 2);

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
        assert!(matches!(&frame.actions[0], ActionEvent::Fill { region, .. } if region.min == [0,0,0] && region.max == [1,1,1]));
        // 2 * 2 * 2 = 8 positions
        assert_eq!(frame.block_diff.len(), 8);
        for change in &frame.block_diff {
            assert!(matches!(change, BlockChange::Set { block, .. } if block.id == "minecraft:dirt"));
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
                    placements[3].block.properties.get("age").map(String::as_str),
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
        assert!(matches!(replay.initial_player.game_mode, GameMode::Creative));
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
        assert!(matches!(replay.initial_player.game_mode, GameMode::Survival));
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
}
