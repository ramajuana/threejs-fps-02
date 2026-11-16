// player.js — movement physics shared by the player and the bots, and the
// player's own controller: pointer-lock mouse look, acceleration and
// friction on the ground, crouching, jumping, and footstep timing. Movement
// is deliberately weighty: you accelerate, you slide a little, and your gun
// only settles when you stop — the gunplay in weapons.js prices that in.

import { clamp, resolveCircle } from './util.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const BODY_RADIUS = 0.42;
export const WALK_SPEED = 3.1;
export const RUN_SPEED = 5.2;

// Advance one fighter by dt. wish is a unit (or zero) direction on the
// ground plane in world space; speed is the target speed. The fighter keeps
// a velocity, so starts and stops have weight.
export function stepMovement(f, wish, speed, dt, colliders) {
  const accel = f.pos.y > 0.01 ? 22 : 40;
  const friction = f.pos.y > 0.01 ? 0.4 : 9;
  f.vel.x += wish.x * accel * dt;
  f.vel.z += wish.z * accel * dt;
  // Friction, then clamp to the wished speed (plus a little slide).
  const drag = Math.max(0, 1 - friction * dt * (speed > 0 ? 0.35 : 1));
  f.vel.x *= drag;
  f.vel.z *= drag;
  const vx = f.vel.x;
  const vz = f.vel.z;
  const v = Math.hypot(vx, vz);
  const cap = Math.max(speed, 0.001);
  if (v > cap && speed >= 0) {
    // Only clamp hard when a wish exists; knockback may exceed the cap.
    if (wish.x !== 0 || wish.z !== 0) {
      f.vel.x = (vx / v) * cap;
      f.vel.z = (vz / v) * cap;
    }
  }
  f.pos.x += f.vel.x * dt;
  f.pos.z += f.vel.z * dt;
  // Gravity and the floor.
  f.vel.y -= 22 * dt;
  f.pos.y += f.vel.y * dt;
  if (f.pos.y <= 0) {
    f.pos.y = 0;
    f.vel.y = 0;
    f.grounded = true;
  } else {
    f.grounded = false;
  }
  for (const box of colliders) {
    if (f.pos.y < box.h - 0.25) resolveCircle(f.pos, BODY_RADIUS, box);
  }
  // World bounds.
  f.pos.x = clamp(f.pos.x, -49, 49);
  f.pos.z = clamp(f.pos.z, -33, 33);
  f.speed = Math.hypot(f.vel.x, f.vel.z);
  if (f.speed > 0.4 && f.grounded) f.walkPhase += dt * f.speed * 1.9;
}

export class PlayerController {
  constructor(dom) {
    this.keys = new Set();
    this.yaw = Math.PI; // face east (+x) at spawn: yaw is measured so that
    this.pitch = 0;     // forward = (cos yaw, -sin yaw) on the ground plane
    this.jumpQueued = false;
    this.crouchHeld = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    dom.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
  }

  requestLock(dom) {
    if (!this.locked) dom.requestPointerLock();
  }

  // Consume the accumulated mouse motion and apply it to a fighter's view.
  applyLook(f, sensitivity = 0.0021) {
    f.yaw -= this.mouseDX * sensitivity;
    f.pitch = clamp(f.pitch - this.mouseDY * sensitivity, -1.45, 1.45);
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  wishDirection(f) {
    const fwd = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
      - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const side = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
      - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    const cos = Math.cos(f.yaw);
    const sin = Math.sin(f.yaw);
    // Forward on the ground plane is (cos yaw, -sin yaw); right is its
    // clockwise perpendicular when viewed from above.
    let x = cos * fwd + sin * side;
    let z = -sin * fwd + cos * side;
    const len = Math.hypot(x, z);
    if (len > 0) { x /= len; z /= len; }
    return { x, z, fwd, side };
  }

  update(f, dt, colliders, frozen) {
    this.applyLook(f);
    f.crouch = this.keys.has('ControlLeft') || this.keys.has('KeyC');
    const wish = frozen ? { x: 0, z: 0 } : this.wishDirection(f);
    const running = !this.keys.has('ShiftLeft');
    let speed = f.crouch ? 1.7 : running ? RUN_SPEED : WALK_SPEED;
    if (frozen) speed = 0;
    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (f.grounded && !frozen && !f.crouch) f.vel.y = 7.4;
    }
    stepMovement(f, wish, speed, dt, colliders);
    // Footsteps: distance-based, louder at a run (the bots listen for this).
    f.stepAcc = (f.stepAcc || 0) + (f.grounded ? f.speed * dt : 0);
    f.stepEvent = false;
    if (f.stepAcc > 2.4) {
      f.stepAcc = 0;
      f.stepEvent = true;
      f.stepRun = f.speed > 3.6;
    }
  }

  eyeHeight(f) {
    return f.crouch ? EYE_CROUCH : EYE_STAND;
  }
}
