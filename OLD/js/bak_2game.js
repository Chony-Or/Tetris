/**
 * game.js
 * =====================================================================
 * Core Tetris gameplay: board grid, pieces, scoring, garbage/attacks,
 * the main game loop, and input handling for both keyboard and
 * confirmed gamepads.
 *
 * This file assumes `gamepadConfig.js` and `VibrationManager.js` have
 * already been loaded (see index.html script order) and that
 * `ControllerSetup` has produced a finished `assignments` array before
 * `MatchManager.setupPlayers()` is called.
 * =====================================================================
 */
"use strict";

/* ===================== BOARD / PIECE CONSTANTS ===================== */
const COLS = 10;
const ROWS = 20;
const HIDDEN = 4; // hidden rows above the visible playfield, used for spawn/rotation headroom
const TOTAL_ROWS = ROWS + HIDDEN;

const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const COLORS = {
  I: '#3ee6d9', O: '#ffd25f', T: '#c46bff', S: '#5fff8f',
  Z: '#ff5470', J: '#4d8dff', L: '#ff9d3d', G: '#4a4658'
};
const PLAYER_COLORS = ['#ff5470', '#3ee6d9', '#ffd25f', '#c46bff'];

// Rotation states 0-3 for each piece, expressed as [row,col] offsets from a local origin.
const SHAPES = {
  I: [[[1, 0], [1, 1], [1, 2], [1, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]], [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 1], [1, 1], [2, 1], [3, 1]]],
  O: [[[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]]],
  T: [[[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]]],
  S: [[[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 1], [1, 2], [2, 0], [2, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]]],
  Z: [[[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 2], [1, 1], [1, 2], [2, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]]],
  J: [[[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [2, 1]], [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]]],
  L: [[[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]], [[1, 0], [1, 1], [1, 2], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]]]
};
// SRS wall-kick offset tables, keyed by "fromState>toState".
const KICKS_JLSTZ = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
};

/* ===================== AUDIO MANAGER ===================== */
// Full bus-based AudioManager (music/sfx/ui mixing, voice pooling, fades,
// procedural music) now lives in js/audio.js, loaded before this file.

/* ===================== 7-BAG RANDOMIZER ===================== */
// Standard "bag" randomizer: shuffles one of each of the 7 pieces, guaranteeing
// no piece is seen more than twice in a 13-piece span.
function Bag() { this.queue = []; this.refill(); }
Bag.prototype.refill = function () {
  const bag = PIECES.slice();
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[bag[i], bag[j]] = [bag[j], bag[i]]; }
  this.queue.push(...bag);
};
Bag.prototype.next = function () { if (this.queue.length <= 7) this.refill(); return this.queue.shift(); };
Bag.prototype.peek = function (n) { while (this.queue.length < n + 7) this.refill(); return this.queue.slice(0, n); };

/* ===================== ATTACK / GARBAGE TABLE ===================== */
// Determines how many garbage lines a clear sends to opponents.
function baseAttack(clearType, isTspin, isMini) {
  if (isTspin) {
    if (isMini) return clearType === 1 ? 1 : 2;
    if (clearType === 1) return 2;
    if (clearType === 2) return 4;
    if (clearType === 3) return 6;
  }
  if (clearType === 1) return 0;
  if (clearType === 2) return 1;
  if (clearType === 3) return 2;
  if (clearType === 4) return 4;
  return 0;
}
const COMBO_TABLE = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
function comboBonus(combo) { return COMBO_TABLE[Math.min(combo, COMBO_TABLE.length - 1)]; }

/* =========================================================================
   PLAYER
   Holds one player's board state, current/held/next pieces, score, and
   the assigned input source (keyboard layout OR a confirmed gamepad).
========================================================================= */
function Player(id, els, assignment, cell) {
  this.id = id;
  this.els = els; // {canvas, holdCanvas, nextCanvas}
  this.assignment = assignment; // { type:'keyboard'|'gamepad', keyboardKey, gamepadIndex, profileKey }
  this.cell = cell;
  this.targetCursor = 0; // round-robin cursor used when choosing an attack target in 3-4P

  this.canvas = els.canvas; this.ctx = this.canvas.getContext('2d');
  this.holdCanvas = els.holdCanvas; this.holdCtx = this.holdCanvas.getContext('2d');
  this.nextCanvas = els.nextCanvas; this.nextCtx = this.nextCanvas.getContext('2d');

  this.reset();
}

Player.prototype.reset = function () {
  this.grid = [];
  for (let r = 0; r < TOTAL_ROWS; r++) this.grid.push(new Array(COLS).fill(null));

  this.bag = new Bag();
  this.current = null; this.holdPiece = null; this.canHold = true;
  this.rotState = 0; this.px = 0; this.py = 0;

  this.score = 0; this.lines = 0; this.level = 1; this.combo = -1; this.b2b = 0;
  this.piecesPlaced = 0; this.attacksSent = 0; this.keysPressed = 0;
  this.garbageReceived = 0; this.highestCombo = 0;
  this.eliminated = false; this.placement = null; this.eliminatedAt = null; this.timeSurvivedMs = 0;

  this.garbageQueue = []; this.pendingGarbageTotal = 0; this.pendingAttackOut = 0;

  this.gravityTimer = 0; this.gravityInterval = 800;
  this.lockTimer = 0; this.lockDelay = 500; this.lockResets = 0; this.maxLockResets = 15;
  this.isLocking = false; this.softDropping = false;

  // this.dasTimer = 0; this.dasDelay = 133; this.arr = 0; this.dasDir = 0; this.dasCharged = false;
  this.dasTimer = 0; this.dasDelay = 300; this.arr = 66; this.dasDir = 0; this.dasCharged = false;
    this.dasTimer = 0; this.dasDelay = 200; this.arr = 40; this.dasDir = 0; this.dasCharged = false;

  this.lastRotationWasKick = undefined; this.tspinCandidate = null;
  this.topOut = false; this.alive = true;

  this.ghostY = 0;
  this.startTime = performance.now();
  this.lastActionAt = performance.now();

  this.lockFlash = 0; this.clearFlashRows = []; this.clearFlashTimer = 0;

  this.spawnNext();
};

Player.prototype.spawnNext = function () {
  const type = this.bag.next();
  this.current = type; this.rotState = 0;
  this.px = HIDDEN - 1; this.py = 3;
  this.canHold = true; this.lockTimer = 0; this.isLocking = false; this.lockResets = 0;

  // Block-out check: if the spawn cell is already occupied, the player tops out.
  if (this.checkCollision(this.px, this.py, this.rotState)) {
    if (!this.checkCollision(this.px - 1, this.py, this.rotState)) this.px -= 1;
    else { this.topOut = true; this.alive = false; }
  }
  this.updateGhost();
};

