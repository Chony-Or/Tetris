/**
 * audio.js
 * =====================================================================
 * FULL AUDIO MANAGER
 * ---------------------------------------------------------------------
 * Replaces the old inline AudioManager in game.js with a bus-based
 * mixer (Master -> Music / SFX / UI), voice pooling so rapid repeated
 * SFX (e.g. DAS-repeated move sounds) never stack into a wall of noise,
 * smooth fade in/out for music transitions, and procedural background
 * music per game state (menu / gameplay / danger / victory / game over)
 * so no external audio assets are required.
 *
 * All volumes are 0-1 and persisted via SettingsManager (localStorage).
 * =====================================================================
 */
"use strict";

const AudioManager = {
  ctx: null,
  muted: false,
  buses: {}, // master, music, sfx, ui
  volumes: { master: 0.8, music: 0.5, sfx: 0.8, ui: 0.7 },

  // Voice pooling: caps how many of the *same* short SFX can overlap in a
  // short window, so e.g. rapid-fire "move" sounds during DAS don't turn
  // into a buzzing mess. Each key tracks the last-played timestamp.
  _voiceLastPlayed: {},
  _voiceMinGapMs: { move: 28, rotate: 40, softdrop: 40 },

  _music: { track: null, timer: null, gain: null, tempo: 500 },

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.buses.master = this.ctx.createGain();
      this.buses.master.connect(this.ctx.destination);

      this.buses.music = this.ctx.createGain();
      this.buses.music.connect(this.buses.master);
      this.buses.sfx = this.ctx.createGain();
      this.buses.sfx.connect(this.buses.master);
      this.buses.ui = this.ctx.createGain();
      this.buses.ui.connect(this.buses.master);

      this.loadSettings();
      this.applyVolumes();
    } catch (e) { this.ctx = null; }
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  loadSettings() {
    try {
      const raw = localStorage.getItem('tetrisai.audioSettings');
      if (raw) {
        const s = JSON.parse(raw);
        this.volumes = Object.assign(this.volumes, s.volumes || {});
        this.muted = !!s.muted;
      }
    } catch (e) { /* ignore corrupt settings */ }
  },

  saveSettings() {
    try {
      localStorage.setItem('tetrisai.audioSettings', JSON.stringify({ volumes: this.volumes, muted: this.muted }));
    } catch (e) { /* storage unavailable — ignore */ }
  },

  setVolume(bus, value) {
    this.volumes[bus] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
    this.saveSettings();
  },

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
    this.saveSettings();
  },

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mv = this.muted ? 0 : this.volumes.master;
    this.buses.master.gain.setTargetAtTime(mv, t, 0.05);
    this.buses.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(this.volumes.ui, t, 0.05);
  },

  resetToDefaults() {
    this.volumes = { master: 0.8, music: 0.5, sfx: 0.8, ui: 0.7 };
    this.muted = false;
    this.applyVolumes();
    this.saveSettings();
  },

  /* =================== LOW-LEVEL TONE (SFX bus) =================== */
  _tone(bus, freq, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(bus);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },

  _pooledTone(key, bus, freq, dur, type, vol, glideTo) {
    if (!this.ctx) return;
    const minGap = this._voiceMinGapMs[key] || 0;
    const now = performance.now();
    const last = this._voiceLastPlayed[key] || 0;
    if (minGap && now - last < minGap) return; // dropped — pool at capacity for this voice
    this._voiceLastPlayed[key] = now;
    this._tone(bus, freq, dur, type, vol, glideTo);
  },

  /* =================== GAMEPLAY SFX =================== */
  move() { this._pooledTone('move', this.buses.sfx, 220, 0.03, 'square', 0.13); },
  rotate() { this._pooledTone('rotate', this.buses.sfx, 330, 0.05, 'square', 0.18); },
  hold() { this._tone(this.buses.sfx, 180, 0.08, 'triangle', 0.22); },
  lock() { this._tone(this.buses.sfx, 140, 0.07, 'square', 0.22); },
  softdrop() { this._pooledTone('softdrop', this.buses.sfx, 110, 0.02, 'square', 0.07); },
  harddrop() { this._tone(this.buses.sfx, 90, 0.09, 'sawtooth', 0.28); this._tone(this.buses.sfx, 55, 0.12, 'sine', 0.2); },
  clear(n) {
    const freqs = [440, 554, 659, 880];
    this._tone(this.buses.sfx, freqs[Math.min(n - 1, 3)], 0.18, 'square', 0.3);
    if (n >= 2) this._tone(this.buses.sfx, freqs[Math.min(n - 1, 3)] * 1.5, 0.14, 'triangle', 0.16);
    if (n >= 4) { setTimeout(() => this._tone(this.buses.sfx, 1100, 0.28, 'square', 0.3), 80); setTimeout(() => this._tone(this.buses.sfx, 1400, 0.3, 'triangle', 0.22), 150); }
  },
  combo(count) { this._tone(this.buses.sfx, 500 + Math.min(count, 12) * 40, 0.09, 'triangle', 0.22); },
  backToBack() { this._tone(this.buses.sfx, 620, 0.12, 'sawtooth', 0.24, 950); },
  tspin() { this._tone(this.buses.sfx, 700, 0.15, 'sawtooth', 0.28, 1200); },
  perfectClear() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this._tone(this.buses.sfx, f, 0.25, 'square', 0.3), i * 90)); },
  garbageSent() { this._tone(this.buses.sfx, 320, 0.1, 'sawtooth', 0.22, 200); },
  garbageWarn() { this._tone(this.buses.sfx, 160, 0.2, 'sawtooth', 0.18); },
  garbageImpact() { this._tone(this.buses.sfx, 80, 0.22, 'square', 0.3); },
  countdown() { this._tone(this.buses.ui, 400, 0.1, 'square', 0.28); },
  go() { this._tone(this.buses.ui, 800, 0.25, 'square', 0.36); },
  pauseSound() { this._tone(this.buses.ui, 300, 0.08, 'triangle', 0.2); },
  resumeSound() { this._tone(this.buses.ui, 380, 0.08, 'triangle', 0.2); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(this.buses.sfx, f, 0.3, 'triangle', 0.28), i * 130)); },
  lose() { [330, 294, 262, 220].forEach((f, i) => setTimeout(() => this._tone(this.buses.sfx, f, 0.35, 'sawtooth', 0.22), i * 150)); },
  victory() { this.win(); },

  /* =================== UI SFX =================== */
  buttonHover() { this._tone(this.buses.ui, 700, 0.03, 'sine', 0.08); },
  buttonClick() { this._tone(this.buses.ui, 500, 0.05, 'square', 0.16); },
  navMove() { this._pooledTone('navMove', this.buses.ui, 560, 0.025, 'sine', 0.1); },
  navConfirm() { this._tone(this.buses.ui, 660, 0.06, 'square', 0.2); },
  navBack() { this._tone(this.buses.ui, 260, 0.06, 'square', 0.16); },
  playerJoin() { this._tone(this.buses.ui, 440, 0.06, 'triangle', 0.22); this._tone(this.buses.ui, 660, 0.08, 'triangle', 0.18, 880); },
  playerLeave() { this._tone(this.buses.ui, 440, 0.08, 'triangle', 0.18, 220); },

  /* =================== ELIMINATION / MATCH DRAMA =================== */
  elimination() { this._tone(this.buses.sfx, 300, 0.08, 'sawtooth', 0.3); setTimeout(() => this._tone(this.buses.sfx, 160, 0.35, 'sawtooth', 0.32, 60), 90); },
  finalShowdown() { [392, 466, 523].forEach((f, i) => setTimeout(() => this._tone(this.buses.sfx, f, 0.3, 'sawtooth', 0.28), i * 140)); },
  controllerWarn() { this._tone(this.buses.ui, 220, 0.15, 'square', 0.2, 140); },
  controllerReconnect() { this._tone(this.buses.ui, 440, 0.1, 'triangle', 0.2, 660); },

  /* =================== PROCEDURAL MUSIC =================== */
  // Each track is a short chord/arp progression played on a loop with a
  // gentle fade so switching tracks never pops.
  _tracks: {
    menu: { tempo: 620, notes: [330, 392, 440, 392, 330, 294, 330, 392], wave: 'triangle', vol: 0.11 },
    gameplay: { tempo: 260, notes: [220, 262, 294, 262, 220, 196, 220, 262, 294, 330, 294, 262], wave: 'square', vol: 0.09 },
    danger: { tempo: 150, notes: [196, 220, 196, 175, 196, 220, 233, 220], wave: 'sawtooth', vol: 0.1 },
    victory: { tempo: 220, notes: [523, 659, 784, 659, 523, 659, 784, 988], wave: 'triangle', vol: 0.13 },
    gameover: { tempo: 400, notes: [220, 196, 175, 165], wave: 'sawtooth', vol: 0.1 }
  },

  playMusic(trackName) {
    if (!this.ctx) return;
    if (this._music.track === trackName) return;
    this.stopMusic(true);
    const cfg = this._tracks[trackName];
    if (!cfg) return;
    this._music.track = trackName;

    const trackGain = this.ctx.createGain();
    trackGain.gain.value = 0;
    trackGain.connect(this.buses.music);
    trackGain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.6);
    this._music.gain = trackGain;

    let i = 0;
    const step = () => {
      if (this._music.track !== trackName) return;
      const freq = cfg.notes[i % cfg.notes.length];
      this._tone(trackGain, freq, cfg.tempo / 1000 * 0.9, cfg.wave, cfg.vol);
      if (i % 4 === 0) this._tone(trackGain, freq / 2, cfg.tempo / 1000 * 1.6, 'sine', cfg.vol * 0.6);
      i++;
      this._music.timer = setTimeout(step, cfg.tempo);
    };
    step();
  },

  stopMusic(immediate) {
    if (this._music.timer) clearTimeout(this._music.timer);
    this._music.timer = null;
    const prevTrack = this._music.track;
    this._music.track = null;
    if (this._music.gain && this.ctx) {
      if (immediate) {
        this._music.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this._music.gain.gain.setValueAtTime(0, this.ctx.currentTime);
      } else {
        this._music.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
      }
    }
  }
};
