// main.js — Harbourlight's entry point: builds the scene, the ten fighters
// (the player plus nine bots), and runs the match on a fixed-step clock so
// the simulation never depends on the frame rate. Rendering, shooting,
// grenades, tracers and the camera live here; the rules live in round.js,
// the bots' decisions in bots.js, the guns in weapons.js.
//
// Screenshot staging: ?shot=start|play|end&seed=N sets up a deterministic
// scene from the real simulation (the maker's screenshots are renders of
// this code running), with a cinematic camera in place of the player's.

import * as THREE from 'three';
import { buildMap } from './map.js';
import { makeRng, clamp, rayBox } from './util.js';
import { PlayerController, EYE_STAND, EYE_CROUCH } from './player.js';
import { BotBrain, buildFighterMesh, animateFighter } from './bots.js';
import { Match } from './round.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import {
  GRENADE, makeGun, spreadOf, canFire, consumeShot, relaxBloom,
  startReload, finishReload, falloff,
} from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const seed = Number(params.get('seed') ?? 1) | 0;
const rng = makeRng(0x9e3779b9 ^ (seed * 2654435761));

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 300);
const { colliders } = buildMap(scene);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- fighters ----------
const NAMES = {
  attack: ['Rook', 'Sable', 'Ferro', 'Juno'],
  defend: ['Onyx', 'Vesna', 'Karp', 'Milo', 'Ash'],
};
function makeFighter(team, isPlayer, name) {
  return {
    team, isPlayer, name,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, hp: 100, alive: true, crouch: false, grounded: true,
    speed: 0, walkPhase: 0, stepAcc: 0, stepEvent: false, stepRun: false,
    gun: makeGun('pistol'), grenades: 0, armor: false, money: 800,
    kills: 0, deaths: 0, brain: null, mesh: null, eyeSmoothed: EYE_STAND,
  };
}
const player = makeFighter('attack', true, 'You');
const fighters = [player];
for (const team of ['attack', 'defend']) {
  const count = team === 'attack' ? 4 : 5;
  for (let i = 0; i < count; i++) {
    const bot = makeFighter(team, false, NAMES[team][i]);
    bot.brain = new BotBrain(rng);
    bot.mesh = buildFighterMesh(team);
    scene.add(bot.mesh);
    fighters.push(bot);
  }
}

// ---------- shared world for brains and rules ----------
const noise = [];
const world = {
  now: 0, fighters, colliders, noise,
  playerPlantHeld: false,
  hasLos(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    for (const box of colliders) {
      const t = rayBox(a.x, a.y, a.z, dx / dist, dy / dist, dz / dist, box);
      if (t < dist - 0.05) return false;
    }
    return true;
  },
  fireAt(bot, target) { return botFire(bot, target); },
  reload(f) { if (startReload(f.gun, performance.now())) sfx.reload(); },
};

// ---------- effects: tracers, flashes, the bomb, grenades ----------
const tracerPool = [];
function tracer(from, to, color = 0xffcf7a) {
  let line = tracerPool.pop();
  if (!line) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    scene.add(line);
  }
  const p = line.geometry.attributes.position;
  p.setXYZ(0, from.x, from.y, from.z);
  p.setXYZ(1, to.x, to.y, to.z);
  p.needsUpdate = true;
  line.material.color.setHex(color);
  line.material.opacity = 0.85;
  line.visible = true;
  fading.push({ obj: line, t: 0.07, kind: 'tracer' });
}
const fading = [];
const flashLight = new THREE.PointLight(0xffc873, 0, 18, 1.6);
scene.add(flashLight);

const bombMesh = new THREE.Group();
{
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.6 }));
  pack.position.y = 0.09;
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 3 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), lampMat);
  lamp.position.set(0.1, 0.2, 0);
  bombMesh.add(pack, lamp);
  bombMesh.userData.lamp = lampMat;
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const grenadesLive = [];

