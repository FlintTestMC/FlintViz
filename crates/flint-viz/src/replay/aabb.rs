//! AABB iteration helpers shared by `place`, `fill`, and (later) `remove`.

use super::model::Aabb;

impl Aabb {
    /// Number of integer lattice points contained in the box.
    /// Returns 0 if any axis is inverted (`min > max`).
    pub fn volume(&self) -> u64 {
        let dx = self.max[0] as i64 - self.min[0] as i64 + 1;
        let dy = self.max[1] as i64 - self.min[1] as i64 + 1;
        let dz = self.max[2] as i64 - self.min[2] as i64 + 1;
        if dx <= 0 || dy <= 0 || dz <= 0 {
            return 0;
        }
        (dx as u64) * (dy as u64) * (dz as u64)
    }
}

/// Iterate every integer position contained in `aabb` (inclusive on both ends).
/// Yields nothing if any axis is inverted.
#[allow(dead_code)]
pub fn iter_aabb(aabb: Aabb) -> impl Iterator<Item = [i32; 3]> {
    let Aabb { min, max } = aabb;
    (min[0]..=max[0]).flat_map(move |x| {
        (min[1]..=max[1]).flat_map(move |y| (min[2]..=max[2]).map(move |z| [x, y, z]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_counts_inclusive_lattice_points() {
        let a = Aabb {
            min: [0, 0, 0],
            max: [1, 1, 1],
        };
        assert_eq!(a.volume(), 8);
    }

    #[test]
    fn volume_inverted_box_is_zero() {
        let a = Aabb {
            min: [5, 0, 0],
            max: [4, 0, 0],
        };
        assert_eq!(a.volume(), 0);
    }

    #[test]
    fn iter_yields_every_position_once() {
        let a = Aabb {
            min: [0, 0, 0],
            max: [1, 0, 1],
        };
        let positions: Vec<_> = iter_aabb(a).collect();
        assert_eq!(positions.len(), 4);
        assert!(positions.contains(&[0, 0, 0]));
        assert!(positions.contains(&[1, 0, 0]));
        assert!(positions.contains(&[0, 0, 1]));
        assert!(positions.contains(&[1, 0, 1]));
    }
}
