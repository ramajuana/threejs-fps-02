# Harbourlight — a three.js tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical shooter in the style Counter-Strike made famous,
built on three.js 0.187.0 and set in an original container port at dusk.
You lead the **Wreckers** (attack): plant the bomb at site A or B, or
eliminate the **Wardens**. The Wardens win by eliminating you, running out
the clock, or defusing. First to 7 rounds takes the match.

- **Gunplay where accuracy beats speed** — hitscan weapons with head
  multipliers (×4 on the rifle), distance falloff, and spread that blooms
  while moving or spraying and settles when you stop, crouch and fire in
  bursts. Four weapons (P9 sidearm, Dart SMG, Kestrel rifle, Longshot
  sniper with a scoped sight) plus a throwable HE grenade and armour.
- **A real economy** — $800 to start, kill/plant/defuse bounties, round
  win/loss pay that carries between rounds, and a buy phase every round
  (B). Bots shop by the same rules.
- **Bots with a plan** — five-a-side bots that navigate a waypoint graph
  over the map, split 2-2-1 across the sites, hear your gunfire and
  footsteps, hold angles, rotate after the plant, retake and defuse.
- **An original map** — Harbourlight Depot: three streets, two yards, a
  crane over site A, container blocks for cover, painted site circles, and
  a dusk palette lit by a low sun and harbour lamps.
- **No assets, no build step** — every model is styled geometry, every
  sound is synthesised with WebAudio, the ground is a canvas texture. The
  game is plain ES modules under `game/`; three.js is vendored beside it.

## Run it

```sh
node serve.ts            # serves game/ at http://localhost:8080
# or hand in the entry program:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Controls: WASD move · SHIFT walk · CTRL crouch · SPACE jump · mouse aim ·
click fire · R reload · B buy · E plant/defuse (hold) · G grenade ·
right-click aim (the Longshot scopes).

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to the
  output and writes `dossier.json` with the vendored make.fun library.
- `game/src/main.js` — boot, fixed-step simulation loop, shooting, camera.
- `game/src/map.js` — the map, its colliders and the waypoint graph.
- `game/src/round.js` — phases, clock, bomb, economy, win rules.
- `game/src/bots.js` — bot bodies and brains.
- `game/src/player.js` — movement physics and the player controller.
- `game/src/weapons.js` — the arsenal and its accuracy model.
- `game/src/hud.js`, `game/src/audio.js` — the overlay and the synth SFX.
- `shots.json` + `?shot=start|play|end&seed=N` — the staged scenes the
  screenshots were rendered from.

---
<sub>Entered on [make.fun](https://make.fun/?ref=bfyeqrq3&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