Player.prototype.cellsFor = function (type, rot, px, py) {
  return SHAPES[type][rot].map(([r, c]) => [px + r, py + c]);
};
// Collision check against board bounds and locked cells.
Player.prototype.checkCollision = function (px, py, rot) {
  const cells = this.cellsFor(this.current, rot, px, py);
  for (const [r, c] of cells) {
    if (c < 0 || c >= COLS) return true;
    if (r >= TOTAL_ROWS) return true;
    if (r >= 0 && this.grid[r][c]) return true;
  }
  return false;
};
// Recomputes the ghost-piece landing row (used for the drop preview outline).
Player.prototype.updateGhost = function () {
  let gy = this.px;
  while (!this.checkCollision(gy + 1, this.py, this.rotState)) gy++;
  this.ghostY = gy;
};
Player.prototype.move = function (dx) {
  if (!this.alive) return false;
  this.lastActionAt = performance.now();
  if (!this.checkCollision(this.px, this.py + dx, this.rotState)) {
    this.py += dx; this.updateGhost(); this.resetLockIfGrounded(); AudioManager.move();
    return true;
  }
  return false;
};
// Extends the lock-delay window (up to maxLockResets times) whenever the
// player moves/rotates while resting on a surface — standard "infinity" rule.
Player.prototype.resetLockIfGrounded = function () {
  if (this.checkCollision(this.px + 1, this.py, this.rotState)) {
    if (this.lockResets < this.maxLockResets) { this.lockTimer = 0; this.lockResets++; }
  }
};
Player.prototype.softDrop = function () {
  if (!this.alive) return;
  if (!this.checkCollision(this.px + 1, this.py, this.rotState)) {
    this.px++; this.score += 1; this.gravityTimer = 0; AudioManager.softdrop();
  }
};
Player.prototype.hardDrop = function () {
  if (!this.alive) return;
  this.lastActionAt = performance.now();
  const startRow = this.px;
  let dist = 0;
  while (!this.checkCollision(this.px + 1, this.py, this.rotState)) { this.px++; dist++; }
  this.score += dist * 2; AudioManager.harddrop();
  if (typeof Effects !== 'undefined' && dist > 0) {
    Effects.hardDrop(this.id, startRow, this.px, this.py, this.cell);
  }
  this.lockPiece(true);
};
// Attempts an SRS rotation with wall-kicks; dir: 1=CW, -1=CCW, 2=180.
Player.prototype.tryRotate = function (dir) {
  if (!this.alive) return;
  this.lastActionAt = performance.now();
  const type = this.current; const from = this.rotState;
  let to;
  if (dir === 2) to = (from + 2) % 4; else to = (from + (dir === 1 ? 1 : 3)) % 4;
  let kicks;
  if (type === 'O') { kicks = [[0, 0]]; }
  else if (dir === 2) { kicks = [[0, 0], [0, 1], [0, -1], [-1, 0], [1, 0]]; }
  else if (type === 'I') { kicks = KICKS_I[`${from}>${to}`] || [[0, 0]]; }
  else { kicks = KICKS_JLSTZ[`${from}>${to}`] || [[0, 0]]; }

  for (const [dr, dc] of kicks) {
    const nr = this.px - dr; const nc = this.py + dc;
    if (!this.checkCollision(nr, nc, to)) {
      this.lastRotationWasKick = (dr !== 0 || dc !== 0);
      this.px = nr; this.py = nc; this.rotState = to;
      this.updateGhost(); this.resetLockIfGrounded(); AudioManager.rotate();
      this.checkTspinSetup();
      return true;
    }
  }
  return false;
};
// Detects the classic 3-corner T-spin condition (full vs mini) after a rotation.
Player.prototype.checkTspinSetup = function () {
  this.tspinCandidate = null;
  if (this.current !== 'T') return;
  const cx = this.px + 1, cy = this.py + 1;
  const corners = [[cx - 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy - 1], [cx + 1, cy + 1]];
  const frontMap = { 0: [[cx + 1, cy - 1], [cx + 1, cy + 1]], 1: [[cx - 1, cy + 1], [cx + 1, cy + 1]], 2: [[cx - 1, cy - 1], [cx - 1, cy + 1]], 3: [[cx - 1, cy - 1], [cx + 1, cy - 1]] };
  const isFilled = (r, c) => (r < 0 || r >= TOTAL_ROWS || c < 0 || c >= COLS) ? true : !!this.grid[r][c];
  let filled = 0;
  for (const [r, c] of corners) { if (isFilled(r, c)) filled++; }
  const front = frontMap[this.rotState];
  let frontCount = 0;
  for (const [r, c] of front) { if (isFilled(r, c)) frontCount++; }
  if (filled >= 3 && this.lastRotationWasKick !== undefined) {
    this.tspinCandidate = (frontCount === 2) ? 'full' : 'mini';
  }
};
Player.prototype.hold = function () {
  if (!this.alive || !this.canHold) return;
  this.lastActionAt = performance.now();
  AudioManager.hold();
  if (typeof Effects !== 'undefined') Effects.holdPulse(this.id);
  const cur = this.current;
  if (this.holdPiece === null) { this.holdPiece = cur; this.spawnNext(); }
  else {
    const swap = this.holdPiece; this.holdPiece = cur; this.current = swap;
    this.rotState = 0; this.px = HIDDEN - 1; this.py = 3;
    if (this.checkCollision(this.px, this.py, this.rotState)) {
      if (!this.checkCollision(this.px - 1, this.py, this.rotState)) this.px -= 1;
    }
    this.updateGhost();
  }
  this.canHold = false;
};

/**
 * lockPiece()
 * Locks the current piece into the grid, clears completed lines, scores
 * the result (including T-spin/B2B/combo/perfect-clear bonuses), and
 * computes how much garbage-attack this clear generates.
 *
 * ATTACK GENERATED HERE
 * The `pendingAttackOut` value set at the bottom of this function is
 * read by `handleGarbageTransfer()` in the match loop, which routes it
 * to opponents and triggers their incoming-garbage warning + rumble.
 */
Player.prototype.lockPiece = function () {
  if (!this.alive) return;
  const cells = this.cellsFor(this.current, this.rotState, this.px, this.py);
  for (const [r, c] of cells) { if (r >= 0 && r < TOTAL_ROWS) this.grid[r][c] = this.current; }

  let isTspin = false, isMini = false;
  if (this.current === 'T' && this.tspinCandidate) { isTspin = true; isMini = (this.tspinCandidate === 'mini'); }

  let clearedRows = [];
  for (let r = 0; r < TOTAL_ROWS; r++) { if (this.grid[r].every(cell => cell !== null)) clearedRows.push(r); }
  const numCleared = clearedRows.length;

  AudioManager.lock(); this.lockFlash = 1;
  if (typeof Effects !== 'undefined') Effects.pieceLock(this.id, cells, this.cell);

  if (numCleared > 0) {
    this.clearFlashRows = clearedRows.slice(); this.clearFlashTimer = 1;
    clearedRows.forEach(r => { this.grid.splice(r, 1); this.grid.unshift(new Array(COLS).fill(null)); });
    this.lines += numCleared;
    AudioManager.clear(numCleared);
    if (isTspin) AudioManager.tspin();
    if (typeof Effects !== 'undefined') Effects.lineClear(this.id, clearedRows, numCleared);
  }

  let base = 0;
  if (isTspin) { base = isMini ? (numCleared === 1 ? 200 : 100) : ([0, 800, 1200, 1600, 0][numCleared] || 400); }
  else { base = [0, 100, 300, 500, 800][numCleared] || 0; }
  const isDifficult = isTspin || numCleared === 4;
  let b2bBonus = 0;
  let wasB2BChain = false;
  if (numCleared > 0) {
    if (isDifficult) { if (this.b2b > 0) { b2bBonus = Math.floor(base * 0.5); wasB2BChain = true; } this.b2b++; }
    else { this.b2b = 0; }
    this.combo++;
  } else { this.combo = -1; }
  this.score += (base + b2bBonus) * this.level;
  if (this.combo > 0) this.score += 50 * this.combo * this.level;

  if (typeof Effects !== 'undefined') {
    if (this.combo > 0) { Effects.combo(this.id, this.combo); AudioManager.combo(this.combo); this.highestCombo = Math.max(this.highestCombo, this.combo); }
    if (wasB2BChain) { Effects.backToBack(this.id, this.b2b - 1); AudioManager.backToBack(); }
  }

  let isPerfectClear = false;
  if (numCleared > 0) {
    isPerfectClear = this.grid.every(row => row.every(c => c === null));
    if (isPerfectClear) {
      const pcScore = [0, 800, 1200, 1800, 2000][numCleared] || 800;
      this.score += pcScore * this.level; AudioManager.perfectClear();
    }
  }

  if (numCleared > 0) {
    let atk = baseAttack(numCleared, isTspin, isMini);
    atk += comboBonus(this.combo);
    if (isDifficult && this.b2b > 1) atk += 1;
    if (isPerfectClear) atk += 10;
    if (atk > 0) { this.pendingAttackOut = (this.pendingAttackOut || 0) + atk; this.attacksSent += atk; }

    // --- CONTROLLER RUMBLE TRIGGERED HERE (attacker feedback) ---
    // The attacker also feels a light rumble proportional to what they just
    // sent out, plus an extra pulse layered on for combo bonuses.
    vibrationManager.rumbleAttack(this.id, numCleared, numCleared === 4 && wasB2BChain);
    if (this.combo > 1) vibrationManager.rumbleCombo(this.id);
  }

  this.piecesPlaced++;
  // NOTE: level/gravityInterval are no longer computed per-player here.
  // Speed is now a shared, match-wide value driven by whichever player
  // has cleared the most lines — see MatchManager._updateSharedLevel().
  // This keeps every player's drop speed perfectly in sync, so the game
  // gets harder for the whole table at once instead of only for whoever
  // is ahead. p.lines is still tracked above for stats/scoring.

  this.tspinCandidate = null; this.lastRotationWasKick = undefined;
  this.spawnNext();
};