// ---------- viewmodel ----------
const viewmodel = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.5, metalness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0, 0.03, -0.38);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.09), grip);
  mag.position.set(0, -0.13, -0.02);
  mag.rotation.x = 0.25;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), dark);
  sight.position.set(0, 0.1, -0.1);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.16), grip);
  hand.position.set(0, -0.08, 0.12);
  viewmodel.add(body, barrel, mag, sight, hand);
  viewmodel.position.set(0.24, -0.22, -0.45);
  camera.add(viewmodel);
  scene.add(camera);
}
let recoil = 0;
let muzzleT = 0;
const muzzle = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
muzzle.position.set(0, 0.03, -0.56);
viewmodel.add(muzzle);

// ---------- input, HUD, sound ----------
const sfx = new Sfx();
const controller = new PlayerController(renderer.domElement);
const hud = new Hud((item) => {
  if (match.buy(player, item)) { sfx.buy(); hud.refreshBuy(player); }
  else sfx.denied();
});
let mouseDown = false;
let mouseClicked = false;
let adsHeld = false;
addEventListener('mousedown', (e) => {
  if (e.button === 0) { mouseDown = true; mouseClicked = true; }
  if (e.button === 2) adsHeld = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) adsHeld = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
let buyOpen = false;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && player.alive) world.reload(player);
  if (e.code === 'KeyB' && match.phase === 'freeze' && player.alive && !SHOT) {
    buyOpen = !buyOpen;
    hud.setBuyOpen(buyOpen, player);
    if (buyOpen) document.exitPointerLock();
    else controller.requestLock(renderer.domElement);
  }
  if (e.code === 'KeyG' && player.alive) throwGrenade(player);
});

// ---------- the match ----------
const match = new Match(rng, fighters, player);
let started = SHOT !== null;
hud.el.overlayBtn.addEventListener('click', () => {
  sfx.ensure();
  started = true;
  hud.hideOverlay();
  controller.requestLock(renderer.domElement);
});
if (SHOT) hud.hideOverlay();

// ---------- shooting ----------
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

function resolveShot(shooter, origin, dir) {
  // Nearest hit among the map's boxes and every living enemy's volumes.
  let bestT = Infinity;
  let bestFighter = null;
  let bestPart = null;
  for (const box of colliders) {
    const t = rayBox(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, box);
    if (t < bestT) { bestT = t; bestFighter = null; }
  }
  for (const f of fighters) {
    if (!f.alive || f === shooter || f.team === shooter.team) continue;
    const crouchDrop = f.crouch ? 0.34 : 0;
    const parts = [
      ['head', f.pos.x, f.pos.y + 1.62 - crouchDrop, f.pos.z, 0.21],
      ['body', f.pos.x, f.pos.y + 1.05 - crouchDrop * 0.6, f.pos.z, 0.47],
      ['legs', f.pos.x, f.pos.y + 0.42, f.pos.z, 0.34],
    ];
    for (const [part, cx, cy, cz, r] of parts) {
      const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, cx, cy, cz, r);
      if (t < bestT) { bestT = t; bestFighter = f; bestPart = part; }
    }
  }
  const end = {
    x: origin.x + dir.x * Math.min(bestT, 140),
    y: origin.y + dir.y * Math.min(bestT, 140),
    z: origin.z + dir.z * Math.min(bestT, 140),
  };
  tracer({ x: origin.x, y: origin.y, z: origin.z }, end, shooter.isPlayer ? 0xffe9a8 : 0xff9a7a);
  if (bestFighter) {
    const dist = bestT;
    let dmg = shooter.gun.def.damage * falloff(shooter.gun.def, dist);
    if (bestPart === 'head') dmg *= shooter.gun.def.headMult;
    if (bestPart === 'legs') dmg *= 0.75;
    damage(bestFighter, dmg, shooter, bestPart === 'head');
  }
  return bestT;
}

