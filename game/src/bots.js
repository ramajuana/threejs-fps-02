// bots.js — the fighters who are not the player: a low-poly humanoid built
// from boxes (with separate head and body hit volumes), and a brain that
// routes over the map's waypoint graph, holds ground, hears gunfire, sees
// through a vision cone with line-of-sight checks, and fights in bursts —
// stopping to shoot, because in Harbourlight accuracy beats speed.

import * as THREE from 'three';
import { WAYPOINTS, EDGES, nearestWaypoint, findPath } from './map.js';
import { angleDelta, clamp, yawTowards } from './util.js';
import { stepMovement } from './player.js';

export const TEAM_STYLE = {
  attack: { cloth: 0xc75b26, vest: 0x5e3a22, skin: 0xc89878, trim: 0xffd9a0 },
  defend: { cloth: 0x2e6f8f, vest: 0x22384a, skin: 0xa87858, trim: 0x9fe8ff },
};

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05 }));
  return matCache.get(color);
}

// A standing fighter, feet at the group origin, facing +x at yaw 0.
// userData.head / userData.body are the hit volumes the shot resolver uses.
export function buildFighterMesh(team) {
  const s = TEAM_STYLE[team];
  const g = new THREE.Group();
  const add = (geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const legGeo = new THREE.BoxGeometry(0.21, 0.78, 0.24);
  const legL = add(legGeo, mat(0x2c2f36), 0, 0.39, -0.13);
  const legR = add(legGeo, mat(0x2c2f36), 0, 0.39, 0.13);
  const body = add(new THREE.BoxGeometry(0.46, 0.66, 0.62), mat(s.vest), 0, 1.11, 0);
  add(new THREE.BoxGeometry(0.4, 0.5, 0.54), mat(s.cloth), 0, 1.06, 0); // shirt under the vest line
  const head = add(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(s.skin), 0, 1.62, 0);
  add(new THREE.BoxGeometry(0.34, 0.12, 0.34), mat(s.vest), 0, 1.8, 0); // helmet
  const armGeo = new THREE.BoxGeometry(0.52, 0.15, 0.15);
  const arm = add(armGeo, mat(s.cloth), 0.22, 1.32, -0.2);
  arm.rotation.z = -0.12;
  const gun = add(new THREE.BoxGeometry(0.72, 0.11, 0.09), mat(0x1c1e22), 0.5, 1.3, -0.2);
  add(new THREE.BoxGeometry(0.1, 0.2, 0.08), mat(0x1c1e22), 0.28, 1.16, -0.2); // magazine
  const stripe = add(new THREE.BoxGeometry(0.47, 0.09, 0.63), mat(s.trim), 0, 1.38, 0);
  g.userData = { head, body, legL, legR, gun, stripe };
  return g;
}

// Walk-cycle swing for legs/arms, driven by distance travelled.
export function animateFighter(f, dt) {
  const u = f.mesh.userData;
  const swing = Math.sin(f.walkPhase) * (f.crouch ? 0.2 : 0.5);
  u.legL.rotation.z = swing;
  u.legR.rotation.z = -swing;
  u.gun.position.y = 1.3 + Math.sin(f.walkPhase * 2) * 0.008;
  const targetTilt = f.crouch ? 0.16 : 0;
  f.mesh.rotation.x = 0; // group yaw is applied by the owner; crouch lowers it:
  f.mesh.position.y = f.pos.y - (f.crouch ? 0.34 : 0);
  u.body.position.y = 1.11 - (f.crouch ? 0.1 : 0) + targetTilt * 0;
}

export class BotBrain {
  constructor(rng) {
    this.rng = rng;
    this.state = 'route';
    this.path = [];
    this.pathIdx = 0;
    this.target = null; // visible enemy fighter
    this.lastSeenAt = -Infinity;
    this.lastSeenPos = null;
    this.reactUntil = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.strafeDir = 1;
    this.strafeFlipAt = 0;
    this.perceiveAt = rng() * 0.1;
    this.stuckAt = 0;
    this.lastPos = { x: 0, z: 0 };
    this.objectiveNode = null;
    this.holdUntil = Infinity;
  }

  setRouteTo(nodeIdx) {
    this.objectiveNode = nodeIdx;
    this.state = 'route';
    this.path = [];
  }

  // world: { now, fighters, hasLos(a, b), fireAt(bot, target), noise: [{x,z,at,team}] }
  update(f, dt, world) {
    const now = world.now;
    if (!f.alive) return;
    this.perceive(f, world);
    const wish = { x: 0, z: 0 };
    let wantSpeed = 0;
    let wantCrouch = false;

    if (this.target && now - this.lastSeenAt < 2.2) {
      // Engage: face the enemy, strafe in short steps, fire in bursts.
      const t = this.target;
      const dx = t.pos.x - f.pos.x;
      const dz = t.pos.z - f.pos.z;
      const dist = Math.hypot(dx, dz);
      f.yaw += clamp(angleDelta(f.yaw, Math.atan2(-dz, dx)), -dt * 7, dt * 7);
      f.pitch = clamp(Math.atan2((t.pos.y + 1.35) - (f.pos.y + 1.5), dist), -0.5, 0.5);
      if (now > this.strafeFlipAt) {
        this.strafeDir = this.rng() < 0.5 ? -1 : 1;
        this.strafeFlipAt = now + 0.4 + this.rng() * 0.7;
      }
      const side = this.strafeDir;
      wish.x = (-dz / dist) * side;
      wish.z = (dx / dist) * side;
      wantSpeed = dist > 26 ? 3.4 : 1.6; // close in when far, dance when near
      wantCrouch = dist < 20 && this.rng() < 0.004;
      if (now >= this.reactUntil) this.fight(f, world, dist);
      f.crouch = wantCrouch;
      stepMovement(f, wish, wantSpeed, dt, world.colliders);
      return;
    }

    if (this.state === 'plant' || this.state === 'defuse') {
      f.crouch = true;
      return; // the round logic runs the channel and calls the shots
    }

    // Route toward the objective node, then hold it.
    const node = this.objectiveNode;
    if (node !== null && node !== undefined) {
      if (this.path.length === 0) {
        const from = nearestWaypoint(f.pos.x, f.pos.z);
        this.path = findPath(from, node);
        this.pathIdx = 0;
      }
      const targetNode = this.path[Math.min(this.pathIdx, this.path.length - 1)];
      const [tx, tz] = WAYPOINTS[targetNode];
      const dx = tx - f.pos.x;
      const dz = tz - f.pos.z;
      const dist = Math.hypot(dx, dz);
      const atFinal = this.pathIdx >= this.path.length - 1;
      if (dist < 0.9) {
        if (!atFinal) this.pathIdx += 1;
        else if (this.state === 'route') { this.state = 'hold'; this.holdUntil = Infinity; }
      } else {
        wish.x = dx / dist;
        wish.z = dz / dist;
        wantSpeed = 4.4;
        f.yaw += clamp(angleDelta(f.yaw, Math.atan2(-dz, dx)), -dt * 6, dt * 6);
      }
      // Stuck recovery: if the body barely moved, sidestep once.
      if (now - this.stuckAt > 0.8) {
        const moved = Math.hypot(f.pos.x - this.lastPos.x, f.pos.z - this.lastPos.z);
        if (moved < 0.15 && wantSpeed > 0) {
          wish.x = -wish.z;
          wish.z = wish.x === 0 ? 1 : wish.x;
          wantSpeed = 3;
        }
        this.lastPos = { x: f.pos.x, z: f.pos.z };
        this.stuckAt = now;
      }
    }
    f.crouch = false;
    stepMovement(f, wish, wantSpeed, dt, world.colliders);
  }

  fight(f, world, dist) {
    const now = world.now;
    if (f.gun.ammo === 0) {
      world.reload(f);
      this.burstLeft = 0;
      return;
    }
    if (this.burstLeft <= 0) {
      if (now < this.nextShotAt) return;
      this.burstLeft = 2 + ((this.rng() * 4) | 0);
    }
    if (world.fireAt(f, this.target)) {
      this.burstLeft -= 1;
      if (this.burstLeft <= 0) this.nextShotAt = now + 0.24 + this.rng() * 0.5;
    }
  }

  perceive(f, world) {
    const now = world.now;
    if (now < this.perceiveAt) return;
    this.perceiveAt = now + 0.1;
    const eye = { x: f.pos.x, y: f.pos.y + 1.55, z: f.pos.z };
    let best = null;
    let bestDist = Infinity;
    for (const other of world.fighters) {
      if (!other.alive || other.team === f.team) continue;
      const dx = other.pos.x - f.pos.x;
      const dz = other.pos.z - f.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 62) continue;
      // Vision cone: 105 degrees around facing, unless very close.
      const toYaw = Math.atan2(-dz, dx);
      const off = Math.abs(angleDelta(f.yaw, toYaw));
      if (off > 1.85 && dist > 4.5) continue;
      const chest = { x: other.pos.x, y: other.pos.y + 1.15, z: other.pos.z };
      if (!world.hasLos(eye, chest)) continue;
      if (dist < bestDist) { bestDist = dist; best = other; }
    }
    if (best) {
      if (this.target !== best) this.reactUntil = now + 0.26 + this.rng() * 0.3;
      this.target = best;
      this.lastSeenAt = now;
      this.lastSeenPos = { x: best.pos.x, z: best.pos.z };
    } else if (this.target && now - this.lastSeenAt >= 2.2) {
      this.target = null;
    }
    // Hearing: recent enemy gunfire pulls a holding bot to investigate.
    if (!best && this.state === 'hold') {
      for (const n of world.noise) {
        if (n.team === f.team || now - n.at > 1.6) continue;
        const d = Math.hypot(n.x - f.pos.x, n.z - f.pos.z);
        if (d < (n.radius ?? 30)) {
          this.setRouteTo(nearestWaypoint(n.x, n.z));
          break;
        }
      }
    }
  }
}
