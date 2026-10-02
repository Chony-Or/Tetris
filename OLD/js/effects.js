/**
 * effects.js
 * =====================================================================
 * ARCADE VFX ENGINE
 * ---------------------------------------------------------------------
 * Self-contained, additive visual-effects layer. Nothing in here touches
 * game logic/scoring — game.js calls into `Effects.*` at specific hook
 * points (piece lock, line clear, garbage sent/received, hard drop,
 * hold, countdown, victory) and this file only ever draws on top.
 *
 * Architecture:
 *  - One lightweight <canvas> overlay is stacked on top of each player's
 *    board-frame (`.fx-canvas`), used for per-board effects: line clear
 *    particles/glow, combo/B2B text, lock dust, hard-drop trails, impact
 *    flashes, garbage warnings.
 *  - One full-viewport <canvas> overlay (`#fxGlobalCanvas`) is used for
 *    cross-board effects that must travel between two boards (garbage
 *    attack beams) plus whole-screen effects (screen flash, victory
 *    confetti/fireworks, game-start flash).
 *  - A single shared particle pool avoids per-frame allocation churn so
 *    the effect system stays cheap even with many boards on screen.
 * =====================================================================
 */
"use strict";

const Effects = {
  enabled: true,
  lowPerf: false,           // low-performance mode: fewer particles, no blur/shadow work
  boards: {},                // playerId -> { canvas, ctx, frame, particles:[], texts:[], w, h, cell }
  globalCanvas: null,
  globalCtx: null,
  globalParticles: [],       // beams / confetti / screen-space particles
  screenFlash: { alpha: 0, color: '255,255,255' },
  lastFrameTime: 0,

  // Hard particle-count ceiling per board + global, enforced regardless of
  // how many spawn calls land in one frame (particle pooling requirement).
  MAX_PARTICLES_PER_BOARD: 220,
  MAX_GLOBAL_PARTICLES: 260,

  init() {
    this.globalCanvas = document.getElementById('fxGlobalCanvas');
    if (!this.globalCanvas) {
      this.globalCanvas = document.createElement('canvas');
      this.globalCanvas.id = 'fxGlobalCanvas';
      document.body.appendChild(this.globalCanvas);
    }
    this.globalCtx = this.globalCanvas.getContext('2d');
    this._resizeGlobal();
    window.addEventListener('resize', () => this._resizeGlobal());
    this.lowPerf = localStorage.getItem('tetrisai.lowPerf') === '1';
  },

  _resizeGlobal() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.globalCanvas.width = window.innerWidth * dpr;
    this.globalCanvas.height = window.innerHeight * dpr;
    this.globalCanvas.style.width = window.innerWidth + 'px';
    this.globalCanvas.style.height = window.innerHeight + 'px';
    this.globalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  /** Called once per player when their board-frame DOM exists (buildArena). */
  registerBoard(playerId, frameEl, boardCanvas, cell) {
    let fx = frameEl.querySelector('.fx-canvas');
    if (!fx) {
      fx = document.createElement('canvas');
      fx.className = 'fx-canvas';
      frameEl.appendChild(fx);
    }
    fx.width = boardCanvas.width;
    fx.height = boardCanvas.height;
    fx.style.width = boardCanvas.width + 'px';
    fx.style.height = boardCanvas.height + 'px';
    this.boards[playerId] = {
      canvas: fx, ctx: fx.getContext('2d'), frame: frameEl,
      particles: [], texts: [], w: boardCanvas.width, h: boardCanvas.height, cell,
      pulse: 0, impactFlash: 0
    };
  },

  clearAll() {
    Object.values(this.boards).forEach(b => { b.particles.length = 0; b.texts.length = 0; b.pulse = 0; b.impactFlash = 0; });
    this.globalParticles.length = 0;
    this.screenFlash.alpha = 0;
  },

  _cap(list, extra, max) {
    if (!this.enabled) return false;
    if (list.length + extra > max) return false;
    return true;
  },

  /* =================== PARTICLE FACTORY =================== */
  _mkParticle(x, y, opts) {
    const ang = opts.angle !== undefined ? opts.angle : Math.random() * Math.PI * 2;
    const spd = opts.speed !== undefined ? opts.speed : (1 + Math.random() * 3);
    return {
      x, y,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      gravity: opts.gravity || 0,
      life: 1, decay: opts.decay || (0.012 + Math.random() * 0.015),
      size: opts.size || (2 + Math.random() * 3),
      color: opts.color || '255,210,95',
      shape: opts.shape || 'square',
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.3,
      drag: opts.drag !== undefined ? opts.drag : 0.985
    };
  },

  /* =================== LINE CLEAR =================== */
  lineClear(playerId, rows, clearType) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    const budget = this.lowPerf ? 0.4 : 1;
    const colors = { 1: '107,214,255', 2: '95,255,143', 3: '255,157,61', 4: '255,84,112' };
    const color = colors[Math.min(clearType, 4)] || '255,255,255';
    const perRow = Math.round((clearType >= 4 ? 26 : 14 + clearType * 4) * budget);

    rows.forEach(r => {
      const y = (r - HIDDEN) * b.cell;
      if (y < -b.cell) return;
      if (!this._cap(b.particles, perRow, this.MAX_PARTICLES_PER_BOARD)) return;
      for (let i = 0; i < perRow; i++) {
        const x = Math.random() * b.w;
        b.particles.push(this._mkParticle(x, y + b.cell / 2, {
          angle: -Math.PI / 2 + (Math.random() - 0.5) * 2.2,
          speed: 2 + Math.random() * (clearType >= 4 ? 5 : 3),
          gravity: 0.09,
          decay: 0.02 + Math.random() * 0.02,
          size: 2 + Math.random() * (clearType >= 4 ? 4 : 2.5),
          color,
          shape: Math.random() < 0.5 ? 'square' : 'spark'
        }));
      }
    });

    // glow burst band across the cleared rows
    b.glowBurst = { rows: rows.slice(), color, life: 1 };

    // color streaks for triple/tetris
    if (clearType >= 3) {
      b.streaks = { color, life: 1, big: clearType >= 4 };
    }

    // Tetris gets a dedicated board-wide flash + slight zoom pulse
    if (clearType >= 4) {
      b.impactFlash = 1;
      b.pulse = 1;
      this.flashScreen(color, 0.16);
    } else if (clearType === 3) {
      b.impactFlash = 0.55;
      this.flashScreen(color, 0.08);
    } else if (clearType === 2) {
      b.impactFlash = 0.3;
    }

    this._spawnFloatText(playerId, ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][clearType] || '', color, clearType >= 4 ? 1.6 : 1.0);
  },

  /* =================== COMBO / B2B =================== */
  combo(playerId, comboCount) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    const scale = Math.min(1 + comboCount * 0.08, 2.1);
    this._spawnFloatText(playerId, `COMBO x${comboCount}`, '255,210,95', scale, true);
    if (!this._cap(b.particles, 10, this.MAX_PARTICLES_PER_BOARD)) return;
    for (let i = 0; i < 6 + Math.min(comboCount, 14); i++) {
      b.particles.push(this._mkParticle(b.w / 2, b.h * 0.65, {
        speed: 1.5 + Math.random() * 2.5, gravity: 0.05, color: '255,210,95', size: 2 + Math.random() * 2
      }));
    }
  },

  backToBack(playerId, streak) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    this._spawnFloatText(playerId, `BACK-TO-BACK x${streak}`, '255,215,120', 1.3, true, true);
    if (!this._cap(b.particles, 18, this.MAX_PARTICLES_PER_BOARD)) return;
    for (let i = 0; i < (this.lowPerf ? 8 : 18); i++) {
      b.particles.push(this._mkParticle(b.w / 2, b.h * 0.5, {
        speed: 1 + Math.random() * 3.5, gravity: 0.03, decay: 0.01 + Math.random() * 0.012,
        color: '255,223,140', size: 1.5 + Math.random() * 2.5, shape: 'diamond'
      }));
    }
  },

  _spawnFloatText(playerId, text, color, scale, gold, wide) {
    const b = this.boards[playerId]; if (!b || !text) return;
    b.texts.push({ text, color, life: 1, y: b.h * 0.42, scale, gold, wide, born: performance.now() });
    if (b.texts.length > 4) b.texts.shift();
  },

  /* =================== PIECE LOCK =================== */
  pieceLock(playerId, colRow, cell) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    b.pulse = Math.max(b.pulse, 0.35);
    if (this.lowPerf) return;
    const n = 6;
    if (!this._cap(b.particles, n, this.MAX_PARTICLES_PER_BOARD)) return;
    colRow.forEach(([r, c]) => {
      const vr = r - HIDDEN; if (vr < 0) return;
      const x = c * cell + cell / 2, y = vr * cell + cell;
      for (let i = 0; i < 2; i++) {
        b.particles.push(this._mkParticle(x, y, {
          angle: -Math.PI / 2 + (Math.random() - 0.5) * 1.4, speed: 0.6 + Math.random() * 1.2,
          gravity: 0.06, decay: 0.05, size: 1.5 + Math.random() * 1.5, color: '200,196,220'
        }));
      }
    });
  },

  /* =================== HARD DROP =================== */
  hardDrop(playerId, fromRow, toRow, col, cell) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    const x = col * cell + cell / 2;
    const y1 = Math.max(0, fromRow - HIDDEN) * cell;
    const y2 = Math.max(0, toRow - HIDDEN) * cell + cell;
    b.trail = { x, y1, y2, life: 1 };
    if (this.lowPerf) return;
    if (!this._cap(b.particles, 10, this.MAX_PARTICLES_PER_BOARD)) return;
    for (let i = 0; i < 10; i++) {
      b.particles.push(this._mkParticle(x + (Math.random() - 0.5) * cell * 0.6, y2 - Math.random() * cell, {
        angle: Math.random() * Math.PI, speed: 1 + Math.random() * 2.4, gravity: 0.04,
        decay: 0.03, size: 1.5 + Math.random() * 2, color: '160,210,255'
      }));
    }
  },

  /* =================== HOLD =================== */
  holdPulse(playerId) {
    const b = this.boards[playerId]; if (!b) return;
    b.holdGlow = 1;
  },

  /* =================== GARBAGE / ATTACK =================== */
  incomingWarning(playerId) {
    const b = this.boards[playerId]; if (!b) return;
    b.warnPulse = 1;
  },

  garbageImpact(playerId, amount) {
    const b = this.boards[playerId]; if (!b || !this.enabled) return;
    b.impactFlash = Math.min(1, 0.4 + amount / 12);
    b.pulse = Math.max(b.pulse, Math.min(1, 0.3 + amount / 14));
    if (this.lowPerf) return;
    const n = Math.min(30, 8 + amount * 2);
    if (!this._cap(b.particles, n, this.MAX_PARTICLES_PER_BOARD)) return;
    for (let i = 0; i < n; i++) {
      b.particles.push(this._mkParticle(Math.random() * b.w, b.h, {
        angle: -Math.PI / 2 + (Math.random() - 0.5) * 1.4, speed: 2 + Math.random() * 3,
        gravity: 0.1, decay: 0.02, size: 2 + Math.random() * 2.5, color: '255,138,61'
      }));
    }
  },

  /** Animated attack trail from attacker's board to target's board, in screen space. */
  attackBeam(fromPlayerId, toPlayerId, amount) {
    if (!this.enabled) return;
    const fromFrame = this.boards[fromPlayerId] && this.boards[fromPlayerId].frame;
    const toFrame = this.boards[toPlayerId] && this.boards[toPlayerId].frame;
    if (!fromFrame || !toFrame) return;
    const fr = fromFrame.getBoundingClientRect(), tr = toFrame.getBoundingClientRect();
    const start = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
    const end = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
    const color = amount >= 6 ? '255,84,112' : '255,157,61';
    this.globalParticles.push({
      type: 'beam', start, end, life: 1, decay: 0.045, color, amount,
      wobble: Math.random() * 10
    });
    if (this.lowPerf) return;
    const n = Math.min(18, 6 + amount);
    for (let i = 0; i < n; i++) {
      if (this.globalParticles.length > this.MAX_GLOBAL_PARTICLES) break;
      const t = Math.random();
      this.globalParticles.push({
        type: 'spark',
        x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        life: 1, decay: 0.03 + Math.random() * 0.03, color, size: 1.5 + Math.random() * 2
      });
    }
  },

  /* =================== ELIMINATION =================== */
  eliminate(playerId) {
    const b = this.boards[playerId]; if (!b) return;
    b.impactFlash = 1;
    b.pulse = 1;
    this.flashScreen('255,45,85', 0.28);
    document.body.classList.remove('fx-camshake'); void document.body.offsetWidth;
    document.body.classList.add('fx-camshake-big');
    setTimeout(() => document.body.classList.remove('fx-camshake-big'), 450);

    this._spawnFloatText(playerId, 'K.O.', '255,45,85', 2.2, true, false);

    if (!this.enabled) return;
    // Board-destruction burst: particles erupting from every filled cell,
    // capped by the shared per-board particle budget.
    const budget = this.lowPerf ? 60 : 140;
    if (!this._cap(b.particles, budget, this.MAX_PARTICLES_PER_BOARD)) return;
    for (let i = 0; i < budget; i++) {
      const x = Math.random() * b.w, y = Math.random() * b.h;
      b.particles.push(this._mkParticle(x, y, {
        speed: 1.5 + Math.random() * 5, gravity: 0.12, decay: 0.012 + Math.random() * 0.02,
        size: 2 + Math.random() * 4.5, color: Math.random() < 0.5 ? '255,84,112' : '255,157,61',
        shape: Math.random() < 0.5 ? 'square' : 'spark'
      }));
    }
    // A slower secondary "smoke" wave for a bigger explosion feel
    setTimeout(() => {
      if (!this._cap(b.particles, 30, this.MAX_PARTICLES_PER_BOARD)) return;
      for (let i = 0; i < 30; i++) {
        b.particles.push(this._mkParticle(b.w / 2, b.h / 2, {
          speed: 0.5 + Math.random() * 2, gravity: -0.01, decay: 0.01,
          size: 4 + Math.random() * 6, color: '90,86,100', shape: 'square'
        }));
      }
    }, 120);
  },

  /** Center-screen drama banner used for "N PLAYERS REMAIN" / "FINAL SHOWDOWN" / eliminated tag. */
  showDramaBanner(text, opts) {
    opts = opts || {};
    let el = document.getElementById('dramaBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dramaBanner';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.color = opts.color ? `rgb(${opts.color})` : '';
    el.className = 'drama-banner-hidden';
    void el.offsetWidth;
    el.className = 'drama-banner-show' + (opts.big ? ' drama-banner-big' : '');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.className = 'drama-banner-hidden'; }, opts.duration || 1600);
  },

  /* =================== GAME START =================== */
  countdownPulse() {
    this.flashScreen('255,210,95', 0.1);
  },
  goFlash() {
    this.flashScreen('62,230,217', 0.22);
    document.body.classList.remove('fx-camshake'); void document.body.offsetWidth;
    document.body.classList.add('fx-camshake');
  },

  /* =================== VICTORY =================== */
  victory(winnerFrame) {
    if (!this.enabled) return;
    const colors = ['255,84,112', '255,210,95', '62,230,217', '196,107,255', '95,255,143'];
    const w = window.innerWidth;
    const count = this.lowPerf ? 60 : 140;
    for (let i = 0; i < count; i++) {
      if (this.globalParticles.length > this.MAX_GLOBAL_PARTICLES) break;
      this.globalParticles.push({
        type: 'confetti',
        x: Math.random() * w, y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 1.5, vy: 2 + Math.random() * 3,
        life: 1, decay: 0.0035 + Math.random() * 0.003,
        rot: Math.random() * Math.PI, rotSpeed: (Math.random() - 0.5) * 0.2,
        size: 5 + Math.random() * 6, color: colors[i % colors.length]
      });
    }
    // fireworks bursts
    const bursts = this.lowPerf ? 3 : 6;
    for (let f = 0; f < bursts; f++) {
      setTimeout(() => this._firework(colors[f % colors.length]), f * 420);
    }
    if (winnerFrame) {
      winnerFrame.classList.add('fx-spotlight');
    }
  },

  _firework(colorCss) {
    const x = window.innerWidth * (0.2 + Math.random() * 0.6);
    const y = window.innerHeight * (0.2 + Math.random() * 0.35);
    const n = this.lowPerf ? 20 : 40;
    for (let i = 0; i < n; i++) {
      if (this.globalParticles.length > this.MAX_GLOBAL_PARTICLES) break;
      const ang = (Math.PI * 2 * i) / n;
      const spd = 2 + Math.random() * 3;
      this.globalParticles.push({
        type: 'spark', x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: 1, decay: 0.018 + Math.random() * 0.012, color: colorCss, size: 2 + Math.random() * 2, gravity: 0.03
      });
    }
  },

  flashScreen(colorCss, intensity) {
    this.screenFlash.color = colorCss;
    this.screenFlash.alpha = Math.max(this.screenFlash.alpha, intensity);
  },

  clearWinnerSpotlight() {
    document.querySelectorAll('.fx-spotlight').forEach(el => el.classList.remove('fx-spotlight'));
  },

  /* =================== UPDATE + RENDER (called every frame) =================== */
  update(dtMs) {
    const dt = Math.min(dtMs / 16.67, 3);
    Object.values(this.boards).forEach(b => {
      b.particles = b.particles.filter(p => p.life > 0);
      b.particles.forEach(p => {
        p.vx *= p.drag; p.vy = p.vy * p.drag + p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rotation += p.rotSpeed * dt;
        p.life -= p.decay * dt;
      });
      b.texts = b.texts.filter(t => t.life > 0);
      b.texts.forEach(t => t.life -= 0.012 * dt);
      if (b.glowBurst) { b.glowBurst.life -= 0.045 * dt; if (b.glowBurst.life <= 0) b.glowBurst = null; }
      if (b.streaks) { b.streaks.life -= 0.035 * dt; if (b.streaks.life <= 0) b.streaks = null; }
      if (b.trail) { b.trail.life -= 0.08 * dt; if (b.trail.life <= 0) b.trail = null; }
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - 0.05 * dt);
      if (b.impactFlash > 0) b.impactFlash = Math.max(0, b.impactFlash - 0.06 * dt);
      if (b.warnPulse > 0) b.warnPulse = Math.max(0, b.warnPulse - 0.03 * dt);
      if (b.holdGlow > 0) b.holdGlow = Math.max(0, b.holdGlow - 0.05 * dt);
    });

    this.globalParticles = this.globalParticles.filter(p => p.life > 0);
    this.globalParticles.forEach(p => {
      p.life -= p.decay * dt;
      if (p.type === 'confetti') { p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.rotSpeed * dt; }
      else if (p.type === 'spark') { p.vy += (p.gravity || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    });
    if (this.screenFlash.alpha > 0) this.screenFlash.alpha = Math.max(0, this.screenFlash.alpha - 0.05 * dt);
  },

  render() {
    Object.values(this.boards).forEach(b => this._renderBoard(b));
    this._renderGlobal();
  },

  _renderBoard(b) {
    const ctx = b.ctx;
    ctx.clearRect(0, 0, b.w, b.h);

    if (b.impactFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${b.impactFlash * 0.35})`;
      ctx.fillRect(0, 0, b.w, b.h);
    }

    if (b.glowBurst) {
      const cell = b.cell;
      b.glowBurst.rows.forEach(r => {
        const y = (r - HIDDEN) * cell;
        const grad = ctx.createLinearGradient(0, y, 0, y + cell);
        grad.addColorStop(0, `rgba(${b.glowBurst.color},0)`);
        grad.addColorStop(0.5, `rgba(${b.glowBurst.color},${0.55 * b.glowBurst.life})`);
        grad.addColorStop(1, `rgba(${b.glowBurst.color},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 4, b.w, cell + 8);
      });
    }

    if (b.streaks) {
      ctx.save();
      ctx.globalAlpha = b.streaks.life * 0.7;
      const n = b.streaks.big ? 6 : 3;
      for (let i = 0; i < n; i++) {
        const y = (b.h / (n + 1)) * (i + 1) + (Math.random() - 0.5) * 4;
        ctx.strokeStyle = `rgb(${b.streaks.color})`;
        ctx.lineWidth = b.streaks.big ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(-20, y);
        ctx.lineTo(b.w * (1.4 - b.streaks.life * 0.4), y);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (b.trail) {
      ctx.save();
      ctx.globalAlpha = b.trail.life;
      const grad = ctx.createLinearGradient(0, b.trail.y1, 0, b.trail.y2);
      grad.addColorStop(0, 'rgba(160,210,255,0)');
      grad.addColorStop(1, 'rgba(160,210,255,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(b.trail.x - 3, b.trail.y1, 6, b.trail.y2 - b.trail.y1);
      ctx.restore();
    }

    b.particles.forEach(p => this._drawParticle(ctx, p));

    if (b.warnPulse > 0) {
      ctx.strokeStyle = `rgba(255,45,85,${b.warnPulse * 0.8})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, b.w - 4, b.h - 4);
    }

    b.texts.forEach(t => this._drawFloatText(ctx, b, t));
  },

  _drawParticle(ctx, p) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation || 0);
    ctx.fillStyle = `rgb(${p.color})`;
    if (p.shape === 'spark') {
      ctx.fillRect(-p.size, -0.7, p.size * 2, 1.4);
    } else if (p.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -p.size); ctx.lineTo(p.size, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size, 0);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  },

  _drawFloatText(ctx, b, t) {
    const age = 1 - t.life;
    const rise = age * 26;
    const alpha = t.life > 0.15 ? 1 : t.life / 0.15;
    const pop = t.life > 0.85 ? (1 - t.life) / 0.15 : 1; // quick pop-in
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.textAlign = 'center';
    const size = Math.round((t.wide ? 15 : 20) * (t.scale || 1) * (0.7 + pop * 0.3));
    ctx.font = `700 ${size}px Rajdhani, Arial Narrow, sans-serif`;
    ctx.translate(b.w / 2, t.y - rise);
    if (t.gold) {
      ctx.shadowColor = `rgb(${t.color})`; ctx.shadowBlur = 12;
    }
    ctx.fillStyle = `rgb(${t.color})`;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  },

  _renderGlobal() {
    const ctx = this.globalCtx;
    ctx.clearRect(0, 0, this.globalCanvas.width, this.globalCanvas.height);

    this.globalParticles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.type === 'beam') {
        const grad = ctx.createLinearGradient(p.start.x, p.start.y, p.end.x, p.end.y);
        grad.addColorStop(0, `rgba(${p.color},0.9)`);
        grad.addColorStop(1, `rgba(${p.color},0.15)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3 + Math.min(6, p.amount);
        ctx.shadowColor = `rgb(${p.color})`;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        const midX = (p.start.x + p.end.x) / 2 + Math.sin(performance.now() / 60) * p.wobble;
        const midY = (p.start.y + p.end.y) / 2;
        ctx.moveTo(p.start.x, p.start.y);
        ctx.quadraticCurveTo(midX, midY, p.end.x, p.end.y);
        ctx.stroke();
      } else if (p.type === 'confetti') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else if (p.type === 'spark') {
        ctx.fillStyle = `rgb(${p.color})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    });

    if (this.screenFlash.alpha > 0) {
      ctx.fillStyle = `rgba(${this.screenFlash.color},${this.screenFlash.alpha})`;
      ctx.fillRect(0, 0, this.globalCanvas.width, this.globalCanvas.height);
    }
  }
};