/**
 * receiveGarbage(amount)
 * GARBAGE RECEIVED HERE
 * Queues incoming garbage rows. The rows aren't inserted immediately —
 * `applyGarbage()` (called from the physics update) inserts them once the
 * player isn't mid-lock, which is also the moment the "impact" rumble and
 * visual flash fire (see handleGarbageTransfer / updatePlayerPhysics).
 */
Player.prototype.receiveGarbage = function (amount) {
  if (amount <= 0) return;
  this.garbageQueue.push(amount); this.pendingGarbageTotal += amount; this.garbageReceived += amount;
};
Player.prototype.applyGarbage = function () {
  if (this.garbageQueue.length === 0) return;
  let total = this.garbageQueue.reduce((a, b) => a + b, 0);
  this.garbageQueue = []; this.pendingGarbageTotal = 0;
  if (total <= 0) return;
  total = Math.min(total, ROWS);
  for (let i = 0; i < total; i++) {
    this.grid.shift();
    const hole = Math.floor(Math.random() * COLS);
    const row = new Array(COLS).fill('G'); row[hole] = null;
    this.grid.push(row);
  }
  // --- CONTROLLER RUMBLE TRIGGERED HERE (impact, once garbage actually lands) ---
  vibrationManager.rumbleGarbageImpact(this.id, total);
  AudioManager.garbageImpact();
  if (typeof Effects !== 'undefined') { Effects.garbageImpact(this.id, total); }

  // BUGFIX: shifting the stack upward (via grid.shift()/push() above) does NOT
  // move the currently-falling piece's row (px) along with it. Without this
  // fix, a piece sitting safely mid-board could suddenly "overlap" blocks
  // that just shifted up underneath it, and get incorrectly eliminated even
  // though it never actually reached the top of the board. Real Tetris-style
  // garbage pushes the falling piece up out of the way first; only if there's
  // truly no room left — even after nudging all the way up — do we top out.
  let cells = this.cellsFor(this.current, this.rotState, this.px, this.py);
  let collides = cells.some(([r, c]) => r >= 0 && this.grid[r] && this.grid[r][c]);
  if (collides) {
    let resolved = false;
    for (let tries = 1; tries <= total + 1; tries++) {
      const testPx = this.px - tries;
      const testCells = this.cellsFor(this.current, this.rotState, testPx, this.py);
      const stillBlocked = testCells.some(([r, c]) => r < 0 || (this.grid[r] && this.grid[r][c]));
      if (!stillBlocked) { this.px = testPx; resolved = true; break; }
    }
    if (!resolved) { this.topOut = true; this.alive = false; }
  }
  this.updateGhost();
};

/* ---- rendering ---- */
Player.prototype.render = function () {
  const ctx = this.ctx, CELL = this.cell;
  ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.fillStyle = '#0b0a12'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, ROWS * CELL); ctx.stroke(); }
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(COLS * CELL, r * CELL); ctx.stroke(); }

  for (let r = HIDDEN; r < TOTAL_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = this.grid[r][c];
      if (v) this.drawCell(ctx, c, r - HIDDEN, v === 'G' ? '#4a4658' : COLORS[v], v === 'G');
    }
  }

  if (this.clearFlashTimer > 0) {
    ctx.globalAlpha = this.clearFlashTimer; ctx.fillStyle = '#ffffff';
    this.clearFlashRows.forEach(r => { const vr = r - HIDDEN; if (vr >= 0) ctx.fillRect(0, vr * CELL, COLS * CELL, CELL); });
    ctx.globalAlpha = 1;
  }

  if (this.alive && this.current) {
    const ghostCells = this.cellsFor(this.current, this.rotState, this.ghostY, this.py);
    ghostCells.forEach(([r, c]) => { const vr = r - HIDDEN; if (vr >= 0) this.drawGhost(ctx, c, vr); });
    const cells = this.cellsFor(this.current, this.rotState, this.px, this.py);
    cells.forEach(([r, c]) => { const vr = r - HIDDEN; if (vr >= 0) this.drawCell(ctx, c, vr, COLORS[this.current], false, this.isLocking); });
  }

  if (!this.alive) { ctx.fillStyle = 'rgba(6,5,10,0.7)'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }

  this.renderMini(this.holdCtx, this.holdCanvas, this.holdPiece);
  this.renderNextQueue();
};
Player.prototype.drawCell = function (ctx, col, row, color, isGarbage, locking) {
  const CELL = this.cell; const x = col * CELL, y = row * CELL;
  ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  if (!isGarbage) {
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x + 1, y + 1, CELL - 2, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x + 1, y + CELL - 6, CELL - 2, 5);
  } else { ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6); }
  if (locking) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4); }
};
Player.prototype.drawGhost = function (ctx, col, row) {
  const CELL = this.cell; const x = col * CELL, y = row * CELL;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
};
Player.prototype.renderMini = function (ctx, canvas, type) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!type) return;
  const s = 14;
  const shape = SHAPES[type][0];
  let minR = 99, maxR = -99, minC = 99, maxC = -99;
  shape.forEach(([r, c]) => { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); });
  const w = (maxC - minC + 1) * s, h = (maxR - minR + 1) * s;
  const ox = (canvas.width - w) / 2, oy = (canvas.height - h) / 2;
  shape.forEach(([r, c]) => {
    const x = ox + (c - minC) * s, y = oy + (r - minR) * s;
    ctx.fillStyle = COLORS[type]; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  });
};
Player.prototype.renderNextQueue = function () {
  const ctx = this.nextCtx, canvas = this.nextCanvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const upcoming = this.bag.peek(5);
  const s = 12, slotH = canvas.height / 5;
  upcoming.forEach((type, i) => {
    const shape = SHAPES[type][0];
    let minR = 99, maxR = -99, minC = 99, maxC = -99;
    shape.forEach(([r, c]) => { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); });
    const w = (maxC - minC + 1) * s, h = (maxR - minR + 1) * s;
    const ox = (canvas.width - w) / 2, oy = i * slotH + (slotH - h) / 2;
    shape.forEach(([r, c]) => {
      const x = ox + (c - minC) * s, y = oy + (r - minR) * s;
      ctx.fillStyle = COLORS[type]; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    });
  });
};

/* =========================================================================
   LAYOUT BUILDER
   Builds the DOM for however many players are in this match (1-4),
   mirroring player 2/4 boards so controls face each other in local play.
========================================================================= */
function cellSizeFor(n) { return n <= 2 ? 24 : (n === 3 ? 19 : 16); }

