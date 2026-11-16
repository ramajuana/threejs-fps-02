// round.js — the match: round phases, the clock, the bomb, the economy and
// the win rules of Harbourlight. Short rounds, first to 7, money that
// carries between rounds and is spent in the buy phase. This module owns
// the rules; main.js owns the rendering and the shooting, and drains this
// module's event queue to drive sound and HUD.

import { SITES, SPAWNS, nearestWaypoint } from './map.js';
import { WEAPONS, GRENADE, ARMOR_PRICE, makeGun } from './weapons.js';

export const FREEZE_S = 9;
export const ROUND_S = 105;
export const BOMB_S = 40;
export const PLANT_S = 3.2;
export const DEFUSE_S = 5;
export const ROUND_END_S = 4.5;
export const WINS_NEEDED = 7;
export const MAX_ROUNDS = 13;

export const MONEY = {
  start: 800, win: 2700, winByPlant: 2900, loss: 1900, kill: 300,
  plant: 300, defuse: 300, cap: 9000,
};

export class Match {
  constructor(rng, fighters, player) {
    this.rng = rng;
    this.fighters = fighters;
    this.player = player;
    this.events = [];
    this.score = { attack: 0, defend: 0 };
    this.round = 0;
    this.phase = 'freeze';
    this.phaseT = FREEZE_S;
    this.bomb = { state: 'carried', carrier: null, x: 0, z: 0, site: null, fuse: 0, channel: 0, channelBy: null };
    this.siteChoice = 0;
    this.matchWinner = null;
    for (const f of fighters) {
      f.money = MONEY.start;
      f.gun = makeGun('pistol');
      f.grenades = 0;
      f.armor = false;
      f.kills = 0;
      f.deaths = 0;
    }
    this.startRound();
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  aliveCount(team) {
    return this.fighters.filter((f) => f.team === team && f.alive).length;
  }

  startRound() {
    this.round += 1;
    this.phase = 'freeze';
    this.phaseT = FREEZE_S;
    this.siteChoice = this.rng() < 0.5 ? 0 : 1;
    const site = SITES[this.siteChoice];
    // Reset every fighter to a spawn point, alive, on full health.
    const byTeam = { attack: 0, defend: 0 };
    for (const f of this.fighters) {
      const idx = byTeam[f.team]++;
      const [sx, sz] = SPAWNS[f.team][idx % SPAWNS[f.team].length];
      f.pos.x = sx;
      f.pos.z = sz;
      f.pos.y = 0;
      f.vel.x = 0; f.vel.z = 0; f.vel.y = 0;
      f.hp = 100;
      f.alive = true;
      f.crouch = false;
      f.yaw = f.team === 'attack' ? 0 : Math.PI;
      f.pitch = 0;
      if (f.mesh) f.mesh.visible = true;
      if (!f.gun || !f.aliveLastRound) {
        f.gun = makeGun('pistol');
        f.grenades = 0;
        f.armor = false;
      }
      f.aliveLastRound = true;
      if (f.brain) f.brain.target = null;
    }
    // The bomb goes to a random attacker; the player gets it one time in five.
    const attackers = this.fighters.filter((f) => f.team === 'attack');
    const carrier = this.rng() < 0.2 ? this.player : attackers[(this.rng() * attackers.length) | 0];
    this.bomb = { state: 'carried', carrier, x: 0, z: 0, site: null, fuse: 0, channel: 0, channelBy: null };
    this.emit('roundStart', { round: this.round, carrierIsPlayer: carrier === this.player, site: site.name });
    this.assignObjectives();
    this.autoBuyBots();
  }

  assignObjectives() {
    const site = SITES[this.siteChoice];
    const siteNode = nearestWaypoint(site.x, site.z);
    const otherSite = SITES[1 - this.siteChoice];
    const otherNode = nearestWaypoint(otherSite.x, otherSite.z);
    const holds = { A: [19, 20, 13], B: [21, 22, 15] };
    const siteHolds = holds[site.name];
    const otherHolds = holds[otherSite.name];
    let ai = 0;
    let di = 0;
    for (const f of this.fighters) {
      if (f.isPlayer || !f.brain) continue;
      if (f.team === 'attack') {
        if (f === this.bomb.carrier) f.brain.setRouteTo(siteNode);
        else if (ai % 3 === 2) f.brain.setRouteTo(otherNode); // one lurker pressures the far site
        else f.brain.setRouteTo(siteHolds[ai % siteHolds.length]);
        ai++;
      } else {
        // Defenders split: two on the likelier site is unknowable, so 2-2-1.
        const plan = [siteHolds[di % siteHolds.length], otherHolds[di % otherHolds.length],
          siteHolds[(di + 1) % siteHolds.length], otherHolds[(di + 1) % otherHolds.length], 14];
        f.brain.setRouteTo(plan[di % plan.length]);
        di++;
      }
    }
  }

  autoBuyBots() {
    for (const f of this.fighters) {
      if (f.isPlayer) continue;
      // Bots buy in the freeze, best-first, keeping a little back by chance.
      if (!f.armor && f.money >= ARMOR_PRICE + 400) this.buy(f, 'armor');
      if (f.gun.id === 'pistol' && f.money >= WEAPONS.rifle.price && this.rng() < 0.75) this.buy(f, 'rifle');
      else if (f.gun.id === 'pistol' && f.money >= WEAPONS.smg.price) this.buy(f, 'smg');
      if (f.grenades === 0 && f.money >= GRENADE.price + 900 && this.rng() < 0.45) this.buy(f, 'grenade');
    }
  }

  buy(f, item) {
    if (this.phase !== 'freeze') return false;
    if (item === 'armor') {
      if (f.armor || f.money < ARMOR_PRICE) return false;
      f.money -= ARMOR_PRICE;
      f.armor = true;
      return true;
    }
    if (item === 'grenade') {
      if (f.grenades >= 2 || f.money < GRENADE.price) return false;
      f.money -= GRENADE.price;
      f.grenades += 1;
      return true;
    }
    const def = WEAPONS[item];
    if (!def || f.money < def.price || f.gun.id === item) return false;
    f.money -= def.price;
    f.gun = makeGun(item);
    return true;
  }

  onKill(killer, victim) {
    victim.aliveLastRound = false;
    if (killer && killer.team !== victim.team) {
      killer.money = Math.min(MONEY.cap, killer.money + MONEY.kill);
      killer.kills += 1;
    }
    victim.deaths += 1;
    if (this.bomb.state === 'carried' && this.bomb.carrier === victim) {
      this.bomb.state = 'dropped';
      this.bomb.x = victim.pos.x;
      this.bomb.z = victim.pos.z;
      this.bomb.carrier = null;
      this.emit('bombDropped', { x: this.bomb.x, z: this.bomb.z });
    }
    this.checkElimination();
  }

  checkElimination() {
    if (this.phase !== 'live' && this.phase !== 'planted') return;
    // With the bomb planted, wiping the attackers does not end the round:
    // the defenders must still defuse or lose to the explosion.
    if (this.aliveCount('attack') === 0 && this.phase !== 'planted') this.endRound('defend', 'elimination');
    else if (this.aliveCount('defend') === 0) this.endRound('attack', 'elimination');
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.score[winner] += 1;
    const winPay = reason === 'explosion' ? MONEY.winByPlant : MONEY.win;
    for (const f of this.fighters) {
      f.money = Math.min(MONEY.cap, f.money + (f.team === winner ? winPay : MONEY.loss));
    }
    this.phase = 'roundEnd';
    this.phaseT = ROUND_END_S;
    this.emit('roundEnd', { winner, reason, score: { ...this.score } });
    if (this.score.attack >= WINS_NEEDED || this.score.defend >= WINS_NEEDED || this.round >= MAX_ROUNDS) {
      this.matchWinner = this.score.attack === this.score.defend
        ? 'defend' : (this.score.attack > this.score.defend ? 'attack' : 'defend');
      this.phase = 'matchEnd';
      this.phaseT = 999;
      this.emit('matchEnd', { winner: this.matchWinner, score: { ...this.score } });
    }
  }

  // The channel actions: planting and defusing advance while the actor
  // stands in place; movement or death cancels them (checked by the caller
  // keeping the actor's brain in the channel state).
  update(dt, world) {
    if (this.phase === 'matchEnd') return;
    this.phaseT -= dt;
    if (this.phase === 'freeze') {
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.phaseT = ROUND_S;
        this.emit('live');
      }
      return;
    }
    if (this.phase === 'roundEnd') {
      if (this.phaseT <= 0) this.startRound();
      return;
    }
    if (this.phase === 'live') {
      // Bomb pickup: a living attacker walking over a dropped bomb takes it.
      if (this.bomb.state === 'dropped') {
        for (const f of this.fighters) {
          if (f.team === 'attack' && f.alive
            && Math.hypot(f.pos.x - this.bomb.x, f.pos.z - this.bomb.z) < 1.2) {
            this.bomb.state = 'carried';
            this.bomb.carrier = f;
            this.emit('bombPickup', { byPlayer: f.isPlayer });
            break;
          }
        }
      }
      // Planting: the carrier channels inside the chosen site.
      const carrier = this.bomb.carrier;
      if (this.bomb.state === 'carried' && carrier && carrier.alive) {
        const site = SITES.find((s) => Math.hypot(carrier.pos.x - s.x, carrier.pos.z - s.z) <= s.radius);
        const channeling = site && carrier.speed < 0.4
          && (carrier.isPlayer ? world.playerPlantHeld : carrier.brain.state === 'plant');
        if (!carrier.isPlayer && site && !carrier.brain.target) carrier.brain.state = 'plant';
        if (channeling) {
          this.bomb.channel += dt;
          this.bomb.channelBy = carrier;
          this.emit('plantProgress', { t: this.bomb.channel / PLANT_S });
          if (this.bomb.channel >= PLANT_S) {
            this.bomb.state = 'planted';
            this.bomb.x = carrier.pos.x;
            this.bomb.z = carrier.pos.z;
            this.bomb.site = site.name;
            this.bomb.fuse = BOMB_S;
            this.bomb.channel = 0;
            carrier.money = Math.min(MONEY.cap, carrier.money + MONEY.plant);
            this.phase = 'planted';
            this.emit('planted', { site: site.name, x: this.bomb.x, z: this.bomb.z });
            this.afterPlant();
          }
        } else {
          this.bomb.channel = 0;
          if (!carrier.isPlayer && carrier.brain.state === 'plant') carrier.brain.state = 'route';
        }
      }
      if (this.phaseT <= 0 && this.phase === 'live') this.endRound('defend', 'time');
      return;
    }
    if (this.phase === 'planted') {
      this.bomb.fuse -= dt;
      // Beeps quicken as the fuse burns (main.js turns these into sound).
      const interval = this.bomb.fuse > 20 ? 1 : this.bomb.fuse > 10 ? 0.5 : 0.25;
      if ((this.bomb.fuse % interval) < dt) this.emit('bombBeep', { final: this.bomb.fuse < 5 });
      // Defusing: the nearest living defender channels at the bomb.
      let defuser = null;
      for (const f of this.fighters) {
        if (f.team === 'defend' && f.alive
          && Math.hypot(f.pos.x - this.bomb.x, f.pos.z - this.bomb.z) < 2.3) {
          defuser = f;
          break;
        }
      }
      if (defuser && defuser.speed < 0.4 && (defuser.isPlayer ? world.playerPlantHeld : true)) {
        if (!defuser.isPlayer) defuser.brain.state = 'defuse';
        this.bomb.channelBy = defuser;
        this.bomb.channel += dt;
        this.emit('defuseProgress', { t: this.bomb.channel / DEFUSE_S });
        if (this.bomb.channel >= DEFUSE_S) {
          defuser.money = Math.min(MONEY.cap, defuser.money + MONEY.defuse);
          this.endRound('defend', 'defused');
          return;
        }
      } else {
        this.bomb.channel = 0;
        this.bomb.channelBy = null;
      }
      if (this.bomb.fuse <= 0) {
        this.emit('explosion', { x: this.bomb.x, z: this.bomb.z });
        this.endRound('attack', 'explosion');
      }
    }
  }

  afterPlant() {
    // Defenders retake the site; attackers settle onto it and hold.
    const node = nearestWaypoint(this.bomb.x, this.bomb.z);
    for (const f of this.fighters) {
      if (!f.brain || !f.alive) continue;
      if (f.team === 'defend') f.brain.setRouteTo(node);
      else f.brain.setRouteTo(node);
    }
  }

  clockText() {
    const t = Math.max(0, this.phase === 'planted' ? this.bomb.fuse : this.phaseT);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
