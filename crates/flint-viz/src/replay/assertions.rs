//! Convert `flint_core::test_spec::AssertType` checks into wire-shaped
//! [`AssertionView`]s. One `assert` timeline action produces ONE
//! [`TickEvent::Assert`] carrying all its views (the engine wraps them).
//!
//! Convention for `BlockSpec::Multiple`: emit one [`AssertionView::Block`] per
//! expected block.

use flint_core::test_spec::{AssertType, BlockCheck, InventoryCheck};

use super::model::AssertionView;

pub fn views_from_check(check: &AssertType, out: &mut Vec<AssertionView>) {
    match check {
        AssertType::Block(BlockCheck { pos, is }) => {
            for expected in is.to_vec() {
                out.push(AssertionView::Block {
                    position: *pos,
                    expected,
                });
            }
        }
        AssertType::Inventory(InventoryCheck { slot, is }) => {
            out.push(AssertionView::Inventory {
                slot: *slot,
                expected: is.clone(),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flint_core::test_spec::{Block, BlockSpec, Item, PlayerSlot};

    #[test]
    fn block_check_with_single_spec_emits_one_view() {
        let check = AssertType::Block(BlockCheck {
            pos: [1, 2, 3],
            is: BlockSpec::Single(Block::new("minecraft:stone")),
        });
        let mut out = Vec::new();
        views_from_check(&check, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            AssertionView::Block { position, expected } => {
                assert_eq!(*position, [1, 2, 3]);
                assert_eq!(expected.id, "minecraft:stone");
            }
            other => panic!("expected Block, got {:?}", other),
        }
    }

    #[test]
    fn block_check_with_multiple_spec_emits_one_view_per_block() {
        let check = AssertType::Block(BlockCheck {
            pos: [4, 5, 6],
            is: BlockSpec::Multiple(vec![
                Block::new("minecraft:stone"),
                Block::new("minecraft:dirt"),
                Block::new("minecraft:oak_planks"),
            ]),
        });
        let mut out = Vec::new();
        views_from_check(&check, &mut out);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn inventory_check_passes_through_slot_and_item() {
        let check = AssertType::Inventory(InventoryCheck {
            slot: PlayerSlot::Hotbar3,
            is: Some(Item::new("minecraft:honeycomb")),
        });
        let mut out = Vec::new();
        views_from_check(&check, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            AssertionView::Inventory { slot, expected } => {
                assert_eq!(*slot, PlayerSlot::Hotbar3);
                let item = expected.as_ref().expect("item present");
                assert_eq!(item.id, "minecraft:honeycomb");
            }
            other => panic!("expected Inventory, got {:?}", other),
        }
    }

    #[test]
    fn inventory_check_with_no_item_emits_inventory_view_with_none() {
        let check = AssertType::Inventory(InventoryCheck {
            slot: PlayerSlot::Hotbar1,
            is: None,
        });
        let mut out = Vec::new();
        views_from_check(&check, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            AssertionView::Inventory { slot, expected } => {
                assert_eq!(*slot, PlayerSlot::Hotbar1);
                assert!(expected.is_none());
            }
            other => panic!("expected Inventory, got {:?}", other),
        }
    }
}