function buildArena(n) {
  const arena = document.getElementById('arena');
  arena.className = 'n' + n;
  arena.innerHTML = '';
  const cell = cellSizeFor(n);
  const bw = COLS * cell, bh = ROWS * cell;
  const holdH = Math.round(bh * 0.14), nextH = Math.round(bh * 0.5);

  const refs = [];
  for (let i = 1; i <= n; i++) {
    const color = PLAYER_COLORS[i - 1];
    const reversed = (n === 2 && i === 2) || (n === 4 && (i === 2 || i === 4));
    const card = document.createElement('div');
    card.className = 'pcard';
    card.innerHTML = `
      <div class="player-tag" style="color:${color}; text-shadow:0 0 14px ${color}88;">PLAYER ${i}</div>
      <div class="playrow ${reversed ? 'rev' : ''}">
        <div class="side-panel">
          <div class="mini-box">
            <div class="mini-label">Hold</div>
            <canvas class="mini-canvas" id="holdCanvas${i}" width="80" height="${holdH}"></canvas>
          </div>
          <div class="stats-box" id="stats${i}">
            <div class="row"><span>Score</span><b id="score${i}">0</b></div>
            <div class="row"><span>Lines</span><b id="lines${i}">0</b></div>
            <div class="row"><span>Lvl</span><b id="level${i}">1</b></div>
            <div class="row"><span>PPS</span><b id="pps${i}">0.0</b></div>
          </div>
        </div>
        <div class="board-col">
          <div class="board-frame" id="frame${i}" style="box-shadow:0 0 0 1px var(--line), 0 10px 30px rgba(0,0,0,0.55);">
            <canvas class="boardCanvas" id="boardCanvas${i}" width="${bw}" height="${bh}"></canvas>
            <div class="attack-warning" id="warn${i}">INCOMING!</div>
            <div class="garbage-amount" id="garbageAmount${i}"></div>
          </div>
          <div class="b2b-combo">
            <div class="pill b2b" id="b2bPill${i}">B2B</div>
            <div class="pill combo" id="comboPill${i}">COMBO x0</div>
          </div>
        </div>
        <div class="garbage-col" id="garbageCol${i}"><div class="garbage-fill" id="garbageFill${i}" style="height:0%"></div></div>
        <div class="side-panel">
          <div class="mini-box">
            <div class="mini-label">Next</div>
            <canvas class="mini-canvas" id="nextCanvas${i}" width="80" height="${nextH}"></canvas>
          </div>
        </div>
      </div>
    `;
    arena.appendChild(card);
    const boardCanvasEl = card.querySelector('#boardCanvas' + i);
    refs.push({
      canvas: boardCanvasEl,
      holdCanvas: card.querySelector('#holdCanvas' + i),
      nextCanvas: card.querySelector('#nextCanvas' + i)
    });
    if (typeof Effects !== 'undefined') {
      Effects.registerBoard(i, card.querySelector('#frame' + i), boardCanvasEl, cell);
    }
  }
  return { refs, cell };
}

