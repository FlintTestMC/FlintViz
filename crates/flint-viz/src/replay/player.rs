//! Helpers for threading the running [`PlayerSnapshot`] through the timeline
//! loop.
//!
//! With the unified `TickEvent` stream the engine no longer records
//! `PlayerDelta`s on each frame — the frontend re-runs event semantics to
//! derive inventory state. The engine still tracks a mutable snapshot so
//! `use_item_on` can resolve the currently-selected hotbar item.

use flint_core::test_spec::{Item, PlayerSlot};

use super::model::PlayerSnapshot;

/// Apply a slot write to the running snapshot. `item: None` clears the slot.
pub fn apply_slot_change(
    snapshot: &mut PlayerSnapshot,
    slot: PlayerSlot,
    item_id: Option<&str>,
    count: u8,
) {
    match item_id {
        Some(id) => {
            snapshot.inventory.insert(
                slot,
                Item {
                    id: id.to_owned(),
                    count,
                    data: Default::default(),
                },
            );
        }
        None => {
            snapshot.inventory.remove(&slot);
        }
    }
}

/// Resolve the item used by a `use_item_on` action. If `override_id` is
/// `Some`, that wins (built as `Item::new`, count 1, no NBT). Otherwise the
/// currently-selected hotbar slot is consulted; if that slot is empty or the
/// selection is out of range, `None` is returned.
pub fn resolve_active_item(
    snapshot: &PlayerSnapshot,
    override_id: &Option<String>,
) -> Option<Item> {
    if let Some(id) = override_id {
        return Some(Item::new(id));
    }
    let slot = PlayerSlot::hotbar(snapshot.selected_hotbar)?;
    snapshot.inventory.get(&slot).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_slot_change_inserts_and_clears() {
        let mut snap = PlayerSnapshot::default();
        apply_slot_change(&mut snap, PlayerSlot::Hotbar1, Some("minecraft:stone"), 4);
        let stored = snap.inventory.get(&PlayerSlot::Hotbar1).unwrap();
        assert_eq!(stored.id, "minecraft:stone");
        assert_eq!(stored.count, 4);

        apply_slot_change(&mut snap, PlayerSlot::Hotbar1, None, 0);
        assert!(snap.inventory.get(&PlayerSlot::Hotbar1).is_none());
    }

    #[test]
    fn resolve_active_item_uses_override_when_present() {
        let mut snap = PlayerSnapshot::default();
        snap.inventory.insert(
            PlayerSlot::Hotbar1,
            Item {
                id: "minecraft:stone".into(),
                count: 1,
                data: Default::default(),
            },
        );
        let resolved = resolve_active_item(&snap, &Some("minecraft:honeycomb".into())).unwrap();
        assert_eq!(resolved.id, "minecraft:honeycomb");
    }

    #[test]
    fn resolve_active_item_falls_back_to_selected_hotbar() {
        let mut snap = PlayerSnapshot::default();
        snap.selected_hotbar = 3;
        snap.inventory.insert(
            PlayerSlot::Hotbar3,
            Item {
                id: "minecraft:honeycomb".into(),
                count: 5,
                data: Default::default(),
            },
        );
        let resolved = resolve_active_item(&snap, &None).unwrap();
        assert_eq!(resolved.id, "minecraft:honeycomb");
        assert_eq!(resolved.count, 5);
    }
}
