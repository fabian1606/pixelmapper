use rstar::{RTree, AABB, Envelope, RTreeObject};
use crate::types::FixtureCanvasData;

const FIXTURE_RADIUS: f32 = 18.0;

#[derive(Debug, Clone)]
pub struct FixtureNode {
    pub id: String,
    pub center_x: f32, // world pixels
    pub center_y: f32, // world pixels
    pub half_width: f32,  // world pixels
    pub half_height: f32, // world pixels
    pub rotation: f32,    // degrees, clockwise around the center
}

impl FixtureNode {
    /// Half extents of the axis-aligned box enclosing the rotated body.
    fn rotated_half_extents(&self) -> (f32, f32) {
        let rot = self.rotation.to_radians();
        let (c, s) = (rot.cos().abs(), rot.sin().abs());
        (
            self.half_width * c + self.half_height * s,
            self.half_width * s + self.half_height * c,
        )
    }

    /// Precise test against the rotated body rectangle (world pixels).
    pub fn contains_rotated(&self, wx: f32, wy: f32) -> bool {
        let rot = self.rotation.to_radians();
        let (cos_r, sin_r) = (rot.cos(), rot.sin());
        let dx = wx - self.center_x;
        let dy = wy - self.center_y;
        // Transform the point into the fixture's local (unrotated) frame.
        let lx =  dx * cos_r + dy * sin_r;
        let ly = -dx * sin_r + dy * cos_r;
        lx.abs() <= self.half_width && ly.abs() <= self.half_height
    }
}

impl rstar::RTreeObject for FixtureNode {
    type Envelope = AABB<[f32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        // Enclose the rotated body so rotated fixtures stay grabbable along
        // their whole length (precise filtering happens in hit_test_all).
        let (hw, hh) = self.rotated_half_extents();
        AABB::from_corners(
            [self.center_x - hw, self.center_y - hh],
            [self.center_x + hw, self.center_y + hh],
        )
    }
}

impl rstar::PointDistance for FixtureNode {
    fn distance_2(&self, point: &[f32; 2]) -> f32 {
        self.envelope().distance_2(point)
    }
}

pub struct SpatialIndex {
    pub tree: RTree<FixtureNode>,
}

impl SpatialIndex {
    pub fn new() -> Self {
        Self { tree: RTree::new() }
    }

    pub fn rebuild(&mut self, fixtures: &[FixtureCanvasData], world_w: f32, world_h: f32) {
        let nodes: Vec<FixtureNode> = fixtures.iter().map(|f| FixtureNode {
            id: f.id.clone(),
            center_x: f.world_x * world_w,
            center_y: f.world_y * world_h,
            half_width:  f.width  * FIXTURE_RADIUS,
            half_height: f.height * FIXTURE_RADIUS,
            rotation: f.rotation,
        }).collect();
        self.tree = RTree::bulk_load(nodes);
    }

    /// Hit test in world-pixel space.
    pub fn hit_test(&self, wx: f32, wy: f32) -> Option<String> {
        self.tree.locate_all_at_point(&[wx, wy])
            .find(|n| n.contains_rotated(wx, wy))
            .map(|n| n.id.clone())
    }

    /// Returns every fixture id whose rotated body contains the point.
    /// Order is unspecified; callers should apply their own priority logic.
    pub fn hit_test_all(&self, wx: f32, wy: f32) -> Vec<String> {
        self.tree.locate_all_at_point(&[wx, wy])
            .filter(|n| n.contains_rotated(wx, wy))
            .map(|n| n.id.clone())
            .collect()
    }

    pub fn marquee_select(&self, start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> Vec<String> {
        let min_x = start_x.min(end_x);
        let max_x = start_x.max(end_x);
        let min_y = start_y.min(end_y);
        let max_y = start_y.max(end_y);
        let env = AABB::from_corners([min_x, min_y], [max_x, max_y]);
        self.tree.locate_in_envelope_intersecting(&env)
            .map(|node| node.id.clone())
            .collect()
    }
}