/* =========================================================================
   MATCH MANAGER
   Owns match-level state: countdown, the main requestAnimationFrame loop,
   win-condition checks, and the pause / game-over / victory overlays.
========================================================================= */
const MatchManager = {
  state: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'paused' | 'finished'
  countdownVal: 3,
  matchStartTime: 0,
  elapsed: 0,
  winnerId: null,
  playerCount: 2,
  players: [],
  assignments: [],

  // ===================== SHARED SPEED / LEVEL =====================
  // Whole-match difficulty. Every player shares the exact same gravity
  // speed at all times — it's driven by the single furthest-ahead
  // player's line count, so the whole lobby speeds up together the
  // moment ANYONE hits the next line-clear threshold. Works identically
  // whether 1, 2, 3, or 4 people are playing.
  sharedLevel: 1,
  sharedGravityInterval: 800,
  linesPerLevel: 10, // configurable via Settings -> Gameplay
  _levelForLines(lines) { 
    console.log("Lines per level: " + this.linesPerLevel);
    return 1 + Math.floor(lines / this.linesPerLevel); },
  _gravityForLevel(level) { return Math.max(60, 800 - (level - 1) * 60); }, //change first parameter to 60for faster speed increase

  _updateSharedLevel() {
    let maxLines = 0;
    for (const p of this.players) {
      if (p.lines > maxLines) maxLines = p.lines;
    }
    const newLevel = this._levelForLines(maxLines);
    if (newLevel !== this.sharedLevel) {
      const leveledUp = newLevel > this.sharedLevel;
      this.sharedLevel = newLevel;
      this.sharedGravityInterval = this._gravityForLevel(newLevel);
      if (leveledUp) this._onSharedLevelUp(newLevel);
    }
    // Apply to every player, every frame — keeps everyone locked in sync
    // even right after a reset/rematch or a mid-match join edge case.
    this.players.forEach(p => {
      p.level = newLevel;
      p.gravityInterval = this.sharedGravityInterval;
    });
  },

  /** Fires once, match-wide, the instant the shared level increases. */
  _onSharedLevelUp(newLevel) {
    const isOverdrive = newLevel % 5 === 0; // every 5th level = a bigger, louder milestone
    if (typeof Effects !== 'undefined') {
      Effects.showDramaBanner(isOverdrive ? `OVERDRIVE! LV ${newLevel}` : `LEVEL ${newLevel}!`, {
        color: isOverdrive ? '255,84,112' : '255,210,95',
        duration: isOverdrive ? 1500 : 1100,
        big: isOverdrive
      });
      Effects.flashScreen && Effects.flashScreen(isOverdrive ? '255,84,112' : '255,210,95', isOverdrive ? 0.22 : 0.12);
      if (isOverdrive) {
        document.body.classList.remove('fx-camshake'); void document.body.offsetWidth;
        document.body.classList.add('fx-camshake');
      }
    }
    if (window.AudioManager) {
      AudioManager._tone(AudioManager.buses.ui, 660, 0.12, 'square', 0.3, 1100);
      if (isOverdrive) setTimeout(() => AudioManager._tone(AudioManager.buses.ui, 880, 0.2, 'sawtooth', 0.32, 1500), 100);
    }
    // Everyone feels it — a synced pulse for the whole table, not just the leader.
    this.players.forEach(p => {
      if (p.alive) vibrationManager.rumblePlayer(p.id, isOverdrive ? RUMBLE_PROFILES.ATTACK.TETRIS : RUMBLE_PROFILES.CONTROLLER_ASSIGNED);
    });
  },

  init() {
    this.lastTime = performance.now();
    this.eliminationOrder = [];
    this.loadGameplaySettings();
    requestAnimationFrame(this.loop.bind(this));
  },

  /* =================== GAMEPLAY SETTINGS (persisted) =================== */
  loadGameplaySettings() {
    try {
      const raw = localStorage.getItem('tetrisai.gameplaySettings');
      if (raw) {
        const s = JSON.parse(raw);
        if (Number.isFinite(s.linesPerLevel)) this.linesPerLevel = this._clampLinesPerLevel(s.linesPerLevel);
      }
    } catch (e) { /* ignore corrupt settings */ }
  },

  saveGameplaySettings() {
    try {
      localStorage.setItem('tetrisai.gameplaySettings', JSON.stringify({ linesPerLevel: this.linesPerLevel }));
    } catch (e) { /* storage unavailable — ignore */ }
  },

  _clampLinesPerLevel(n) { return Math.max(3, Math.min(30, Math.round(n))); },

  /** Called from the Settings menu. Re-syncs speed immediately mid-match if needed. */
  setLinesPerLevel(n) {
    this.linesPerLevel = this._clampLinesPerLevel(n);
    this.saveGameplaySettings();
    if (this.state === 'playing') this._updateSharedLevel();
  },

  /** Called once ControllerSetup finishes with a confirmed assignment list. */
  setupPlayers(n, assignments) {
    this.playerCount = n;
    this.assignments = assignments;
    this.eliminationOrder = [];
    this.sharedLevel = 1;
    this.sharedGravityInterval = 800;
    const { refs, cell } = buildArena(n);
    this.players = [];
    vibrationManager.clearAssignments();
    for (let i = 1; i <= n; i++) {
      const assignment = assignments[i - 1];
      const p = new Player(i, refs[i - 1], assignment, cell);
      this.players.push(p);
      if (assignment.type === 'gamepad') vibrationManager.assignController(i, assignment.gamepadIndex);
    }
    updateControllerStatusUI();
  },

  /** "Change Players" from the results screen: back to the join lobby, keeping nobody pre-assigned. */
  changePlayers() {
    document.getElementById('resultsOverlay').classList.add('hidden');
    FocusNav.deactivate();
    this.state = 'waiting';
    ControllerSetup.show();
  },

  startCountdown() {
    this.state = 'countdown';
    this.countdownVal = 3;
    document.getElementById('matchState').textContent = 'GET READY';
    document.getElementById('centerMsgOverlay').classList.remove('hidden');
    this.showCenterCountdown(this.countdownVal);
    AudioManager.countdown();
    if (typeof Effects !== 'undefined') { Effects.clearWinnerSpotlight(); Effects.countdownPulse(); }
    document.body.classList.add('fx-camshake'); setTimeout(() => document.body.classList.remove('fx-camshake'), 300);
    this._cdInterval = setInterval(() => {
      this.countdownVal--;
      if (this.countdownVal > 0) {
        this.showCenterCountdown(this.countdownVal); AudioManager.countdown();
        if (typeof Effects !== 'undefined') Effects.countdownPulse();
      } else {
        this.showCenterCountdown('GO');
        AudioManager.go();
        if (typeof Effects !== 'undefined') Effects.goFlash();
        clearInterval(this._cdInterval);
        setTimeout(() => { this.beginPlay(); }, 500);
      }
    }, 800);
  },

  showCenterCountdown(val) {
    document.getElementById('centerMsgZone').innerHTML = `<div class="countdown-num">${val}</div>`;
  },

  beginPlay() {
    this.state = 'playing';
    document.getElementById('matchState').textContent = this.playerCount === 1 ? 'SOLO' : 'BATTLE';
    document.getElementById('centerMsgOverlay').classList.add('hidden');
    document.getElementById('centerMsgZone').innerHTML = '';
    this.matchStartTime = performance.now();
    this.players.forEach(p => {
      p.reset();
      vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.GAME_START);
    });
    if (typeof Effects !== 'undefined') Effects.clearAll();
    AudioManager.playMusic('gameplay');
  },

  /**
   * togglePause()
   * Pausing freezes piece movement, gravity, and score updates because
   * the main loop only advances physics/input/garbage when state==='playing'
   * (see loop() below) — the pause menu itself is just an overlay on top.
   */
  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('matchState').textContent = 'PAUSED';
      this.showPauseMenu();
      this.players.forEach(p => vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.PAUSE));
      AudioManager.pauseSound();
    } else if (this.state === 'paused') {
      this.resumeFromPause();
    }
  },

  showPauseMenu() {
    const overlay = document.getElementById('centerMsgOverlay');
    overlay.classList.remove('hidden');
    document.getElementById('centerMsgZone').innerHTML = `
      <div class="winner-card">
        <div class="winner-title">GAME PAUSED</div>
        <button class="btn primary" id="pmResumeBtn">Resume</button>
        <button class="btn" id="pmRestartBtn">Restart</button>
        <button class="btn" id="pmAudioBtn">Audio Settings</button>
        <button class="btn" id="pmControlsBtn">Controls</button>
        <button class="btn" id="pmMenuBtn">Exit to Main Menu</button>
      </div>`;
    document.getElementById('pmResumeBtn').addEventListener('click', () => this.resumeFromPause());
    document.getElementById('pmRestartBtn').addEventListener('click', () => this.restart());
    document.getElementById('pmAudioBtn').addEventListener('click', () => {
      overlay.classList.add('hidden');
      SettingsMenu.open(() => { overlay.classList.remove('hidden'); this.showPauseMenu(); });
    });
    document.getElementById('pmControlsBtn').addEventListener('click', () => {
      overlay.classList.add('hidden');
      ControlsMenu.open(() => { overlay.classList.remove('hidden'); this.showPauseMenu(); });
    });
    document.getElementById('pmMenuBtn').addEventListener('click', () => this.returnToMainMenu());
    FocusNav.push(overlay, () => this.resumeFromPause());
    document.getElementById('hintBar').classList.add('show');
  },

  resumeFromPause() {
    this.state = 'playing';
    document.getElementById('matchState').textContent = this.playerCount === 1 ? 'SOLO' : 'BATTLE';
    document.getElementById('centerMsgOverlay').classList.add('hidden');
    document.getElementById('centerMsgZone').innerHTML = '';
    this.players.forEach(p => vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.RESUME));
    AudioManager.resume(); AudioManager.resumeSound(); AudioManager.playMusic('gameplay');
    FocusNav.pop();
    document.getElementById('hintBar').classList.remove('show');
  },

  returnToMainMenu() {
    this.state = 'waiting';
    document.getElementById('centerMsgOverlay').classList.add('hidden');
    document.getElementById('centerMsgZone').innerHTML = '';
    document.getElementById('startOverlay').classList.remove('hidden');
    if (typeof Effects !== 'undefined') { Effects.clearAll(); Effects.clearWinnerSpotlight(); }
    AudioManager.playMusic('menu');
    FocusNav.deactivate();
    FocusNav.activate(document.getElementById('startOverlay'));
    document.getElementById('hintBar').classList.add('show');
  },

  /** Win-condition check: 1P mode ends on top-out; 2-4P ends when <=1 player remains alive. */
  checkEndConditions() {
    if (this.playerCount === 1) {
      if (!this.players[0].alive && this.players[0].topOut) this.endSolo();
      return;
    }
    this.players.forEach(p => { if (!p.alive && !p.eliminated) this.handleElimination(p); });
    const alive = this.players.filter(p => p.alive);
    if (alive.length <= 1) {
      const winner = alive[0] || this.players[0];
      this.endMatch(winner.id);
    }
  },

  /** Fired exactly once per player, the instant they top out in a 2-4P match. */
  handleElimination(p) {
    p.eliminated = true;
    p.eliminatedAt = performance.now();
    p.timeSurvivedMs = p.eliminatedAt - this.matchStartTime;

    const aliveBefore = this.players.filter(x => x.alive || x.id === p.id).length;
    p.placement = aliveBefore; // e.g. eliminated while 3 were still alive -> finished 3rd
    this.eliminationOrder.push(p.id);

    const frame = document.getElementById('frame' + p.id);
    if (frame) {
      frame.classList.add('eliminated');
      const tag = document.createElement('div');
      tag.className = 'eliminated-tag';
      tag.textContent = 'ELIMINATED';
      frame.appendChild(tag);
    }

    AudioManager.elimination();
    vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.GAME_OVER);
    if (typeof Effects !== 'undefined') Effects.eliminate(p.id);

    const remaining = this.players.filter(x => x.alive).length;
    if (remaining === 2) {
      this.players.filter(x => x.alive).forEach(x => {
        const f = document.getElementById('frame' + x.id);
        if (f) f.classList.add('final-glow');
      });
      if (typeof Effects !== 'undefined') Effects.showDramaBanner('FINAL SHOWDOWN', { color: '255,210,95', big: true, duration: 2200 });
      AudioManager.finalShowdown();
    } else if (remaining > 1) {
      if (typeof Effects !== 'undefined') Effects.showDramaBanner(`${remaining} PLAYERS REMAIN`, { color: '107,214,255', duration: 1500 });
    }
  },

  endSolo() {
    this.state = 'finished';
    document.getElementById('matchState').textContent = 'GAME OVER';
    const p = this.players[0];
    p.timeSurvivedMs = performance.now() - this.matchStartTime;
    p.placement = 1;
    vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.GAME_OVER);
    AudioManager.lose(); AudioManager.playMusic('gameover');
    this.showResults([p]);
  },

  endMatch(winnerId) {
    this.state = 'finished';
    this.winnerId = winnerId;
    const winner = this.players.find(p => p.id === winnerId);
    winner.placement = 1;
    winner.timeSurvivedMs = performance.now() - this.matchStartTime;
    AudioManager.victory();
    AudioManager.playMusic('victory');
    document.getElementById('matchState').textContent = 'MATCH OVER';
    const color = PLAYER_COLORS[winnerId - 1];
    vibrationManager.rumblePlayer(winnerId, RUMBLE_PROFILES.VICTORY);
    this.players.filter(p => p.id !== winnerId).forEach(p => vibrationManager.rumblePlayer(p.id, RUMBLE_PROFILES.GAME_OVER));
    if (typeof Effects !== 'undefined') {
      Effects.clearAll();
      document.querySelectorAll('.final-glow').forEach(el => el.classList.remove('final-glow'));
      const winFrame = document.getElementById('frame' + winnerId);
      Effects.victory(winFrame);
      Effects.showDramaBanner(`PLAYER ${winnerId} WINS`, { color: color.replace('#', '').match(/.{2}/g)?.map(h => parseInt(h, 16)).join(',') || '255,210,95', big: true, duration: 2000 });
    }
    // Ranking: winner first, then eliminated players in reverse elimination order (most recent loss = runner-up).
    const ranking = [winner, ...this.eliminationOrder.slice().reverse().map(id => this.players.find(p => p.id === id))];
    setTimeout(() => this.showResults(ranking), 1800);
  },

  /** Builds and shows the post-game results / rematch screen from a pre-ranked player list. */
  showResults(ranking) {
    document.getElementById('centerMsgOverlay').classList.add('hidden');
    const overlay = document.getElementById('resultsOverlay');
    const panel = document.getElementById('resultsPanel');
    const mostAttacks = Math.max(...ranking.map(p => p.attacksSent || 0));
    panel.innerHTML = ranking.map((p, i) => {
      const rank = i + 1;
      const color = PLAYER_COLORS[p.id - 1];
      const secs = Math.round((p.timeSurvivedMs || 0) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
      const badge = (p.attacksSent || 0) === mostAttacks && mostAttacks > 0 ? ' \u2605' : '';
      return `<div class="results-row ${rank === 1 ? 'winner-row' : ''}">
        <div class="rr-rank" style="color:${color};">#${rank}</div>
        <div class="rr-name" style="color:${color};">PLAYER ${p.id}${rank === 1 ? ' — WINNER' : ''}</div>
        <div class="rr-stats">
          <span>Score ${p.score}</span>
          <span>Lines ${p.lines}</span>
          <span>Sent ${p.attacksSent || 0}${badge}</span>
          <span>Received ${p.garbageReceived || 0}</span>
          <span>Best Combo ${p.highestCombo || 0}</span>
          <span>Survived ${mm}:${ss}</span>
        </div>
      </div>`;
    }).join('');
    overlay.classList.remove('hidden');
    FocusNav.deactivate();
    FocusNav.activate(overlay);
    document.getElementById('hintBar').classList.add('show');
  },

  restart() {
    document.getElementById('resultsOverlay').classList.add('hidden');
    document.getElementById('centerMsgOverlay').classList.add('hidden');
    document.getElementById('centerMsgZone').innerHTML = '';
    document.querySelectorAll('.final-glow').forEach(el => el.classList.remove('final-glow'));
    document.querySelectorAll('.eliminated-tag').forEach(el => el.remove());
    document.querySelectorAll('.board-frame.eliminated').forEach(el => el.classList.remove('eliminated'));
    this.eliminationOrder = [];
    this.players.forEach(p => { p.reset(); p.eliminated = false; p.placement = null; });
    this.sharedLevel = 1;
    this.sharedGravityInterval = 800;
    FocusNav.deactivate();
    this.startCountdown();
  },

  /**
   * Main game loop (requestAnimationFrame). Physics/input/garbage only
   * advance while state==='playing' — this is what makes Pause fully
   * freeze the match rather than just showing an overlay on top of a
   * still-running simulation.
   */
  loop(now) {
    const dt = Math.min(now - this.lastTime, 50);
    this.lastTime = now;

    if (this.state === 'playing') {
      this.elapsed = now - this.matchStartTime;
      updateTimerDisplay(this.elapsed);
      InputSystem.update(dt, this.players);
      this._updateSharedLevel();
      this.players.forEach(p => updatePlayerPhysics(p, dt));
      if (this.playerCount > 1) handleGarbageTransfer(this.players);
      this.checkEndConditions();
    }

    this._anyDanger = false;
    this.players.forEach(p => { p.render(); renderSidePanels(p); fadeEffects(p); });
    if (this.playerCount > 1) updateGarbageBars(this.players);
    updateControllerStatusUI();

    if (this.state === 'playing') {
      const track = this._anyDanger ? 'danger' : 'gameplay';
      if (AudioManager._music.track !== track) AudioManager.playMusic(track);
    }

    if (typeof Effects !== 'undefined') { Effects.update(dt); Effects.render(); }

    requestAnimationFrame(this.loop.bind(this));
  }
};

