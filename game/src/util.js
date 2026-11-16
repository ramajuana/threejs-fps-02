// util.js — small shared helpers for Harbourlight: a seeded RNG (so staged
// screenshot scenes and bot decisions are reproducible), scalar math, and the
// axis-aligned box tests the simulation uses for movement and bullets.

export function makeRng(seed) {
  // mulberry32: tiny, fast, and good enough for bot jitter and staging.
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest signed angular distance from a to b, in radians.
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function yawTowards(from, to) {
  return Math.atan2(-(to.z - from.z), to.x - from.x);
}

// A collider is { minX, maxX, minZ, maxZ, h } — a box standing on the ground.
// Circle-vs-box resolution on the ground plane: push the circle out along the
// smallest penetration axis. Returns true when a push happened.
export function resolveCircle(pos, radius, box) {
  const cx = clamp(pos.x, box.minX, box.maxX);
  const cz = clamp(pos.z, box.minZ, box.maxZ);
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * radius;
    pos.z = cz + (dz / d) * radius;
  } else {
    // Centre inside the box: leave through the nearest face.
    const left = pos.x - box.minX;
    const right = box.maxX - pos.x;
    const top = pos.z - box.minZ;
    const bottom = box.maxZ - pos.z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) pos.x = box.minX - radius;
    else if (m === right) pos.x = box.maxX + radius;
    else if (m === top) pos.z = box.minZ - radius;
    else pos.z = box.maxZ + radius;
  }
  return true;
}

// Segment (a ray with a length) vs a ground box, slab method. Returns the
// distance along the ray to the first hit, or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, box) {
  const minY = 0;
  const maxY = box.h;
  let t0 = 0;
  let t1 = Infinity;
  const axes = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, minY, maxY],
    [oz, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

// Distance from a point to the nearest point of a box (0 when inside).
export function distToBox(x, z, box) {
  const cx = clamp(x, box.minX, box.maxX);
  const cz = clamp(z, box.minZ, box.maxZ);
  return Math.hypot(x - cx, z - cz);
}

export const V = {
  // Reusable scratch values so hot loops allocate nothing.
  a: { x: 0, y: 0, z: 0 },
  b: { x: 0, y: 0, z: 0 },
};