function damage(victim, amount, attacker, headshot = false) {
  if (!victim.alive) return;
  if (victim.armor) amount *= 0.55;
  victim.hp -= amount;
  if (victim.isPlayer) { hud.hurtFlash(); sfx.hurt(); }
  if (attacker && attacker.isPlayer) hud.hitmark(victim.hp <= 0);
  if (victim.hp <= 0) {
    victim.alive = false;
    victim.hp = 0;
    if (victim.mesh) {
      victim.mesh.rotation.z = Math.PI / 2 - 0.12;
      victim.mesh.position.y = 0.3;
    }
    hud.kill(attacker ? attacker.name : 'The bomb', victim.name, headshot);
    match.onKill(attacker, victim);
  }
}

function shootFrom(f) {
  const gun = f.gun;
  const nowMs = performance.now();
  if (!canFire(gun, nowMs)) {
    if (gun.ammo === 0 && f.isPlayer) sfx.dryFire();
    return false;
  }
  consumeShot(gun, nowMs);
  const spread = spreadOf(gun, { speed: f.speed, crouched: f.crouch, airborne: !f.grounded });
  const eyeY = f.pos.y + (f.crouch ? EYE_CROUCH : EYE_STAND);
  _origin.set(f.pos.x, eyeY, f.pos.z);
  _dir.set(Math.cos(f.pitch) * Math.cos(f.yaw), Math.sin(f.pitch), -Math.cos(f.pitch) * Math.sin(f.yaw));
  // Gaussian-ish spread from three uniform draws.
  const sx = (rng() + rng() + rng() - 1.5) / 1.5 * spread;
  const sy = (rng() + rng() + rng() - 1.5) / 1.5 * spread;
  _dir.x += -Math.sin(f.yaw) * sx + Math.sin(f.pitch) * Math.cos(f.yaw) * sy * 0.4;
  _dir.z += -Math.cos(f.yaw) * sx * -1 + Math.sin(f.pitch) * Math.sin(f.yaw) * sy * 0.4;
  _dir.y += Math.cos(f.pitch) * sy;
  _dir.normalize();
  // Muzzle origin a step ahead of the eye so walls at the face don't eat it.
  _origin.addScaledVector(_dir, 0.5);
  resolveShot(f, _origin, _dir);
  noise.push({ x: f.pos.x, z: f.pos.z, at: world.now, team: f.team, radius: 34 });
  const toPlayer = Math.hypot(player.pos.x - f.pos.x, player.pos.z - f.pos.z);
  sfx.shot(gun.def.kind, f.isPlayer ? 0 : toPlayer);
  if (f.isPlayer) {
    recoil = Math.min(0.09, recoil + gun.def.recoil);
    muzzleT = 0.045;
    viewmodel.position.z = -0.45 + gun.def.recoil * 2.2;
  }
  return true;
}

function botFire(bot, target) {
  const gun = bot.gun;
  if (!canFire(gun, performance.now())) return false;
  // Bots aim at the chest with an error that grows with range and with the
  // target's speed; then the shared resolver decides what was really hit.
  const dist = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
  const err = clamp(dist * 0.006, 0.12, 0.7) * (target.speed > 2 ? 1.5 : 1);
  const aim = {
    x: target.pos.x + (rng() - 0.5) * err,
    y: target.pos.y + 1.12 + (rng() - 0.5) * err * 0.7,
    z: target.pos.z + (rng() - 0.5) * err,
  };
  const eyeY = bot.pos.y + (bot.crouch ? EYE_CROUCH : EYE_STAND);
  _origin.set(bot.pos.x, eyeY, bot.pos.z);
  _dir.set(aim.x - _origin.x, aim.y - _origin.y, aim.z - _origin.z).normalize();
  consumeShot(gun, performance.now());
  resolveShot(bot, _origin, _dir);
  noise.push({ x: bot.pos.x, z: bot.pos.z, at: world.now, team: bot.team, radius: 34 });
  const toPlayer = Math.hypot(player.pos.x - bot.pos.x, player.pos.z - bot.pos.z);
  sfx.shot(gun.def.kind, toPlayer);
  return true;
}