function fadeEffects(p) {
  if (p.lockFlash > 0) p.lockFlash = Math.max(0, p.lockFlash - 0.08);
  if (p.clearFlashTimer > 0) {
    p.clearFlashTimer = Math.max(0, p.clearFlashTimer - 0.12);
    if (p.clearFlashTimer === 0) p.clearFlashRows = [];
  }
}

/**
 * handleGarbageTransfer(players)
 * Routes each player's pending outgoing attack to opponent(s):
 *  - 2P: attacks cancel against each other (standard duel cancellation).
 *  - 3-4P: round-robins the attack across all other living players so
 *    repeated attacks from one player spread out rather than always
 *    hitting the same target.
 *
 * This is also where the INCOMING GARBAGE WARNING (visual + rumble) is
 * fired, immediately, before the garbage is actually inserted into the
 * target's board (insertion + impact rumble happens later in
 * applyGarbage(), once that player's board is free to accept it).
 */
function handleGarbageTransfer(players) {
  const alive = players.filter(p => p.alive);
  if (players.length === 2) {
    const [p1, p2] = players;
    let out1 = p1.pendingAttackOut || 0, out2 = p2.pendingAttackOut || 0;
    p1.pendingAttackOut = 0; p2.pendingAttackOut = 0;
    const cancel = Math.min(out1, out2);
    out1 -= cancel; out2 -= cancel;
    if (out1 > 0 && p2.alive) { p2.receiveGarbage(out1); announceIncomingGarbage(p1, p2, out1); }
    if (out2 > 0 && p1.alive) { p1.receiveGarbage(out2); announceIncomingGarbage(p2, p1, out2); }
    return;
  }
  players.forEach(p => {
    const atk = p.pendingAttackOut || 0;
    p.pendingAttackOut = 0;
    if (atk <= 0) return;
    const targets = alive.filter(t => t.id !== p.id);
    if (targets.length === 0) return;
    // round-robin so consecutive attacks from the same player spread across every rival in turn
    p.targetCursor = (p.targetCursor % targets.length);
    const target = targets[p.targetCursor];
    p.targetCursor++;
    target.receiveGarbage(atk);
    announceIncomingGarbage(p, target, atk);
  });
}

