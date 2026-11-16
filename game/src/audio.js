// audio.js — every sound in Harbourlight is synthesised with WebAudio at
// play time: no audio files, nothing to load, nothing over the network.
// Short filtered-noise bursts make gunfire and hits; oscillators make the
// bomb's beeps and the round stingers.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return true;
  }

  // A noise burst through a band filter: the base of every percussive sound.
  burst({ dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass', slideTo = null }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  tone({ freq = 880, dur = 0.09, gain = 0.2, type = 'square', slideTo = null, delay = 0 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Distance + direction flavour: far shots are quieter and duller.
  shot(kind, dist = 0) {
    const near = Math.max(0.15, 1 - dist / 70);
    if (kind === 'sniper') {
      this.burst({ dur: 0.34, freq: 900 * near + 300, gain: 0.8 * near, slideTo: 120 });
    } else if (kind === 'smg') {
      this.burst({ dur: 0.07, freq: 2400 * near + 500, gain: 0.4 * near });
    } else if (kind === 'pistol') {
      this.burst({ dur: 0.09, freq: 2000 * near + 400, gain: 0.45 * near });
    } else {
      this.burst({ dur: 0.14, freq: 1600 * near + 400, gain: 0.6 * near, slideTo: 220 });
    }
  }

  dryFire() { this.tone({ freq: 1400, dur: 0.03, gain: 0.12, type: 'square' }); }
  reload() {
    this.burst({ dur: 0.05, freq: 900, gain: 0.25 });
    this.tone({ freq: 500, dur: 0.05, gain: 0.15, delay: 0.16, type: 'square' });
  }
  hit(kill = false) {
    this.tone({ freq: kill ? 1560 : 1180, dur: 0.06, gain: 0.22, type: 'sine' });
    if (kill) this.tone({ freq: 780, dur: 0.1, gain: 0.2, delay: 0.05, type: 'sine' });
  }
  hurt() { this.burst({ dur: 0.1, freq: 500, gain: 0.3, type: 'lowpass' }); }
  step(run) { this.burst({ dur: 0.045, freq: run ? 700 : 520, gain: run ? 0.1 : 0.05, type: 'lowpass' }); }
  throwWhoosh() { this.burst({ dur: 0.18, freq: 600, gain: 0.12, slideTo: 1800 }); }
  explosion() {
    this.burst({ dur: 0.8, freq: 300, gain: 0.95, type: 'lowpass', slideTo: 60 });
    this.tone({ freq: 68, dur: 0.7, gain: 0.6, type: 'sine', slideTo: 34 });
  }
  beep(final = false) { this.tone({ freq: final ? 1560 : 1040, dur: final ? 0.22 : 0.07, gain: 0.25, type: 'square' }); }
  plantDone() { this.tone({ freq: 880, dur: 0.08, gain: 0.2 }); this.tone({ freq: 1320, dur: 0.12, gain: 0.2, delay: 0.09 }); }
  roundWin() { [660, 880, 1100].forEach((f, i) => this.tone({ freq: f, dur: 0.12, gain: 0.16, delay: i * 0.09, type: 'triangle' })); }
  roundLose() { [440, 349, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.14, gain: 0.16, delay: i * 0.1, type: 'triangle' })); }
  buy() { this.tone({ freq: 990, dur: 0.05, gain: 0.15 }); this.tone({ freq: 1320, dur: 0.07, gain: 0.15, delay: 0.05 }); }
  denied() { this.tone({ freq: 220, dur: 0.09, gain: 0.18, type: 'square' }); }
}
