// hud.js — everything drawn over the 3D view: health, armour, ammunition,
// money, the round clock and score, the killfeed, round banners, the plant
// and defuse progress bar, the buy menu, and the start / match-end overlays.
// Plain DOM, styled by index.html; this class only moves data into it.

import { WEAPONS, GRENADE, ARMOR_PRICE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(onBuy) {
    this.el = {
      hud: $('hud'), timer: $('timer'), score: $('score'), roundLabel: $('round-label'),
      health: $('health'), healthBar: $('health-bar'), armor: $('armor-tag'),
      ammo: $('ammo'), weapon: $('weapon-name'), money: $('money'),
      killfeed: $('killfeed'), banner: $('banner'), carrier: $('carrier'),
      progressWrap: $('progress-wrap'), progressBar: $('progress-bar'),
      progressLabel: $('progress-label'), buy: $('buy'), buyMoney: $('buy-money'),
      hitmarker: $('hitmarker'), crosshair: $('crosshair'), damage: $('damage'),
      scope: $('scope'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
      overlayText: $('overlay-text'), overlayBtn: $('overlay-btn'),
    };
    this.bannerUntil = 0;
    for (const btn of this.el.buy.querySelectorAll('[data-buy]')) {
      btn.addEventListener('click', () => onBuy(btn.dataset.buy));
    }
  }

  showOverlay(title, text, button) {
    this.el.overlayTitle.textContent = title;
    this.el.overlayText.textContent = text;
    this.el.overlayBtn.textContent = button;
    this.el.overlay.style.display = 'flex';
  }

  hideOverlay() {
    this.el.overlay.style.display = 'none';
  }

  banner(text, ms = 2600) {
    this.el.banner.textContent = text;
    this.el.banner.style.opacity = '1';
    this.bannerUntil = performance.now() + ms;
  }

  kill(killerName, victimName, headshot) {
    const row = document.createElement('div');
    row.className = 'kill-row';
    row.textContent = `${killerName} ▸ ${victimName}${headshot ? ' ⌖ headshot' : ''}`;
    this.el.killfeed.appendChild(row);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 4200);
  }

  hitmark(kill) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.style.color = kill ? '#ff5a47' : '';
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.el.hitmarker.classList.remove('on'), 110);
  }

  hurtFlash() {
    this.el.damage.style.opacity = '0.55';
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { this.el.damage.style.opacity = '0'; }, 130);
  }

  setProgress(t, label) {
    if (t === null) {
      this.el.progressWrap.style.display = 'none';
      return;
    }
    this.el.progressWrap.style.display = 'block';
    this.el.progressBar.style.width = `${Math.min(100, t * 100)}%`;
    this.el.progressLabel.textContent = label;
  }

  setBuyOpen(open, player) {
    this.el.buy.style.display = open ? 'block' : 'none';
    if (open && player) this.refreshBuy(player);
  }

  refreshBuy(player) {
    this.el.buyMoney.textContent = `$${player.money}`;
    for (const btn of this.el.buy.querySelectorAll('[data-buy]')) {
      const item = btn.dataset.buy;
      const price = item === 'armor' ? ARMOR_PRICE : item === 'grenade' ? GRENADE.price : WEAPONS[item].price;
      const owned = item === 'armor' ? player.armor
        : item === 'grenade' ? player.grenades >= 2 : player.gun.id === item;
      btn.disabled = owned || player.money < price;
      btn.querySelector('.price').textContent = owned ? 'owned' : `$${price}`;
    }
  }

  // Called every frame with the pieces of state the HUD shows.
  update({ player, match, scoped }) {
    this.el.health.textContent = Math.max(0, Math.ceil(player.hp));
    this.el.healthBar.style.width = `${Math.max(0, player.hp)}%`;
    this.el.healthBar.style.background = player.hp > 35 ? 'var(--accent)' : '#ff5a47';
    this.el.armor.textContent = player.armor ? '🛡 armoured' : '';
    this.el.ammo.textContent = `${player.gun.ammo} / ${player.gun.reserve}`;
    this.el.weapon.textContent = player.gun.def.name
      + (player.grenades > 0 ? ` · grenades ×${player.grenades}` : '');
    this.el.money.textContent = `$${player.money}`;
    this.el.timer.textContent = match.phase === 'planted' ? `💣 ${match.clockText()}` : match.clockText();
    this.el.timer.style.color = (match.phase === 'live' && match.phaseT < 16) || match.phase === 'planted'
      ? '#ff5a47' : '';
    this.el.score.textContent = `WRECKERS ${match.score.attack} : ${match.score.defend} WARDENS`;
    this.el.roundLabel.textContent = match.phase === 'matchEnd'
      ? 'Match over'
      : `Round ${match.round} · ${match.phase === 'freeze' ? 'Buy phase — press B' : match.phase === 'planted' ? `Bomb planted at ${match.bomb.site}` : 'Live'}`;
    this.el.carrier.style.display = match.bomb.state === 'carried' && match.bomb.carrier === player
      ? 'block' : 'none';
    this.el.scope.style.display = scoped ? 'block' : 'none';
    this.el.crosshair.style.display = scoped ? 'none' : 'block';
    if (performance.now() > this.bannerUntil) this.el.banner.style.opacity = '0';
  }
}