/** Visual warning + warning-rumble fired the instant garbage is queued for a target. */
function announceIncomingGarbage(source, target, amount) {
  showAttackWarning(target.id, amount);
  triggerShake(target.id);
  AudioManager.garbageWarn();
  vibrationManager.rumbleGarbageWarning(target.id);
  if (typeof Effects !== 'undefined') {
    Effects.incomingWarning(target.id);
    if (source && source.id !== target.id) Effects.attackBeam(source.id, target.id, amount);
  }
}

function showAttackWarning(playerId, amount) {
  const el = document.getElementById('warn' + playerId);
  const amountEl = document.getElementById('garbageAmount' + playerId);
  if (!el) return;
  el.classList.add('show'); clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 900);
  if (amountEl && amount) {
    amountEl.textContent = `+${amount}`;
    amountEl.classList.add('show'); clearTimeout(amountEl._t);
    amountEl._t = setTimeout(() => amountEl.classList.remove('show'), 900);
  }
}
function triggerShake(playerId) {
  const frame = document.getElementById('frame' + playerId);
  if (!frame) return;
  frame.classList.remove('shake'); void frame.offsetWidth; frame.classList.add('shake');
}
function updateTimerDisplay(ms) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  document.getElementById('matchTimer').textContent = `${m}:${s}`;
}
function updateGarbageBars(players) {
  players.forEach(p => {
    const fill = document.getElementById('garbageFill' + p.id);
    if (!fill) return;
    const pct = Math.min(100, (p.pendingGarbageTotal / 20) * 100);
    fill.style.height = pct + '%';
  });
}
function renderSidePanels(p) {
  const id = p.id;
  const scoreEl = document.getElementById('score' + id); if (!scoreEl) return;
  scoreEl.textContent = p.score.toLocaleString();
  document.getElementById('lines' + id).textContent = p.lines;
  document.getElementById('level' + id).textContent = p.level;
  const secs = (performance.now() - p.startTime) / 1000;
  const pps = p.piecesPlaced > 0 ? (p.piecesPlaced / Math.max(secs, 0.001)).toFixed(1) : '0.0';
  document.getElementById('pps' + id).textContent = pps;

  const b2bPill = document.getElementById('b2bPill' + id);
  if (p.b2b > 1) { b2bPill.classList.add('show'); b2bPill.textContent = 'B2B x' + (p.b2b - 1); }
  else b2bPill.classList.remove('show');

  const comboPill = document.getElementById('comboPill' + id);
  if (p.combo > 0) { comboPill.classList.add('show'); comboPill.textContent = 'COMBO x' + p.combo; }
  else comboPill.classList.remove('show');

  const frame = document.getElementById('frame' + id);
  let stackTop = TOTAL_ROWS;
  for (let r = HIDDEN; r < TOTAL_ROWS; r++) { if (p.grid[r].some(c => c)) { stackTop = r; break; } }
  const inDanger = (stackTop - HIDDEN) < 4;
  frame.classList.toggle('danger', inDanger);
  frame.classList.toggle('dead', !p.alive);
  frame.classList.toggle('afk', p.alive && MatchManager.state === 'playing' && (performance.now() - p.lastActionAt) > 20000);
  if (inDanger) MatchManager._anyDanger = true;
}

/* =========================================================================
   PHYSICS UPDATE
   Advances gravity + lock-delay for one player by dt milliseconds.
   Only called while MatchManager.state === 'playing', so pausing the
   match freezes all of this automatically.
========================================================================= */
function updatePlayerPhysics(p, dt) {
  if (!p.alive) return;
  // Insert queued garbage once we're not actively locking a piece down,
  // so garbage rows never appear mid-placement.
  if (p.garbageQueue.length > 0 && !p.isLocking) p.applyGarbage();
  if (!p.alive) return;

  const grounded = p.checkCollision(p.px + 1, p.py, p.rotState);
  if (grounded) {
    p.isLocking = true; p.lockTimer += dt;
    if (p.lockTimer >= p.lockDelay) { p.lockPiece(); p.isLocking = false; p.lockTimer = 0; }
  } else {
    p.isLocking = false; p.lockTimer = 0;
    p.gravityTimer += dt * (p.softDropping ? 18 : 1);
    if (p.gravityTimer >= p.gravityInterval) {
      p.gravityTimer = 0;
      if (!p.checkCollision(p.px + 1, p.py, p.rotState)) { p.px++; p.updateGhost(); }
    }
  }
}

/* =========================================================================
   INPUT SYSTEM — Keyboard, driven by each player's confirmed keyboard
   layout (KB1/KB2 from gamepadConfig.js), not hardcoded per-player.
========================================================================= */
const InputSystem = {
  keysDown: new Set(),

  init() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keysDown.add(e.code);
      this.handleImmediate(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keysDown.delete(e.code); });
  },

  handleImmediate(code) {
    // Escape always pauses/resumes regardless of which keyboard layout is in play.
    if (code === 'Escape') {
      if (MatchManager.state === 'playing' || MatchManager.state === 'paused') MatchManager.togglePause();
      return;
    }
    if (code === 'KeyR' && MatchManager.state === 'finished') { MatchManager.restart(); return; }
    if (MatchManager.state !== 'playing') return;

    MatchManager.players.forEach(p => {
      if (p.assignment.type === 'keyboard') this.handlePlayerKey(p, code);
    });
  },

  handlePlayerKey(p, code) {
    if (!p.alive) return;
    const map = KEYBOARD_MAPS[p.assignment.keyboardKey];
    let acted = false;
    if (code === map.left) { p.move(-1); p.dasDir = -1; p.dasTimer = 0; p.dasCharged = false; acted = true; }
    else if (code === map.right) { p.move(1); p.dasDir = 1; p.dasTimer = 0; p.dasCharged = false; acted = true; }
    else if (code === map.cw) { p.tryRotate(1); acted = true; }
    else if (code === map.ccw) { p.tryRotate(-1); acted = true; }
    else if (code === map.hard) { p.hardDrop(); acted = true; }
    else if (code === map.hold) { p.hold(); acted = true; }
    if (acted) p.keysPressed++;
  },

  update(dt, players) {
    players.forEach(p => {
      if (p.assignment.type === 'keyboard') this.updatePlayerContinuous(dt, p);
    });
    GamepadSystem.poll(players);
  },

  // Handles DAS (delayed auto-shift) and ARR (auto-repeat rate) for held movement keys.
  updatePlayerContinuous(dt, p) {
    if (!p.alive) return;
    const map = KEYBOARD_MAPS[p.assignment.keyboardKey];
    const leftDown = this.keysDown.has(map.left);
    const rightDown = this.keysDown.has(map.right);
    p.softDropping = this.keysDown.has(map.soft);

    let dir = 0;
    if (leftDown && !rightDown) dir = -1; else if (rightDown && !leftDown) dir = 1;

    if (dir !== 0) {
      if (p.dasDir !== dir) { p.dasDir = dir; p.dasTimer = 0; p.dasCharged = false; }
      p.dasTimer += dt;
      if (!p.dasCharged && p.dasTimer >= p.dasDelay) { p.dasCharged = true; p.move(dir); p.dasTimer = 0; }
      else if (p.dasCharged) {
        p.dasTimer += dt;
        if (p.arr <= 0) { while (p.move(dir)) { } }
        else if (p.dasTimer >= p.arr) { p.move(dir); p.dasTimer = 0; }
      }
    } else { p.dasDir = 0; p.dasTimer = 0; p.dasCharged = false; }
  }
};

