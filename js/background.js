/**
 * background.js
 * =====================================================================
 * ARCADE AMBIENT BACKGROUND
 * ---------------------------------------------------------------------
 * Slow-drifting neon particles + faint grid rendered behind the arena
 * on a fixed full-viewport canvas, sitting under everything else
 * (z-index handled in CSS). Purely decorative — runs its own tiny RAF
 * loop independent of the match loop so it keeps animating on the
 * start screen and menus too. Respects the same low-performance flag
 * as the main Effects engine.
 * =====================================================================
 */
"use strict";

const BackgroundFX = {
  canvas: null, ctx: null, particles: [], running: false,

  init() {
    this.canvas = document.getElementById('bgFxCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    const count = this._lowPerf() ? 22 : 55;
    for (let i = 0; i < count; i++) this.particles.push(this._spawn());
    this.running = true;
    requestAnimationFrame(this._loop.bind(this));
  },

  _lowPerf() { return localStorage.getItem('tetrisai.lowPerf') === '1'; },

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  _spawn() {
    const colors = ['255,84,112', '62,230,217', '196,107,255', '255,210,95'];
    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 0.6 + Math.random() * 1.8,
      vy: -0.06 - Math.random() * 0.12,
      vx: (Math.random() - 0.5) * 0.05,
      alpha: 0.15 + Math.random() * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  },

  _loop() {
    if (!this.running) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -10) { p.y = window.innerHeight + 10; p.x = Math.random() * window.innerWidth; }
      if (p.x < -10) p.x = window.innerWidth + 10;
      if (p.x > window.innerWidth + 10) p.x = -10;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(this._loop.bind(this));
  }
};

document.addEventListener('DOMContentLoaded', () => BackgroundFX.init());