function throwGrenade(f) {
  if (f.grenades <= 0 || !f.alive) return;
  f.grenades -= 1;
  const dir = new THREE.Vector3(
    Math.cos(f.pitch) * Math.cos(f.yaw), Math.sin(f.pitch) + 0.25, -Math.cos(f.pitch) * Math.sin(f.yaw),
  ).normalize();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x37402e, roughness: 0.5 }));
  scene.add(mesh);
  grenadesLive.push({
    pos: { x: f.pos.x + dir.x, y: f.pos.y + 1.5, z: f.pos.z + dir.z },
    vel: { x: dir.x * 15, y: dir.y * 15 + 2.5, z: dir.z * 15 },
    fuse: GRENADE.fuseMs / 1000, by: f, mesh,
  });
  sfx.throwWhoosh();
}

function explode(g) {
  scene.remove(g.mesh);
  flashLight.position.set(g.pos.x, g.pos.y + 0.6, g.pos.z);
  flashLight.intensity = 260;
  sfx.explosion();
  const boom = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffa845, transparent: true, opacity: 0.9 }));
  boom.position.copy(g.pos);
  scene.add(boom);
  fading.push({ obj: boom, t: 0.4, kind: 'boom' });
  for (const f of fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z);
    if (d > GRENADE.radius) continue;
    const los = world.hasLos({ x: g.pos.x, y: g.pos.y + 0.4, z: g.pos.z }, { x: f.pos.x, y: f.pos.y + 1, z: f.pos.z });
    const dmg = GRENADE.damage * (1 - d / GRENADE.radius) * (los ? 1 : 0.4);
    if (dmg > 2) damage(f, dmg, g.by, false);
  }
}

// ---------- staging for screenshots ----------
function stageShot() {
  const giveRifle = (f) => { f.gun = makeGun('rifle'); f.armor = true; };
  fighters.forEach(giveRifle);
  viewmodel.visible = false; // the staged cameras are cinematic, not the player's eyes
  match.events.length = 0; // the construction roundStart banner must not overwrite the staged one
  if (SHOT === 'start') {
    match.phase = 'freeze';
    match.phaseT = 8;
    camera.position.set(-49.5, 2.1, 6.5);
    camera.lookAt(-30, 1.4, -2);
    hud.banner('ROUND 1 — WRECKERS TO PLANT', 60000);
  } else if (SHOT === 'play') {
    match.phase = 'live';
    match.phaseT = 74;
    const spots = [
      [player, -6, 3.4, 0.1], [fighters[1], -12, -3, 0.2], [fighters[2], -16, 6, 0],
      [fighters[5], 4, -4, Math.PI], [fighters[6], 10, 2, Math.PI], [fighters[7], 2, -14, Math.PI - 0.4],
    ];
    for (const [f, x, z, yaw] of spots) { f.pos.x = x; f.pos.z = z; f.yaw = yaw; }
    camera.position.set(-8.5, 1.62, 5.2);
    camera.lookAt(14, 1.2, -3);
  } else if (SHOT === 'end') {
    match.phase = 'planted';
    match.phaseT = 0;
    match.bomb.state = 'planted';
    match.bomb.x = 38;
    match.bomb.z = -22;
    match.bomb.site = 'A';
    match.bomb.fuse = 23;
    const defuser = fighters[6];
    defuser.pos.x = 38.8;
    defuser.pos.z = -21.2;
    defuser.crouch = true;
    defuser.yaw = Math.PI * 0.75;
    defuser.brain.state = 'defuse';
    const guard = fighters[1];
    guard.pos.x = 33;
    guard.pos.z = -27;
    guard.yaw = -0.5;
    camera.position.set(32.5, 1.8, -15.5);
    camera.lookAt(38.5, 0.8, -22);
    hud.banner('BOMB PLANTED AT A', 60000);
  }
}
if (SHOT) stageShot();