/* =========================================================================
   GAMEPAD SYSTEM
   Reads button/axis state only from the physical gamepad index that was
   explicitly confirmed for a player during ControllerSetup — never from
   an assumed browser slot. Button roles come from CONTROLLER_PROFILES
   (see gamepadConfig.js), selected per-player via `profileKey`.
========================================================================= */
const GamepadSystem = {
  prevButtons: {},
  prevLeftStickUp: {},

  padDasTimer: {},
  padDasDir: {},
  padDasCharged: {},

  poll(players) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];

    players.forEach(p => {
      if (p.assignment.type !== 'gamepad') return;

      const pad = pads[p.assignment.gamepadIndex];
      if (pad) this.pollPad(pad, p);
    });
  },

  pollPad(pad, p) {
    const profile =
      CONTROLLER_PROFILES[p.assignment.profileKey] ||
      CONTROLLER_PROFILES.GENERIC;

    const idx = p.id;

    const buttons = pad.buttons.map(b => b.pressed);
    const prev = this.prevButtons[idx] || [];

    const justPressed = (i) => buttons[i] && !prev[i];
    // PAUSE
    if (justPressed(profile.PAUSE)) {
      if (
        MatchManager.state === "playing" ||
        MatchManager.state === "paused"
      ) {
        MatchManager.togglePause();
      }
    }

    if (!p.alive || MatchManager.state !== "playing") {
      this.prevButtons[idx] = buttons;
      return;
    }

    // ROTATION
    if (justPressed(profile.ROTATE_CW)) p.tryRotate(1);
    if (justPressed(profile.ROTATE_CCW)) p.tryRotate(-1);

    // HOLD
    if (profile.HOLD.some(btn => justPressed(btn))) {
      p.hold();
    }

    // ======================================================
    // STICK INPUTS
    // Left Stick Up    = Hard Drop
    // Left Stick Down  = Soft Drop
    // ======================================================

    const SOFT_DROP_STICK_THRESHOLD = 0.7;
    const HARD_DROP_STICK_THRESHOLD = 0.9;

    // Hard Drop Button (D-Pad Up)
    const hardDropButtons = Array.isArray(profile.HARD_DROP)
      ? profile.HARD_DROP
      : [profile.HARD_DROP];

    const hardDropButtonPressed = hardDropButtons.some(btn =>
        justPressed(btn)
    );
 
    // Left Stick Y
    const leftStickY =
        pad.axes[profile.LEFT_STICK_Y ?? 1] || 0;

    // HARD DROP (Left Stick Up)
    const stickUp =
        leftStickY < -HARD_DROP_STICK_THRESHOLD;

    if (
        hardDropButtonPressed ||
        (stickUp && !this.prevLeftStickUp[idx])
    ) {
        p.hardDrop();
    }

    this.prevLeftStickUp[idx] = stickUp;

    // SOFT DROP (Left Stick Down)
    p.softDropping =
        profile.SOFT_DROP_BTNS.some(
            bi => pad.buttons[bi] && pad.buttons[bi].value > 0.3
        ) ||
        leftStickY > SOFT_DROP_STICK_THRESHOLD;
    // MOVEMENT
    const axisX = pad.axes[0] || 0;

    let dir = 0;

    if (
      buttons[profile.LEFT] ||
      axisX < -STICK_DEADZONE
    ) {
      dir = -1;
    } else if (
      buttons[profile.RIGHT] ||
      axisX > STICK_DEADZONE
    ) {
      dir = 1;
    }

    if (this.padDasDir[idx] === undefined) {
      this.padDasDir[idx] = 0;
      this.padDasTimer[idx] = 0;
      this.padDasCharged[idx] = false;
    }

    if (dir !== 0) {
      if (this.padDasDir[idx] !== dir) {
        this.padDasDir[idx] = dir;
        this.padDasTimer[idx] = 0;
        this.padDasCharged[idx] = false;

        p.move(dir);
      }

      this.padDasTimer[idx] += 16;

      if (
        !this.padDasCharged[idx] &&
        // this.padDasTimer[idx] >= 133
        this.padDasTimer[idx] >= 200
      ) {
        this.padDasCharged[idx] = true;
        p.move(dir);
        this.padDasTimer[idx] = 0;
      } else if (
        this.padDasCharged[idx] &&
        this.padDasTimer[idx] >= 40
      ) {
        p.move(dir);
        this.padDasTimer[idx] = 0;
      }
    } else {
      this.padDasDir[idx] = 0;
      this.padDasTimer[idx] = 0;
      this.padDasCharged[idx] = false;
    }

    this.prevButtons[idx] = buttons;
  }
};

/** Shows each player's confirmed input source (keyboard layout or gamepad + connection state) in the top bar. */
function updateControllerStatusUI() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const el = document.getElementById('controllerStatus');
  if (!el) return;
  const parts = MatchManager.players.map(p => {
    if (p.assignment.type === 'keyboard') {
      return `<span class="on">P${p.id}: ${KEYBOARD_MAPS[p.assignment.keyboardKey].label}</span>`;
    }
    const connected = !!pads[p.assignment.gamepadIndex];
    return `<span class="${connected ? 'on' : ''}">P${p.id}: ${p.assignment.label}${connected ? '' : ' (disconnected)'}</span>`;
  });
  el.innerHTML = parts.join('');
}

// Controller connect/disconnect toast — helps players notice a dropped pad mid-lobby or mid-match
// instead of silently losing input, and confirms when a replacement pad is recognized.
function showControllerToast(text, kind) {
  const el = document.getElementById('controllerToast');
  if (!el) return;
  el.textContent = text;
  el.className = 'controller-toast ' + (kind || '');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.className = 'controller-toast hidden'; }, 3200);
}
window.addEventListener('gamepadconnected', (e) => {
  showControllerToast(`Controller connected: ${e.gamepad.id}`, 'ok');
  if (window.AudioManager && AudioManager.ctx) AudioManager.controllerReconnect();
});
window.addEventListener('gamepaddisconnected', (e) => {
  const assignedTo = MatchManager.players.find(p => p.assignment.type === 'gamepad' && p.assignment.gamepadIndex === e.gamepad.index);
  showControllerToast(assignedTo ? `Player ${assignedTo.id}'s controller disconnected` : 'Controller disconnected', 'warn');
  if (window.AudioManager && AudioManager.ctx) AudioManager.controllerWarn();
});

/* =========================================================================
   BOOT
   Wires the Join Lobby (ControllerSetup) to MatchManager. Gameplay only
   begins once ControllerSetup.finish() hands back a confirmed roster.
========================================================================= */
document.getElementById('muteBtn').addEventListener('click', (e) => {
  AudioManager.setMuted(!AudioManager.muted);
  e.target.textContent = AudioManager.muted ? '🔇' : '🔊';
});
document.getElementById('pauseBtn').addEventListener('click', () => {
  if (MatchManager.state === 'playing' || MatchManager.state === 'paused') MatchManager.togglePause();
});

document.getElementById('openSetupBtn').addEventListener('click', () => {
  AudioManager.init(); AudioManager.resume();
  document.getElementById('muteBtn').textContent = AudioManager.muted ? '🔇' : '🔊';
  document.getElementById('startOverlay').classList.add('hidden');
  FocusNav.deactivate();
  ControllerSetup.show();
});

const settingsGearBtn = document.getElementById('openSettingsBtn');
if (settingsGearBtn) {
  settingsGearBtn.addEventListener('click', () => {
    AudioManager.init(); AudioManager.resume();
    SettingsMenu.open();
  });
}

document.getElementById('resRematchBtn').addEventListener('click', () => MatchManager.restart());
document.getElementById('resChangePlayersBtn').addEventListener('click', () => MatchManager.changePlayers());
document.getElementById('resMenuBtn').addEventListener('click', () => {
  document.getElementById('resultsOverlay').classList.add('hidden');
  MatchManager.returnToMainMenu();
});

ControllerSetup.init((playerCount, assignments) => {
  MatchManager.setupPlayers(playerCount, assignments);
  MatchManager.startCountdown();
});

// Build a placeholder arena behind the start overlay before any match begins.
buildArena(2);

if (typeof Effects !== 'undefined') Effects.init();
InputSystem.init();
MatchManager.init();
FocusNav.activate(document.getElementById('startOverlay'));
document.getElementById('hintBar').classList.add('show');
