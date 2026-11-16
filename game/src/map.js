// map.js — "Harbourlight Depot": an original container-port map for a
// round-based tactical FPS. Two spawn yards, three east-west streets, two bomb
// sites in the north-east (A) and south-east (B) yards, container blocks for
// cover, a waypoint graph the bots navigate, and AABB colliders the
// simulation uses for movement, bullets and sight lines.
//
// Layout (metres, x east, z south, ground plane 100 x 68):
//   Wreckers (attack) spawn west, Wardens (defence) spawn east.
//   North street z=-22, mid street z=0, south street z=+22.
//   Vertical streets at x=-38 (west), x=0 (centre), x=26 (site approach).

import * as THREE from 'three';

export const PALETTE = {
  asphalt: 0x2e3138,
  linePaint: 0xd8d3c3,
  containerRed: 0xa63a2e,
  containerTeal: 0x2e6f6a,
  containerGold: 0xc78f2d,
  containerSlate: 0x4a5a6a,
  containerPlum: 0x6a4a5e,
  crate: 0x8a6f4d,
  wall: 0x707880,
  roof: 0x3c4148,
  accentA: 0xff7847,
  accentB: 0x47c8ff,
  lamp: 0xffd9a0,
};

const CONTAINER_COLORS = [
  PALETTE.containerRed, PALETTE.containerTeal, PALETTE.containerGold,
  PALETTE.containerSlate, PALETTE.containerPlum,
];

// The waypoint graph: [x, z] pairs, edges below. Bots path with BFS over it.
export const WAYPOINTS = [
  [-44, 0], [-38, -22], [-38, 0], [-38, 22], [-24, -22], [-24, 0], [-24, 22],
  [0, -22], [0, 0], [0, 22], [16, -22], [16, 0], [16, 22], [26, -22],
  [26, 0], [26, 22], [38, -22], [38, 22], [44, 0], [42, -27], [31, -27],
  [42, 27], [31, 27], [40, -12], [40, 12],
];
export const EDGES = [
  [0, 2], [2, 1], [2, 3], [1, 4], [3, 6], [4, 7], [5, 8], [6, 9], [7, 10],
  [8, 11], [9, 12], [10, 13], [11, 14], [12, 15], [13, 16], [15, 17],
  [16, 19], [16, 20], [17, 21], [17, 22], [14, 18], [18, 23], [18, 24],
  [23, 16], [24, 17], [7, 8], [8, 9], [13, 14], [14, 15], [4, 5], [5, 6],
];

export const SITES = [
  { name: 'A', x: 38, z: -22, radius: 7.5 },
  { name: 'B', x: 38, z: 22, radius: 7.5 },
];
export const SPAWNS = {
  attack: [[-44, -3], [-44, 0], [-44, 3], [-45, -6], [-45, 6]],
  defend: [[44, -3], [44, 0], [44, 3], [45, -6], [45, 6]],
};

