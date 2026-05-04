//! Helpers for threading the running [`PlayerSnapshot`] through the timeline
//! loop and recording deltas onto the current [`TickFrame`].
//!
//! #0014 wires the foundation: the engine keeps a mutable snapshot alongside
//! the per-tick frames, and these helpers will be the only entry points used
//! by the per-action arms landing in #0037 (`set_slot`), #0038 (`use_item_on`)
//! and #0039 (`select_hotbar`). The helpers always update both the snapshot
//! and the tick's [`PlayerDelta`] so reverse-scrubbing works in the frontend
//! store (#0018) without a second pass.


use flint_core::test_spec::{GameMode, Item, PlayerSlot};

use super::model::{
    GameModeChange, HotbarChange, PlayerDelta, PlayerSnapshot, SlotChange, TickFrame,
};

/// Get-or-init the tick's [`PlayerDelta`]. The engine post-pass drops any
/// delta that ended up empty, so callers can lazily allocate without having
/// to reason about whether something else on this tick already did.
pub fn inventory_diff_mut(frame: &mut TickFrame) -> &mut PlayerDelta {
    frame.inventory_diff.get_or_insert_with(PlayerDelta::default)
}

/// Apply a slot write to the running snapshot and record it on the delta.
/// `item: None` clears the slot. The previous value is captured so the
/// frontend can reverse-scrub in O(1).
pub fn record_slot_change(
    snapshot: &mut PlayerSnapshot,
    delta: &mut PlayerDelta,
    slot: PlayerSlot,
    item: Option<Item>,
) {
    let previous = snapshot.inventory.get(&slot).cloned();
    match &item {
        Some(new_item) => {
            snapshot.inventory.insert(slot, new_item.clone());
        }
        None => {
            snapshot.inventory.remove(&slot);
        }
    }
    delta.slots.push(SlotChange {
        slot,
        item,
        previous,
    });
}

/// Resolve the item used by a `use_item_on` action. If `override_id` is
/// `Some`, that wins (built as `Item::new`, count 1, no NBT). Otherwise the
/// currently-selected hotbar slot is consulted; if that slot is empty or the
/// selection is out of range (`hotbar()` rejects 0 / 10+), `None` is returned
/// and the frontend will render the action with an "unknown item" badge.
pub fn resolve_active_item(snapshot: &PlayerSnapshot, override_id: &Option<String>) -> Option<Item> {
    if let Some(id) = override_id {
        return Some(Item::new(id));
    }
    let slot = PlayerSlot::hotbar(snapshot.selected_hotbar)?;
    snapshot.inventory.get(&slot).cloned()
}

/// Apply a hotbar selection. Last write within a tick wins — only the final
/// `HotbarChange` is kept, but its `previous` always reflects the snapshot
/// value at the start of the tick (so a reverse scrub lands in one hop).
pub fn record_hotbar_change(snapshot: &mut PlayerSnapshot, delta: &mut PlayerDelta, slot: u8) {
    let previous = match &delta.selected_hotbar {
        Some(existing) => existing.previous,
        None => snapshot.selected_hotbar,
    };
    snapshot.selected_hotbar = slot;
    delta.selected_hotbar = Some(HotbarChange { slot, previous });
}

/// Apply a gamemode change. Same last-write-wins / start-of-tick `previous`
/// rule as [`record_hotbar_change`]. No `set_game_mode` action exists in
/// flint-core today; kept symmetrical with the slot/hotbar helpers so a
/// future variant can drop in without re-deriving the pattern.
#[allow(dead_code)]
pub fn record_game_mode_change(
    snapshot: &mut PlayerSnapshot,
    delta: &mut PlayerDelta,
    mode: GameMode,
) {
    let previous = match &delta.game_mode {
        Some(existing) => existing.previous.clone(),
        None => snapshot.game_mode.clone(),
    };
    snapshot.game_mode = mode.clone();
    delta.game_mode = Some(GameModeChange { mode, previous });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay::model::TickFrame;

    fn empty_frame() -> TickFrame {
        TickFrame {
            tick: 0,
            actions: Vec::new(),
            block_diff: Vec::new(),
            inventory_diff: None,
            assertions: Vec::new(),
        }
    }

    #[test]
    fn inventory_diff_mut_lazily_allocates_then_returns_same_delta() {
        let mut frame = empty_frame();
        assert!(frame.inventory_diff.is_none());
        {
            let delta = inventory_diff_mut(&mut frame);
            delta.selected_hotbar = Some(HotbarChange {
                slot: 3,
                previous: 1,
            });
        }
        assert!(frame.inventory_diff.is_some());
        // Second call must return the *same* delta (not overwrite it).
        {
            let delta = inventory_diff_mut(&mut frame);
            assert_eq!(delta.selected_hotbar.as_ref().unwrap().slot, 3);
        }
    }

    #[test]
    fn record_slot_change_set_then_clear_captures_previous() {
        let mut snap = PlayerSnapshot::default();
        let mut delta = PlayerDelta::default();

        record_slot_change(
            &mut snap,
            &mut delta,
            PlayerSlot::Hotbar1,
            Some(Item::new("minecraft:stone")),
        );
        assert_eq!(snap.inventory[&PlayerSlot::Hotbar1].id, "minecraft:stone");
        assert_eq!(delta.slots.len(), 1);
        assert_eq!(delta.slots[0].slot, PlayerSlot::Hotbar1);
        assert!(delta.slots[0].previous.is_none());
        assert_eq!(
            delta.slots[0].item.as_ref().map(|i| i.id.as_str()),
            Some("minecraft:stone")
        );

        // Clearing the same slot now sees `previous = Some(stone)`.
        record_slot_change(&mut snap, &mut delta, PlayerSlot::Hotbar1, None);
        assert!(!snap.inventory.contains_key(&PlayerSlot::Hotbar1));
        assert_eq!(delta.slots.len(), 2);
        assert_eq!(
            delta.slots[1].previous.as_ref().map(|i| i.id.as_str()),
            Some("minecraft:stone")
        );
        assert!(delta.slots[1].item.is_none());
    }

    #[test]
    fn record_hotbar_change_collapses_repeats_but_keeps_start_of_tick_previous() {
        let mut snap = PlayerSnapshot::default(); // selected_hotbar = 1
        let mut delta = PlayerDelta::default();

        record_hotbar_change(&mut snap, &mut delta, 4);
        record_hotbar_change(&mut snap, &mut delta, 7);

        let change = delta.selected_hotbar.expect("hotbar change recorded");
        assert_eq!(change.slot, 7);
        // previous reflects start-of-tick value, not the intermediate `4`.
        assert_eq!(change.previous, 1);
        assert_eq!(snap.selected_hotbar, 7);
    }

    #[test]
    fn record_game_mode_change_collapses_repeats_but_keeps_start_of_tick_previous() {
        let mut snap = PlayerSnapshot::default(); // game_mode = Creative
        let mut delta = PlayerDelta::default();

        record_game_mode_change(&mut snap, &mut delta, GameMode::Survival);
        record_game_mode_change(&mut snap, &mut delta, GameMode::Adventure);

        let change = delta.game_mode.expect("game mode change recorded");
        assert!(matches!(change.mode, GameMode::Adventure));
        assert!(matches!(change.previous, GameMode::Creative));
        assert!(matches!(snap.game_mode, GameMode::Adventure));
    }
}
