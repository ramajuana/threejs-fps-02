// weapons.js — the Harbourlight arsenal. Every gun is hitscan with a
// distance falloff, a head multiplier, spread that grows while moving and
// while spraying, and recoil the player (or bot) has to pull against.
// Accuracy pays: the first shots of a stopped, crouched shooter are nearly
// exact; running and spraying throws rounds wide.

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 26, headMult: 3.4,
    rpm: 340, mag: 12, reserve: 48, reloadMs: 1100, range: 55,
    spreadStand: 0.006, spreadMove: 0.03, bloomPerShot: 0.004, bloomMax: 0.05,
    recoil: 0.011, auto: false, zoom: 1,
  },
  smg: {
    name: 'Dart SMG', kind: 'smg', price: 1200, damage: 22, headMult: 2.6,
    rpm: 780, mag: 30, reserve: 90, reloadMs: 1500, range: 42,
    spreadStand: 0.012, spreadMove: 0.034, bloomPerShot: 0.005, bloomMax: 0.07,
    recoil: 0.009, auto: true, zoom: 1,
  },
  rifle: {
    name: 'Kestrel Rifle', kind: 'rifle', price: 2700, damage: 34, headMult: 4,
    rpm: 620, mag: 30, reserve: 90, reloadMs: 1900, range: 90,
    spreadStand: 0.0025, spreadMove: 0.045, bloomPerShot: 0.006, bloomMax: 0.06,
    recoil: 0.016, auto: true, zoom: 1.12,
  },
  sniper: {
    name: 'Longshot', kind: 'sniper', price: 4750, damage: 112, headMult: 2.2,
    rpm: 42, mag: 5, reserve: 20, reloadMs: 2600, range: 160,
    spreadStand: 0.0006, spreadMove: 0.09, bloomPerShot: 0.03, bloomMax: 0.1,
    recoil: 0.07, auto: false, zoom: 2.6,
  },
};

export const GRENADE = { name: 'Boom Grenade', price: 300, damage: 92, radius: 4.6, fuseMs: 1400 };
export const ARMOR_PRICE = 650;

export function falloff(weapon, dist) {
  if (dist <= weapon.range * 0.45) return 1;
  if (dist >= weapon.range) return 0.45;
  const t = (dist - weapon.range * 0.45) / (weapon.range * 0.55);
  return 1 - t * 0.55;
}

// A fresh carried weapon: definition plus its mutable state.
export function makeGun(id) {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve, lastShotAt: -Infinity, bloom: 0, reloadingUntil: 0 };
}

export function spreadOf(gun, mover) {
  // mover: { speed, crouched, airborne } — the shooter's own motion tax.
  const speedTax = Math.min(1, mover.speed / 5.2);
  let spread = gun.def.spreadStand + (gun.def.spreadMove - gun.def.spreadStand) * speedTax + gun.bloom;
  if (mover.crouched) spread *= 0.62;
  if (mover.airborne) spread = Math.max(spread, 0.06);
  return spread;
}

export function canFire(gun, now) {
  return now >= gun.reloadingUntil && gun.ammo > 0 && now - gun.lastShotAt >= 60000 / gun.def.rpm;
}

export function consumeShot(gun, now) {
  gun.ammo -= 1;
  gun.lastShotAt = now;
  gun.bloom = Math.min(gun.def.bloomMax, gun.bloom + gun.def.bloomPerShot);
}

export function relaxBloom(gun, dt) {
  gun.bloom = Math.max(0, gun.bloom - dt * 0.055);
}

export function startReload(gun, now) {
  if (gun.ammo >= gun.def.mag || gun.reserve <= 0 || now < gun.reloadingUntil) return false;
  gun.reloadingUntil = now + gun.def.reloadMs;
  return true;
}

export function finishReload(gun) {
  const take = Math.min(gun.def.mag - gun.ammo, gun.reserve);
  gun.ammo += take;
  gun.reserve -= take;
  gun.reloadingUntil = 0;
}