export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [toIdx];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  const adj = findPath.adj ??= EDGES.reduce((acc, [a, b]) => {
    (acc[a] ??= []).push(b);
    (acc[b] ??= []).push(a);
    return acc;
  }, {});
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj[cur] ?? []) {
      if (prev[next] === -1) {
        prev[next] = cur;
        if (next === toIdx) {
          const path = [toIdx];
          let n = toIdx;
          while (n !== fromIdx) { n = prev[n]; path.unshift(n); }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [toIdx];
}

// A canvas texture for the ground: asphalt, street paint, site circles.
// Drawn once at load with a fixed pattern — deterministic, no assets.
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 696;
  const g = c.getContext('2d');
  g.fillStyle = '#4a5058';
  g.fillRect(0, 0, c.width, c.height);
  // Asphalt speckle.
  for (let i = 0; i < 2600; i++) {
    const x = (i * 37.7) % c.width;
    const y = (i * 91.3) % c.height;
    g.fillStyle = i % 3 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
    g.fillRect(x, y, 2, 2);
  }
  const px = (x) => ((x + 50) / 100) * c.width;
  const pz = (z) => ((z + 34) / 68) * c.height;
  // Street centrelines.
  g.strokeStyle = 'rgba(216,211,195,0.5)';
  g.lineWidth = 2;
  g.setLineDash([14, 12]);
  for (const z of [-22, 0, 22]) {
    g.beginPath(); g.moveTo(px(-48), pz(z)); g.lineTo(px(48), pz(z)); g.stroke();
  }
  g.setLineDash([]);
  // Site circles and letters.
  for (const [site, color] of [[SITES[0], '#ff7847'], [SITES[1], '#47c8ff']]) {
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(px(site.x), pz(site.z), (site.radius / 100) * c.width, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color;
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(site.name, px(site.x), pz(site.z));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMap(scene) {
  const colliders = [];
  const boxGeoCache = new Map();
  const matCache = new Map();
  const mat = (color, rough = 0.85) => {
    if (!matCache.has(color)) {
      matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08 }));
    }
    return matCache.get(color);
  };
  // Add a visual box + its collider. h is its height; y0 lets stacks float.
  function box(cx, cz, w, d, h, color, y0 = 0, collide = true) {
    const key = `${w}x${d}x${h}`;
    if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    const mesh = new THREE.Mesh(boxGeoCache.get(key), mat(color));
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) {
      colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: y0 + h });
    }
    return mesh;
  }
  const container = (cx, cz, alongX, color, stack = 1) => {
    const w = alongX ? 6 : 2.4;
    const d = alongX ? 2.4 : 6;
    for (let s = 0; s < stack; s++) box(cx, cz, w, d, 2.6, color, s * 2.6, s === 0);
    // A stacked box's collider must reach the top of the stack.
    if (stack > 1) colliders[colliders.length - 1].h = stack * 2.6;
  };
  const crate = (cx, cz) => box(cx, cz, 1.6, 1.6, 1.2, PALETTE.crate);

  // Ground and sky.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 68),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.background = new THREE.Color(0x2b3444);
  scene.fog = new THREE.Fog(0x2b3444, 55, 130);

  // Perimeter walls.
  box(0, -34, 100, 1, 5, PALETTE.wall);
  box(0, 34, 100, 1, 5, PALETTE.wall);
  box(-50, 0, 1, 68, 5, PALETTE.wall);
  box(50, 0, 1, 68, 5, PALETTE.wall);

  // The four blocks between the streets: solid two-high container stacks
  // (visual mass and collider agree — a fighter can neither see nor walk
  // through any part of them), capped with a darker slab.
  const block = (cx, cz, colorA, colorB) => {
    box(cx, cz, 22, 9, 2.6, colorA);
    box(cx, cz, 22, 9, 2.6, colorB, 2.6, false);
    colliders[colliders.length - 1].h = 5.2;
    box(cx, cz, 22.6, 9.6, 0.25, PALETTE.roof, 5.2, false);
  };
  block(-19, -11, CONTAINER_COLORS[0], CONTAINER_COLORS[3]);
  block(-19, 11, CONTAINER_COLORS[1], CONTAINER_COLORS[4]);
  block(13, -11, CONTAINER_COLORS[2], CONTAINER_COLORS[0]);
  block(13, 11, CONTAINER_COLORS[3], CONTAINER_COLORS[1]);

  // Street-edge cover.
  container(-18, -18.4, true, CONTAINER_COLORS[1]);
  container(8, -18.4, true, CONTAINER_COLORS[4]);
  container(-18, 18.4, true, CONTAINER_COLORS[2]);
  container(8, 18.4, true, CONTAINER_COLORS[0]);
  container(-12, 5.6, true, CONTAINER_COLORS[3]); // mid cross cover
  container(8, -5.6, true, CONTAINER_COLORS[1]);

  // East wall between the sites and the defence spawn, with a mid door.
  box(30, -8, 4, 9, 5, PALETTE.wall);
  box(30, 8, 4, 9, 5, PALETTE.wall);

  // Site A yard: crane, containers, crates.
  container(34, -29.5, true, CONTAINER_COLORS[0]);
  container(43, -15.5, false, CONTAINER_COLORS[2]);
  container(31.5, -14.5, true, CONTAINER_COLORS[1], 2);
  crate(38, -18.5);
  crate(36.2, -25.5);
  // Site B yard, mirrored.
  container(34, 29.5, true, CONTAINER_COLORS[3]);
  container(43, 15.5, false, CONTAINER_COLORS[4]);
  container(31.5, 14.5, true, CONTAINER_COLORS[0], 2);
  crate(38, 18.5);
  crate(36.2, 25.5);

  // Spawn-yard dressing.
  container(-46, -10, false, CONTAINER_COLORS[4]);
  container(-46, 10, false, CONTAINER_COLORS[2]);
  crate(42, -4);
  crate(42, 4);

  // Crane over site A (legs collide, beam is dressing).
  box(30, -29, 0.8, 0.8, 11, PALETTE.containerGold);
  box(46, -29, 0.8, 0.8, 11, PALETTE.containerGold);
  box(38, -29, 17, 1, 1, PALETTE.containerGold, 10.4, false);
  box(38, -29, 0.3, 3.4, 0.3, PALETTE.roof, 6.8, false);

  // Lamp posts: poles plus warm point lights at the two sites and mid.
  const lampAt = (x, z) => {
    box(x, z, 0.25, 0.25, 6, PALETTE.roof);
    const light = new THREE.PointLight(PALETTE.lamp, 60, 26, 1.8);
    light.position.set(x, 5.8, z);
    scene.add(light);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: PALETTE.lamp, emissive: PALETTE.lamp, emissiveIntensity: 2.4 }),
    );
    bulb.position.set(x, 5.9, z);
    scene.add(bulb);
  };
  lampAt(38, -22);
  lampAt(38, 22);
  lampAt(0, 0);

  // Dusk sun with shadows, plus a cool ambient fill.
  const sun = new THREE.DirectionalLight(0xffc490, 3.4);
  sun.position.set(-30, 46, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9db4d6, 0x4a4038, 1.25));

  return { colliders };
}