// ---------- per-step updates ----------
function stepSim(dt) {
  world.now += dt;
  const frozen = match.phase === 'freeze';
  // Player.
  if (player.alive && started && !SHOT) {
    controller.update(player, dt, colliders, frozen);
    world.playerPlantHeld = controller.keys.has('KeyE');
    if (controller.stepEvent) {
      noise.push({ x: player.pos.x, z: player.pos.z, at: world.now, team: player.team, radius: controller.stepRun ? 13 : 7 });
      sfx.step(controller.stepRun);
    }
    const wantFire = player.gun.def.auto ? mouseDown : mouseClicked;
    if (wantFire && !frozen && !buyOpen) shootFrom(player);
    mouseClicked = false;
    if (performance.now() >= player.gun.reloadingUntil && player.gun.reloadingUntil !== 0) finishReload(player.gun);
    relaxBloom(player.gun, dt);
  }
  // Bots.
  for (const f of fighters) {
    if (f.isPlayer) continue;
    if (f.alive && started && !frozen && match.phase !== 'roundEnd' && match.phase !== 'matchEnd') {
      f.brain.update(f, dt, world);
      if (performance.now() >= f.gun.reloadingUntil && f.gun.reloadingUntil !== 0) finishReload(f.gun);
      relaxBloom(f.gun, dt);
      // Bots throw the occasional grenade at a seen enemy at mid range.
      if (f.grenades > 0 && f.brain.target && world.now - f.brain.lastSeenAt < 0.4) {
        const d = Math.hypot(f.brain.target.pos.x - f.pos.x, f.brain.target.pos.z - f.pos.z);
        if (d > 9 && d < 20 && rng() < dt * 0.25) throwGrenade(f);
      }
    }
    if (f.mesh) {
      f.mesh.position.set(f.pos.x, f.pos.y, f.pos.z);
      f.mesh.rotation.y = f.yaw; // the model faces +x; rotY(yaw) aims it along (cos yaw, -sin yaw)
      if (f.alive) animateFighter(f, dt);
    }
  }
  // Grenades in flight.
  for (let i = grenadesLive.length - 1; i >= 0; i--) {
    const g = grenadesLive[i];
    g.fuse -= dt;
    g.vel.y -= 20 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    if (g.pos.y < 0.09) { g.pos.y = 0.09; g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    if (g.fuse <= 0) { explode(g); grenadesLive.splice(i, 1); }
  }
  // The bomb's physical presence.
  if (match.bomb.state === 'dropped' || match.bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(match.bomb.x, 0, match.bomb.z);
    bombMesh.userData.lamp.emissiveIntensity = (world.now * 2) % 1 < 0.5 ? 3 : 0.2;
  } else {
    bombMesh.visible = false;
  }
  // Rules.
  match.update(dt, world);
  for (const ev of match.events.splice(0)) handleEvent(ev);
  // Progress bars the player owns.
  if (match.bomb.channelBy === player && match.bomb.channel > 0) {
    hud.setProgress(match.bomb.channel / (match.phase === 'planted' ? 5 : 3.2),
      match.phase === 'planted' ? 'DEFUSING…' : 'PLANTING…');
  } else {
    hud.setProgress(null);
  }
  // Old noise fades.
  while (noise.length && world.now - noise[0].at > 2) noise.shift();
}

function handleEvent(ev) {
  if (ev.type === 'roundStart') {
    if (!SHOT) hud.banner(`ROUND ${ev.round}${ev.carrierIsPlayer ? ' — YOU HAVE THE BOMB' : ''}`);
    buyOpen = false;
    hud.setBuyOpen(false, player);
    for (const f of fighters) if (f.mesh) { f.mesh.rotation.z = 0; }
  } else if (ev.type === 'live') {
    hud.banner('GO — ROUND LIVE', 1400);
  } else if (ev.type === 'planted') {
    hud.banner(`💣 BOMB PLANTED AT ${ev.site}`);
    sfx.plantDone();
  } else if (ev.type === 'bombBeep') {
    if (match.bomb.state === 'planted') sfx.beep(ev.final);
  } else if (ev.type === 'explosion') {
    const g = { pos: { x: ev.x, y: 0.4, z: ev.z }, by: null, mesh: new THREE.Object3D() };
    explode(g);
  } else if (ev.type === 'roundEnd') {
    const won = ev.winner === player.team;
    hud.banner(won ? `ROUND WON — ${ev.reason}` : `ROUND LOST — ${ev.reason}`, 3600);
    if (won) sfx.roundWin(); else sfx.roundLose();
  } else if (ev.type === 'matchEnd') {
    const won = ev.winner === player.team;
    hud.showOverlay(won ? 'MATCH WON 🏆' : 'MATCH LOST',
      `Final score — Wreckers ${ev.score.attack} : ${ev.score.defend} Wardens.\nYour line: ${player.kills} kills, ${player.deaths} deaths.`,
      'Play again');
    hud.el.overlayBtn.onclick = () => location.reload();
  }
}

// ---------- camera and render ----------
function updateCamera(dt) {
  if (SHOT) return; // staged cameras stay where stageShot put them
  if (!player.alive) {
    // Spectate: a slow rise over the depot while the round plays out.
    const t = world.now * 0.05;
    camera.position.set(Math.cos(t) * 26, 24, Math.sin(t) * 26);
    camera.lookAt(8, 0, 0);
    viewmodel.visible = false;
    return;
  }
  viewmodel.visible = true;
  const targetEye = player.crouch ? EYE_CROUCH : EYE_STAND;
  player.eyeSmoothed += (targetEye - player.eyeSmoothed) * Math.min(1, dt * 11);
  camera.position.set(player.pos.x, player.pos.y + player.eyeSmoothed, player.pos.z);
  // three.js cameras look down -z; rotY(yaw - pi/2) turns that forward onto
  // the fighter's ground direction (cos yaw, -sin yaw), and rotX(pitch)
  // raises it. Order YXZ applies yaw first, then pitch, like a head.
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw - Math.PI / 2;
  camera.rotation.x = player.pitch + recoil;
  camera.rotation.z = 0;
  recoil = Math.max(0, recoil - dt * 0.28);
  // Viewmodel life: bob while walking, dip while reloading, kick on fire.
  const bob = Math.sin(player.walkPhase * 2) * 0.008 * Math.min(1, player.speed / 3);
  const reloading = performance.now() < player.gun.reloadingUntil;
  viewmodel.position.y = -0.22 + bob - (reloading ? 0.13 : 0);
  viewmodel.position.z += ((-0.45) - viewmodel.position.z) * Math.min(1, dt * 14);
  viewmodel.rotation.x = reloading ? -0.7 : recoil * 1.4;
  muzzle.material.opacity = muzzleT > 0 ? 0.9 : 0;
  muzzleT = Math.max(0, muzzleT - dt);
  muzzle.rotation.z = rng() * Math.PI;
  // Aim-down-sights: sniper scopes fully, the rifle leans in a little.
  const scoped = adsHeld && player.gun.id === 'sniper';
  const targetFov = scoped ? 24 : adsHeld ? 74 / (player.gun.def.zoom || 1) : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();
  hud.update({ player, match, scoped });
}

let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    stepSim(STEP);
    acc -= STEP;
  }
  // Fading effects.
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i];
    f.t -= dt;
    if (f.kind === 'tracer') f.obj.material.opacity = Math.max(0, f.t / 0.07) * 0.85;
    if (f.kind === 'boom') {
      const s = 1 + (0.4 - f.t) * 9;
      f.obj.scale.setScalar(s);
      f.obj.material.opacity = Math.max(0, f.t / 0.4) * 0.9;
    }
    if (f.t <= 0) {
      if (f.kind === 'tracer') { f.obj.visible = false; tracerPool.push(f.obj); }
      if (f.kind === 'boom') scene.remove(f.obj);
      fading.splice(i, 1);
    }
  }
  flashLight.intensity = Math.max(0, flashLight.intensity - dt * 1400);
  updateCamera(dt);
  if (SHOT) hud.update({ player, match, scoped: false }); // staged scenes still show a live HUD
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
