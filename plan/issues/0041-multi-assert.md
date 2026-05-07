# 0041 Support Multi Assert

**Milestone**: M9

## Goal
Currently only the first assert will be displayed, so a method is needed to display the different options.

## flint-core reference
`~/flint/flint-core/src/test_spec.rs` line 414:

```rust
pub enum BlockSpec {
    Single(Block),
    Multiple(Vec<Block>),
}
```

## Outcome
- option to select which spec is asserted/displayed here