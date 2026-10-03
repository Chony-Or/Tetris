/**
 * items.js
 * =====================================================================
 * ITEMS & POWER-UPS MODE — TIERED HIERARCHY (opt-in, off by default)
 * ---------------------------------------------------------------------
 * A self-contained module. game.js calls into it at a few guarded points
 * (all `typeof ItemsSystem !== 'undefined'`), so the game runs fine with
 * this file removed.
 *
 *   Player.reset()          -> ItemsSystem.resetPlayerState(id)
 *   Player.lockPiece()      -> ItemsSystem.onLineClear(player, info)
 *   Player.receiveGarbage() -> ItemsSystem.consumeShieldIfActive(player)
 *   Player.move()           -> ItemsSystem.interceptMove(player, dir)   [picker cursor]
 *   updatePlayerPhysics()   -> ItemsSystem.gravityMultiplier(player)
 *   MatchManager.loop()     -> ItemsSystem.update(dt, players)
 *   MatchManager.setupPlayers() -> ItemsSystem.init(players, enabled)
 *   MatchManager.beginPlay()/restart() -> ItemsSystem.resetMatch(players)
 *   Item button (keyboard/gamepad) -> ItemsSystem.tryUse(player)
 *
 * =====================================================================
 * HOW THE HIERARCHY WORKS  (read this first)
 * ---------------------------------------------------------------------
 * Every power-up has a `tier` (1, 2 or 3). Rows cleared in ONE lock
 * decide what you can win:
 *
 *   rows cleared | what happens
 *   -------------+---------------------------------------------------
 *        1       | roll on DROP_TABLES[1]  -> tier 1 only
 *        2       | roll on DROP_TABLES[2]  -> tier 1 + tier 2 (tier 2 favored)
 *        3       | roll on DROP_TABLES[3]  -> tier 1 + 2 + 3 (tier 3 favored)
 *        4       | NO roll. Invincibility for INVINCIBILITY_MS (10s) and a
 *                | picker opens: choose ANY power-up, used immediately.
 *
 * A roll is two steps:
 *   STEP 1 (tier):  DROP_TABLES[rows] gives a percentage per tier, e.g.
 *                   3 rows -> { 1: 15, 2: 30, 3: 55 }. Percentages are
 *                   ratios — they don't have to add to 100, they're
 *                   normalised. Tiers with no items are skipped.
 *   STEP 2 (item):  inside the chosen tier, each item is picked by its
 *                   own `weight` (default 1 = equal odds).
 *
 * So the final chance of an item = P(tier) x (item weight / tier weight sum).
 * Use ItemsSystem.describeOdds(rows) in the console to print the exact
 * odds for any clear size.
 *
 * ADD / REMOVE A POWER-UP:
 *   1. Add an entry to ITEM_DEFS (set `tier`, `kind`, `weight`).
 *   2. If it needs custom logic, add a handler to ITEM_EFFECTS under the
 *      same id. That's it — pools, odds, picker and UI are all generated.
 *   To remove one: delete its ITEM_DEFS entry (the ITEM_EFFECTS handler
 *   is then ignored).
 *
 * FAIRNESS: every player — human, bot, keyboard, gamepad — rolls on the
 * same tables. One held item max. Offensive items auto-target the match
 * leader (most lines). Shield blocks the next attack. Invincibility
 * blocks ALL garbage and offensive items while it lasts (it isn't consumed).
 * =====================================================================
 */
"use strict";

/* ====================================================================
   ★ TUNING PANEL — everything you'd want to tweak is in this block ★
   ==================================================================== */
const ITEM_CONFIG = {
  // Step 1: percentage chance of each TIER, by rows cleared at once.
  // Keys of the inner objects are tiers. Values are ratios (auto-normalised).
  DROP_TABLES: {
    1: { 1: 100 },
    2: { 1: 30, 2: 70 },
    3: { 1: 15, 2: 30, 3: 55 }
  },

  // Clearing this many rows (or more) grants invincibility + the picker
  // instead of a random roll.
  INVINCIBILITY_ROWS: 4,
  INVINCIBILITY_MS: 10000,

  // Picker controls: LEFT/RIGHT (keyboard, D-Pad, stick) move the cursor,
  // the ITEM button uses the highlighted power-up.
  PICKER_CURSOR_REPEAT_MS: 140, // throttle so held DAS doesn't spin the cursor

  // Blast item
  BLAST_RADIUS: 3,        // cells, Euclidean distance from the blast centre
  BLAST_INNER_MARGIN: 2,  // blast centre must be this many columns in from each wall
  BLAST_APPLY_GRAVITY: false, // true = blocks above the hole fall down afterwards

  BOT_USE_DELAY_MS: 650
};

/* ====================================================================
   POWER-UP CATALOG
   --------------------------------------------------------------------
   id, label, icon, color ("r,g,b")
   tier    1|2|3   which clear size first unlocks it
   weight  number  odds *inside its tier* (default 1)
   kind    'self' | 'offense'   (offense auto-targets the leader)
   Any extra field (amount, duration...) is read by that item's handler.
   ==================================================================== */
const ITEM_DEFS = {
  /* ---------------- TIER 1 (unlocked by 1 row) ---------------- */
  SLOWMO: {
    id: 'SLOWMO', label: 'Slow-Mo', icon: '🐌', kind: 'self', color: '196,107,255',
    tier: 1, weight: 1, duration: 6000, gravityMult: 1.9, desc: 'Your gravity slows down for 6s.'
  },
  FOG: {
    id: 'FOG', label: 'Fog', icon: '🌫️', kind: 'offense', color: '190,190,205',
    tier: 1, weight: 1, duration: 5000, desc: "Clouds the leader's board for 5s."
  },
  ROW_ERASE: {
    id: 'ROW_ERASE', label: 'Row Erase', icon: '🧽', kind: 'self', color: '120,220,170',
    tier: 1, weight: 1, rows: 1, desc: 'Removes the bottom row of your own board.'
  },

  /* ---------------- TIER 2 (unlocked by 2 rows) ---------------- */
  SHIELD: {
    id: 'SHIELD', label: 'Shield', icon: '🛡️', kind: 'self', color: '107,214,255',
    tier: 2, weight: 1, desc: 'Blocks the next attack aimed at you.'
  },
  GARBAGE_PLUS: {
    id: 'GARBAGE_PLUS', label: 'Garbage+', icon: '💥', kind: 'offense', color: '255,84,112',
    tier: 2, weight: 1, amount: 2, desc: 'Sends 2 bonus garbage lines to the leader.'
  },
  CLEAR_COLUMN: {
    id: 'CLEAR_COLUMN', label: 'Clear Column', icon: '🧹', kind: 'offense', color: '95,255,143',
    tier: 2, weight: 1, desc: "Wipes the leader's single tallest column."
  },
  HEAVY: {
    id: 'HEAVY', label: 'Heavy Piece', icon: '⚓', kind: 'offense', color: '255,157,61',
    tier: 2, weight: 1, duration: 5000, gravityMult: 0.4, desc: "Speeds up the leader's gravity for 5s."
  },

  /* ---------------- TIER 3 (unlocked by 3 rows) ---------------- */
  BLAST: {
    id: 'BLAST', label: 'Blast', icon: '🧨', kind: 'offense', color: '255,120,40',
    tier: 3, weight: 1, desc: "Blows up the leader's inner blocks within a 3-block radius."
  },
  GARBAGE_MEGA: {
    id: 'GARBAGE_MEGA', label: 'Garbage++', icon: '☄️', kind: 'offense', color: '255,60,90',
    tier: 3, weight: 1, amount: 4, desc: 'Sends 4 bonus garbage lines to the leader.'
  },
  MEGA_ERASE: {
    id: 'MEGA_ERASE', label: 'Mega Erase', icon: '🌊', kind: 'self', color: '90,200,255',
    tier: 3, weight: 1, rows: 3, desc: 'Removes the bottom 3 rows of your own board.'
  }
};

/** Helpers derived from the catalog — never edit by hand. */
const ItemCatalog = {
  ids() { return Object.keys(ITEM_DEFS); },
  inTier(t) { return this.ids().filter(id => ITEM_DEFS[id].tier === t); },
  tiers() { return [...new Set(this.ids().map(id => ITEM_DEFS[id].tier))].sort(); }
};

/* ====================================================================
   POWER-UP EFFECTS
   --------------------------------------------------------------------
   One handler per item id. Signature: (ctx) where
     ctx = { sys, source, target, st, def }
   `target` is the leader for offense items and the user for self items;
   `st` is the target's ItemsSystem state. Add a handler here when you
   add a new ITEM_DEFS entry that needs custom behaviour.
   ==================================================================== */
const ITEM_EFFECTS = {
  SHIELD({ sys, target, st, def }) {
    st.shield = true;
    sys._pulseFrame(target.id, def.color, 'item-shield-glow');
  },
  SLOWMO({ sys, target, st, def }) {
    st.slowUntil = performance.now() + def.duration; st.slowMult = def.gravityMult;
    sys._pulseFrame(target.id, def.color, 'item-selfuse-flash');
  },
  ROW_ERASE(ctx) { ctx.sys._eraseBottomRows(ctx.target, ctx.def.rows || 1, ctx.def); },
  MEGA_ERASE(ctx) { ctx.sys._eraseBottomRows(ctx.target, ctx.def.rows || 3, ctx.def); },

  GARBAGE_PLUS({ target, def }) { target.receiveGarbage(def.amount); },
  GARBAGE_MEGA({ target, def }) { target.receiveGarbage(def.amount); },
  CLEAR_COLUMN({ sys, target }) {
    const col = sys._tallestColumn(target);
    if (col === -1) return;
    for (let r = HIDDEN; r < TOTAL_ROWS; r++) target.grid[r][col] = null;
    target.updateGhost();
  },
  FOG({ sys, target, st, def }) {
    st.fogUntil = performance.now() + def.duration;
    sys._showFog(target.id, true);
  },
  HEAVY({ target, st, def }) {
    st.heavyUntil = performance.now() + def.duration; st.heavyMult = def.gravityMult;
  },
  BLAST({ sys, target, def }) { sys._blast(target, def); }
};

const ItemsSystem = {
  enabled: false,
  ACQUIRE_CHANCE: 0.75,   // chance a qualifying (1-3 row) clear actually awards an item
  LINES_TO_QUALIFY: 1,    // minimum rows cleared before items can drop at all
  SETTINGS_KEY: 'tetrisai.itemSettings.v2', // v2: old saved "lines" value had different meaning
  state: {}, // playerId -> see resetPlayerState()
  _styleInjected: false,

  /* =================== LIFECYCLE =================== */
  init(players, enabled) {
    this.loadSettings();
    this.enabled = !!enabled;
    this._injectStyle();
    players.forEach(p => {
      this.resetPlayerState(p.id);
      const box = document.getElementById('itemBox' + p.id);
      if (box) box.classList.toggle('hidden', !this.enabled);
      this._renderSlot(p.id);
      this._updateBadges(p.id);
    });
  },

  resetMatch(players) {
    players.forEach(p => {
      this._removePickerDom(p.id);
      this.resetPlayerState(p.id);
      this._renderSlot(p.id);
      this._updateBadges(p.id);
      this._showFog(p.id, false);
      const frame = document.getElementById('frame' + p.id);
      if (frame) frame.classList.remove('item-shield-glow', 'item-invincible');
    });
  },

  resetPlayerState(playerId) {
    this.state[playerId] = {
      held: null, shield: false,
      invincibleUntil: 0,
      picker: null,            // { index, startedAt, endsAt, lastMoveAt } while the 4-row picker is open
      slowUntil: 0, heavyUntil: 0, fogUntil: 0, slowMult: 1, heavyMult: 1,
      _fogShown: false, _botTimer: 0
    };
  },

  /* =================== SETTINGS =================== */
  loadSettings() {
    try {
      const raw = localStorage.getItem(this.SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (Number.isFinite(s.acquireChance)) this.ACQUIRE_CHANCE = this._clampAcquireChance(s.acquireChance) / 100;
      if (Number.isFinite(s.linesToQualify)) this.LINES_TO_QUALIFY = this._clampLinesToQualify(s.linesToQualify);
    } catch (e) { /* ignore unavailable or corrupt settings */ }
  },
  setAcquireChance(percent) { this.ACQUIRE_CHANCE = this._clampAcquireChance(percent) / 100; this._saveSettings(); },
  setLinesToQualify(lines) { this.LINES_TO_QUALIFY = this._clampLinesToQualify(lines); this._saveSettings(); },
  _saveSettings() {
    try {
      localStorage.setItem(this.SETTINGS_KEY, JSON.stringify({
        acquireChance: Math.round(this.ACQUIRE_CHANCE * 100), linesToQualify: this.LINES_TO_QUALIFY
      }));
    } catch (e) { /* keep in-memory value */ }
  },
  _clampAcquireChance(p) { return Math.max(0, Math.min(100, Math.round(p))); },
  _clampLinesToQualify(n) { return Math.max(1, Math.min(4, Math.round(n))); },

  /* =================== PROBABILITY ENGINE =================== */
  /** Normalised tier distribution for a clear size: [{tier, p}] with p summing to 1. Empty tiers are dropped. */
  _tierDistribution(rows) {
    const tables = ITEM_CONFIG.DROP_TABLES;
    // Use the exact table, else the largest defined table not above `rows`.
    let key = rows;
    if (!tables[key]) {
      const keys = Object.keys(tables).map(Number).filter(k => k <= rows).sort((a, b) => b - a);
      key = keys.length ? keys[0] : null;
    }
    if (key === null) return [];
    const entries = Object.entries(tables[key])
      .map(([tier, w]) => ({ tier: Number(tier), w: Math.max(0, Number(w) || 0) }))
      .filter(e => e.w > 0 && ItemCatalog.inTier(e.tier).length > 0);
    const total = entries.reduce((a, e) => a + e.w, 0);
    return total > 0 ? entries.map(e => ({ tier: e.tier, p: e.w / total })) : [];
  },

  _weightedPick(list, weightOf) {
    const total = list.reduce((a, x) => a + weightOf(x), 0);
    if (total <= 0) return null;
    let roll = Math.random() * total;
    for (const x of list) { roll -= weightOf(x); if (roll < 0) return x; }
    return list[list.length - 1];
  },

  /** Roll a power-up id for a 1-3 row clear. Step 1: pick tier. Step 2: pick item in that tier. */
  rollItem(rows) {
    const tier = this._weightedPick(this._tierDistribution(rows), t => t.p);
    if (!tier) return null;
    const id = this._weightedPick(ItemCatalog.inTier(tier.tier), id => ITEM_DEFS[id].weight ?? 1);
    return id;
  },

  /** Exact odds for a clear size, e.g. ItemsSystem.describeOdds(3) in the dev console. */
  oddsFor(rows) {
    const out = [];
    this._tierDistribution(rows).forEach(({ tier, p }) => {
      const ids = ItemCatalog.inTier(tier);
      const sum = ids.reduce((a, id) => a + (ITEM_DEFS[id].weight ?? 1), 0);
      ids.forEach(id => out.push({ item: ITEM_DEFS[id].label, tier, chance: +(p * (ITEM_DEFS[id].weight ?? 1) / sum * 100).toFixed(1) + '%' }));
    });
    return out;
  },
  describeOdds(rows) { console.table(this.oddsFor(rows)); },

  /* =================== ACQUISITION =================== */
  onLineClear(player, info) {
    if (!this.enabled) return;
    const st = this.state[player.id];
    if (!st) return;
    const rows = info.numCleared;

    // 4+ rows: invincibility + free pick (no random roll)
    if (rows >= ITEM_CONFIG.INVINCIBILITY_ROWS) { this._startInvincibility(player); return; }

    if (rows < this.LINES_TO_QUALIFY) return;
    if (st.held) { this._flashWasted(player.id); return; } // no stockpiling
    if (Math.random() >= this.ACQUIRE_CHANCE) return;
    const itemId = this.rollItem(rows);
    if (itemId) this.grantItem(player, itemId);
  },

  grantItem(player, itemId) {
    const st = this.state[player.id];
    if (!st || !ITEM_DEFS[itemId]) return;
    st.held = itemId;
    this._renderSlot(player.id, true);
    if (typeof AudioManager !== 'undefined') AudioManager.itemPickup();
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemPickup(player.id);
  },

  /* =================== INVINCIBILITY + PICKER (4-row clear) =================== */
  _startInvincibility(player) {
    const st = this.state[player.id];
    const now = performance.now();
    const ms = ITEM_CONFIG.INVINCIBILITY_MS;
    st.invincibleUntil = now + ms;
    st.picker = { index: 0, startedAt: now, endsAt: now + ms, lastMoveAt: 0 };
    const frame = document.getElementById('frame' + player.id);
    if (frame) frame.classList.add('item-invincible');
    this._renderPicker(player.id);
    this._updateBadges(player.id);
    if (typeof AudioManager !== 'undefined') AudioManager.itemPickup();
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemReceived(player.id);
    if (typeof Effects !== 'undefined' && Effects.showDramaBanner) {
      Effects.showDramaBanner(`P${player.id} INVINCIBLE — PICK A POWER-UP`, { color: '255,210,95', duration: 1400 });
    }
  },

  isInvincible(player) {
    const st = this.state[player.id];
    return !!st && st.invincibleUntil > performance.now();
  },

  /** Ordered list shown in the picker: tier 1 -> 3, catalog order inside a tier. */
  _pickerList() { return ItemCatalog.tiers().flatMap(t => ItemCatalog.inTier(t)); },

  /** Called from Player.move(): while the picker is open, LEFT/RIGHT move the cursor instead of the piece. */
  interceptMove(player, dir) {
    const st = this.state[player.id];
    if (!this.enabled || !st || !st.picker) return false;
    const now = performance.now();
    if (now - st.picker.lastMoveAt >= ITEM_CONFIG.PICKER_CURSOR_REPEAT_MS) {
      st.picker.lastMoveAt = now;
      const n = this._pickerList().length;
      st.picker.index = (st.picker.index + dir + n) % n;
      this._renderPicker(player.id);
      if (typeof AudioManager !== 'undefined') AudioManager.navMove();
    }
    return true; // swallow the move either way
  },

  _closePicker(playerId) {
    const st = this.state[playerId];
    if (st) st.picker = null;
    this._removePickerDom(playerId);
  },

  /* =================== USE =================== */
  tryUse(player) {
    if (!this.enabled || !player.alive) return;
    const st = this.state[player.id];
    if (!st) return;

    // Picker open: the item button uses the highlighted power-up (any power-up allowed).
    if (st.picker) {
      const id = this._pickerList()[st.picker.index];
      this._closePicker(player.id);
      if (id) this._fire(player, ITEM_DEFS[id]);
      return;
    }

    if (!st.held) return;
    const def = ITEM_DEFS[st.held];
    st.held = null;
    this._renderSlot(player.id);
    if (def) this._fire(player, def);
  },

  _fire(player, def) {
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemUse(player.id);
    if (def.kind === 'self') {
      this._runEffect(def, player, player);
      this._burstIcon(player.id, def);
      if (typeof AudioManager !== 'undefined') AudioManager.itemUseSelf();
    } else {
      const target = this._pickLeaderTarget(player);
      if (!target) return;
      this.applyOffense(player, target, def);
      if (typeof AudioManager !== 'undefined') AudioManager.itemUseOffense();
    }
    this._updateBadges(player.id);
  },

  _runEffect(def, source, target) {
    const fn = ITEM_EFFECTS[def.id];
    if (!fn) { console.warn('[items] no ITEM_EFFECTS handler for', def.id); return; }
    fn({ sys: this, source, target, st: this.state[target.id], def });
    this._updateBadges(target.id);
  },

  /** Auto-target: the living opponent with the most lines (ties -> higher score). */
  _pickLeaderTarget(player) {
    if (typeof MatchManager === 'undefined') return null;
    const opponents = MatchManager.players.filter(p => p.alive && p.id !== player.id);
    if (opponents.length === 0) return null;
    return opponents.reduce((best, p) =>
      (p.lines > best.lines || (p.lines === best.lines && p.score > best.score)) ? p : best);
  },

  applyOffense(source, target, def) {
    const tgtState = this.state[target.id];
    // Invincibility: blocked, NOT consumed.
    if (this.isInvincible(target)) { this._blocked(target.id); this._animateFire(source.id, target.id, def, true); return; }
    // Shield: blocked, consumed.
    if (tgtState && tgtState.shield) {
      tgtState.shield = false;
      this._updateBadges(target.id);
      this._blocked(target.id);
      this._animateFire(source.id, target.id, def, true);
      return;
    }
    this._runEffect(def, source, target);
    this._animateFire(source.id, target.id, def, false);
    if (typeof AudioManager !== 'undefined') AudioManager.itemReceived();
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemReceived(target.id);
    if (typeof Effects !== 'undefined' && Effects.showDramaBanner) {
      Effects.showDramaBanner(`P${target.id} HIT BY ${def.label.toUpperCase()}`, { color: def.color, duration: 1100 });
    }
  },

  _blocked(playerId) {
    this._animateBlock(playerId);
    if (typeof AudioManager !== 'undefined') AudioManager.itemBlocked();
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemBlocked(playerId);
  },

  /** Called from Player.receiveGarbage() — true means the garbage was absorbed. */
  consumeShieldIfActive(player) {
    const st = this.state[player.id];
    if (!st) return false;
    if (this.isInvincible(player)) { this._blocked(player.id); return true; } // not consumed
    if (st.shield) {
      st.shield = false;
      this._updateBadges(player.id);
      this._blocked(player.id);
      return true;
    }
    return false;
  },

  gravityMultiplier(player) {
    const st = this.state[player.id];
    if (!st) return 1;
    const now = performance.now();
    let m = 1;
    if (st.slowUntil > now) m *= st.slowMult;
    if (st.heavyUntil > now) m *= st.heavyMult;
    return m;
  },

  /* =================== BOARD EFFECT HELPERS =================== */
  _tallestColumn(player) {
    let bestCol = -1, bestRow = TOTAL_ROWS;
    for (let c = 0; c < COLS; c++) {
      for (let r = HIDDEN; r < TOTAL_ROWS; r++) {
        if (player.grid[r][c]) { if (r < bestRow) { bestRow = r; bestCol = c; } break; }
      }
    }
    return bestCol;
  },

  /** Remove the bottom `n` rows of a board; everything above drops down. */
  _eraseBottomRows(player, n, def) {
    for (let i = 0; i < n; i++) { player.grid.pop(); player.grid.unshift(new Array(COLS).fill(null)); }
    player.updateGhost();
    this._pulseFrame(player.id, def.color, 'item-selfuse-flash');
  },

  /**
   * BLAST: find the densest spot among the INNER columns, then delete every
   * block within BLAST_RADIUS cells (Euclidean) of it.
   */
  _blastCenter(target) {
    const R = ITEM_CONFIG.BLAST_RADIUS, m = ITEM_CONFIG.BLAST_INNER_MARGIN;
    let best = null, bestCount = 0;
    for (let c = m; c < COLS - m; c++) {
      for (let r = HIDDEN; r < TOTAL_ROWS; r++) {
        let n = 0;
        for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
          if (dr * dr + dc * dc > R * R) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= HIDDEN && rr < TOTAL_ROWS && cc >= 0 && cc < COLS && target.grid[rr][cc]) n++;
        }
        if (n > bestCount) { bestCount = n; best = { r, c }; }
      }
    }
    return best;
  },

  _blast(target, def) {
    const center = this._blastCenter(target);
    if (!center) return; // empty board: nothing to blow up
    const R = ITEM_CONFIG.BLAST_RADIUS;
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      if (dr * dr + dc * dc > R * R) continue;
      const rr = center.r + dr, cc = center.c + dc;
      if (rr >= HIDDEN && rr < TOTAL_ROWS && cc >= 0 && cc < COLS) target.grid[rr][cc] = null;
    }
    if (ITEM_CONFIG.BLAST_APPLY_GRAVITY) {
      for (let c = 0; c < COLS; c++) {
        const col = [];
        for (let r = TOTAL_ROWS - 1; r >= 0; r--) if (target.grid[r][c]) col.push(target.grid[r][c]);
        for (let r = TOTAL_ROWS - 1, i = 0; r >= 0; r--, i++) target.grid[r][c] = col[i] || null;
      }
    }
    target.updateGhost();
    this._animateBlast(target.id, center, def);
  },

  /* =================== PER-FRAME TICK =================== */
  update(dt, players) {
    if (!this.enabled) return;
    const now = performance.now();
    players.forEach(p => {
      const st = this.state[p.id];
      if (!st) return;

      if (st._fogShown && st.fogUntil <= now) this._showFog(p.id, false);

      // Picker / invincibility lifecycle
      if (st.picker && (!p.alive || now >= st.picker.endsAt)) this._closePicker(p.id);
      if (st.picker) this._updatePickerBar(p.id);
      if (st.invincibleUntil && st.invincibleUntil <= now) {
        st.invincibleUntil = 0;
        const frame = document.getElementById('frame' + p.id);
        if (frame) frame.classList.remove('item-invincible');
      }
      this._updateBadges(p.id);

      // Bots: picker -> choose, otherwise use held item, after a consistent reaction delay.
      const isBot = p.assignment && p.assignment.type === 'bot' && p.alive;
      if (isBot && (st.picker || st.held)) {
        st._botTimer += dt;
        if (st._botTimer >= ITEM_CONFIG.BOT_USE_DELAY_MS) {
          st._botTimer = 0;
          if (st.picker) st.picker.index = Math.max(0, this._pickerList().indexOf(this._botChoose(p)));
          this.tryUse(p);
        }
      } else st._botTimer = 0;
    });
  },

  /** Bot picker heuristic: stack tall -> heal; otherwise hit the leader with the strongest attack. */
  _botChoose(p) {
    let top = TOTAL_ROWS;
    for (let r = HIDDEN; r < TOTAL_ROWS; r++) if (p.grid[r].some(c => c)) { top = r; break; }
    const stackHeight = TOTAL_ROWS - top;
    const prefer = stackHeight >= 12 ? ['MEGA_ERASE', 'ROW_ERASE', 'SHIELD'] : ['BLAST', 'GARBAGE_MEGA', 'GARBAGE_PLUS', 'CLEAR_COLUMN'];
    const found = prefer.find(id => ITEM_DEFS[id]);
    return found || this._pickerList()[0];
  },

  /* =================== UI: SLOT / BADGES =================== */
  _renderSlot(playerId, justFilled) {
    const icon = document.getElementById('itemIcon' + playerId);
    const slot = document.getElementById('itemSlot' + playerId);
    if (!icon || !slot) return;
    const st = this.state[playerId];
    const def = st && st.held ? ITEM_DEFS[st.held] : null;
    icon.textContent = def ? def.icon : '';
    slot.title = def ? `${def.label} (Tier ${def.tier}) — ${def.desc}` : '';
    slot.style.setProperty('--item-color', def ? def.color : '255,255,255');
    slot.classList.toggle('filled', !!def);
    if (justFilled) { slot.classList.remove('item-pop'); void slot.offsetWidth; slot.classList.add('item-pop'); }
  },

  _flashWasted(playerId) {
    const slot = document.getElementById('itemSlot' + playerId);
    if (!slot) return;
    slot.classList.remove('item-wasted'); void slot.offsetWidth; slot.classList.add('item-wasted');
    if (typeof AudioManager !== 'undefined') AudioManager.itemWasted();
  },

  _updateBadges(playerId) {
    const el = document.getElementById('itemBadges' + playerId);
    if (!el) return;
    const st = this.state[playerId];
    if (!st) { el.innerHTML = ''; return; }
    const now = performance.now();
    const color = (id, fallback) => (ITEM_DEFS[id] && ITEM_DEFS[id].color) || fallback;
    const secs = (t) => Math.ceil((t - now) / 1000);
    const badge = (c, txt) => `<span class="item-badge" style="--c:${c}">${txt}</span>`;
    const parts = [];
    if (st.invincibleUntil > now) parts.push(badge('255,210,95', `⭐ ${secs(st.invincibleUntil)}s`));
    if (st.shield) parts.push(badge(color('SHIELD', '107,214,255'), '🛡️'));
    if (st.slowUntil > now) parts.push(badge(color('SLOWMO', '196,107,255'), `🐌 ${secs(st.slowUntil)}s`));
    if (st.heavyUntil > now) parts.push(badge(color('HEAVY', '255,157,61'), `⚓ ${secs(st.heavyUntil)}s`));
    if (st.fogUntil > now) parts.push(badge(color('FOG', '190,190,205'), `🌫️ ${secs(st.fogUntil)}s`));
    const html = parts.join('');
    if (el._last !== html) { el.innerHTML = html; el._last = html; }
  },

  /* =================== UI: PICKER =================== */
  _renderPicker(playerId) {
    const st = this.state[playerId];
    const frame = document.getElementById('frame' + playerId);
    if (!st || !st.picker || !frame) return;
    let box = frame.querySelector('.item-picker');
    if (!box) {
      box = document.createElement('div');
      box.className = 'item-picker';
      frame.appendChild(box);
    }
    const list = this._pickerList();
    const sel = ITEM_DEFS[list[st.picker.index]];
    box.innerHTML = `
      <div class="item-picker-title">⭐ PICK A POWER-UP</div>
      <div class="item-picker-grid">
        ${list.map((id, i) => `<div class="item-picker-opt t${ITEM_DEFS[id].tier} ${i === st.picker.index ? 'sel' : ''}" style="--c:${ITEM_DEFS[id].color}">${ITEM_DEFS[id].icon}</div>`).join('')}
      </div>
      <div class="item-picker-name"><b>${sel.label}</b> · T${sel.tier}<br><span>${sel.desc}</span></div>
      <div class="item-picker-hint">◀ ▶ choose · ITEM button to use</div>
      <div class="item-picker-bar"><i></i></div>`;
    this._updatePickerBar(playerId);
  },

  _updatePickerBar(playerId) {
    const st = this.state[playerId];
    const frame = document.getElementById('frame' + playerId);
    if (!st || !st.picker || !frame) return;
    const bar = frame.querySelector('.item-picker-bar i');
    if (!bar) return;
    const total = st.picker.endsAt - st.picker.startedAt;
    const left = Math.max(0, st.picker.endsAt - performance.now());
    bar.style.width = (left / total * 100) + '%';
  },

  _removePickerDom(playerId) {
    const frame = document.getElementById('frame' + playerId);
    const box = frame && frame.querySelector('.item-picker');
    if (box) box.remove();
  },

  /* =================== UI: BOARD ANIMATIONS =================== */
  _pulseFrame(playerId, color, className) {
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    frame.style.setProperty('--item-color', color);
    frame.classList.remove(className); void frame.offsetWidth; frame.classList.add(className);
    setTimeout(() => frame.classList.remove(className), 700);
  },

  _animateBlock(playerId) { this._pulseFrame(playerId, '107,214,255', 'item-shield-block'); },

  _showFog(playerId, on) {
    const st = this.state[playerId];
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    const canvas = document.getElementById('boardCanvas' + playerId);
    let overlay = frame.querySelector('.item-fog-overlay');
    if (on) {
      frame.classList.add('item-fog-shake');
      if (canvas) canvas.classList.add('item-water-distorted');
      if (!overlay) { overlay = document.createElement('div'); overlay.className = 'item-fog-overlay'; frame.appendChild(overlay); }
      requestAnimationFrame(() => overlay.classList.add('show'));
      if (st) st._fogShown = true;
    } else {
      frame.classList.remove('item-fog-shake');
      if (canvas) canvas.classList.remove('item-water-distorted');
      if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { if (!st || !st._fogShown) overlay.remove(); }, 500);
      }
      if (st) st._fogShown = false;
    }
  },

  /** Floating icon flying from source board to target board. */
  _animateFire(sourceId, targetId, def, blocked) {
    const srcFrame = document.getElementById('frame' + sourceId);
    const tgtFrame = document.getElementById('frame' + targetId);
    if (!srcFrame || !tgtFrame) return;
    const a = srcFrame.getBoundingClientRect(), b = tgtFrame.getBoundingClientRect();
    const orb = document.createElement('div');
    orb.className = 'item-beam-orb';
    orb.textContent = def.icon;
    orb.style.setProperty('--c', def.color);
    orb.style.left = (a.left + a.width / 2) + 'px'; orb.style.top = (a.top + a.height / 2) + 'px';
    document.body.appendChild(orb);
    requestAnimationFrame(() => {
      orb.style.left = (b.left + b.width / 2) + 'px'; orb.style.top = (b.top + b.height / 2) + 'px';
      orb.style.transform = 'translate(-50%,-50%) scale(1.3)';
      orb.style.opacity = blocked ? '0.3' : '0';
    });
    setTimeout(() => orb.remove(), 520);
    if (!blocked) {
      tgtFrame.style.setProperty('--item-color', def.color);
      tgtFrame.classList.remove('item-impact'); void tgtFrame.offsetWidth; tgtFrame.classList.add('item-impact');
      setTimeout(() => tgtFrame.classList.remove('item-impact'), 450);
    }
  },

  _burstIcon(playerId, def) {
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    const burst = document.createElement('div');
    burst.className = 'item-self-burst';
    burst.textContent = def.icon;
    burst.style.setProperty('--c', def.color);
    frame.appendChild(burst);
    setTimeout(() => burst.remove(), 650);
  },

  /** Expanding ring centred on the blast cell, sized to BLAST_RADIUS. */
  _animateBlast(playerId, center, def) {
    const frame = document.getElementById('frame' + playerId);
    const canvas = document.getElementById('boardCanvas' + playerId);
    if (!frame || !canvas) return;
    const cellPx = canvas.clientWidth / COLS;
    const ring = document.createElement('div');
    ring.className = 'item-blast-ring';
    const d = cellPx * ITEM_CONFIG.BLAST_RADIUS * 2;
    ring.style.setProperty('--c', def.color);
    ring.style.width = ring.style.height = d + 'px';
    ring.style.left = (canvas.offsetLeft + (center.c + 0.5) * cellPx) + 'px';
    ring.style.top = (canvas.offsetTop + (center.r - HIDDEN + 0.5) * cellPx) + 'px';
    frame.appendChild(ring);
    setTimeout(() => ring.remove(), 600);
  },

  /* =================== STYLE (self-contained, no CSS edits needed) =================== */
  _injectStyle() {
    if (this._styleInjected) return;
    this._styleInjected = true;
    const css = `
      .item-box.hidden { display: none; }
      .item-slot {
        width: 48px; height: 48px; margin: 0 auto; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.04); border: 1.5px dashed rgba(255,255,255,0.18);
        font-size: 24px; transition: border-color .2s, background .2s, box-shadow .2s;
      }
      .item-slot.filled {
        border: 1.5px solid rgba(var(--item-color,255,255,255),0.8);
        background: rgba(var(--item-color,255,255,255),0.12);
        box-shadow: 0 0 14px rgba(var(--item-color,255,255,255),0.45);
      }
      .item-slot-icon { line-height: 1; }
      @keyframes itemPop { 0%{transform:scale(0.3);opacity:0;} 60%{transform:scale(1.25);opacity:1;} 100%{transform:scale(1);} }
      .item-slot.item-pop { animation: itemPop .35s ease-out; }
      @keyframes itemWasted { 0%,100%{background:rgba(255,84,112,0);} 30%{background:rgba(255,84,112,0.45);} }
      .item-slot.item-wasted { animation: itemWasted .5s ease-out; }

      .item-badges { display: flex; gap: 6px; justify-content: center; margin-top: 4px; min-height: 18px; flex-wrap: wrap; }
      .item-badge {
        font-size: 11px; padding: 1px 6px; border-radius: 8px;
        background: rgba(var(--c,255,255,255),0.16); border: 1px solid rgba(var(--c,255,255,255),0.5);
        color: #fff; white-space: nowrap;
      }

      @keyframes itemFrameGlow { 0%,100%{box-shadow:0 0 0 1px var(--line),0 10px 30px rgba(0,0,0,0.55);} 40%{box-shadow:0 0 0 2px rgba(var(--item-color,107,214,255),0.9), 0 0 30px rgba(var(--item-color,107,214,255),0.6);} }
      .board-frame.item-shield-glow, .board-frame.item-shield-block, .board-frame.item-column-flash, .board-frame.item-selfuse-flash, .board-frame.item-impact {
        animation: itemFrameGlow .7s ease-out; position: relative;
      }
      .board-frame.item-column-flash { --item-color: 95,255,143; }
      .board-frame.item-selfuse-flash { --item-color: 196,107,255; }
      .board-frame.item-shield-block { --item-color: 107,214,255; }
      .board-frame.item-impact { animation-duration: .45s; }

      /* Invincibility: steady golden pulse for the whole window */
      @keyframes itemInvincible { 0%,100%{box-shadow:0 0 0 2px rgba(255,210,95,0.9),0 0 22px rgba(255,210,95,0.5);} 50%{box-shadow:0 0 0 3px rgba(255,235,160,1),0 0 40px rgba(255,210,95,0.85);} }
      .board-frame.item-invincible { position: relative; animation: itemInvincible .6s ease-in-out infinite; }

      @keyframes itemFogShake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-1px,1px)} 50%{transform:translate(1px,-1px)} 75%{transform:translate(-1px,-1px)} }
      .board-frame.item-fog-shake { animation: itemFogShake .32s linear infinite; }
      .item-water-distorted { filter: url(#itemWaterDistortion) saturate(1.3); }
      .item-fog-overlay {
        position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
        overflow: hidden;
        background: radial-gradient(ellipse at 35% 28%, rgba(213,249,255,0.04), rgba(94,171,190,0.18) 55%, rgba(190,190,205,0.3));
        backdrop-filter: blur(1px) saturate(1.25); opacity: 0; transition: opacity .45s ease; z-index: 5;
      }
      .item-fog-overlay.show { opacity: 1; }
      .item-fog-overlay::before {
        content: ''; position: absolute; inset: -35%;
        background: repeating-linear-gradient(104deg, transparent 0 17px, rgba(220,250,255,0.12) 19px, transparent 25px 43px),
          repeating-linear-gradient(8deg, transparent 0 26px, rgba(190,239,255,0.09) 28px, transparent 34px 56px);
        mix-blend-mode: screen; opacity: .75; animation: itemWaterGlints 3.2s ease-in-out infinite alternate;
      }
      @keyframes itemWaterGlints { from{transform:translate(-3%,-2%) rotate(-7deg);background-position:0 0,0 0} to{transform:translate(3%,2%) rotate(-4deg);background-position:36px -22px,-28px 30px} }

      .item-beam-orb {
        position: fixed; width: 34px; height: 34px; margin-left:-17px; margin-top:-17px;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-size: 20px; pointer-events: none; z-index: 999;
        background: rgba(var(--c,255,255,255),0.25); box-shadow: 0 0 18px rgba(var(--c,255,255,255),0.85);
        transform: translate(-50%,-50%) scale(1);
        transition: left .5s cubic-bezier(.3,.6,.4,1), top .5s cubic-bezier(.3,.6,.4,1), opacity .5s ease, transform .5s ease;
      }
      @keyframes itemSelfBurst { 0%{transform:translate(-50%,-50%) scale(0.4);opacity:1;} 100%{transform:translate(-50%,-120%) scale(1.6);opacity:0;} }
      .item-self-burst {
        position: absolute; left:50%; top:50%; font-size: 30px; pointer-events:none; z-index: 6;
        animation: itemSelfBurst .65s ease-out forwards; filter: drop-shadow(0 0 10px rgba(var(--c,255,255,255),0.9));
      }

      @keyframes itemBlastRing { 0%{transform:translate(-50%,-50%) scale(0.2);opacity:1;} 100%{transform:translate(-50%,-50%) scale(1);opacity:0;} }
      .item-blast-ring {
        position: absolute; border-radius: 50%; pointer-events: none; z-index: 6;
        background: radial-gradient(circle, rgba(255,255,255,0.85), rgba(var(--c,255,120,40),0.55) 45%, rgba(var(--c,255,120,40),0) 70%);
        border: 2px solid rgba(var(--c,255,120,40),0.9);
        animation: itemBlastRing .55s ease-out forwards;
      }

      .item-picker {
        position: absolute; left: 6px; right: 6px; top: 6px; z-index: 7; pointer-events: none;
        padding: 8px; border-radius: 10px; text-align: center; color: #fff;
        background: rgba(10,9,16,0.88); border: 1px solid rgba(255,210,95,0.7);
        box-shadow: 0 0 18px rgba(255,210,95,0.35); font-size: 11px;
      }
      .item-picker-title { font-weight: 700; letter-spacing: 1px; color: rgb(255,210,95); margin-bottom: 6px; }
      .item-picker-grid { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
      .item-picker-opt {
        width: 30px; height: 30px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
        font-size: 17px; background: rgba(var(--c),0.12); border: 1px solid rgba(var(--c),0.35); opacity: .75;
      }
      .item-picker-opt.sel { opacity: 1; transform: scale(1.18); border: 2px solid rgb(var(--c)); box-shadow: 0 0 12px rgba(var(--c),0.9); }
      .item-picker-name { margin-top: 6px; line-height: 1.3; }
      .item-picker-name span { opacity: .7; font-size: 10px; }
      .item-picker-hint { margin-top: 4px; opacity: .5; font-size: 9px; }
      .item-picker-bar { margin-top: 6px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; }
      .item-picker-bar i { display: block; height: 100%; width: 100%; background: rgb(255,210,95); }
    `;
    const style = document.createElement('style');
    style.id = 'itemsSystemStyle';
    style.textContent = css;
    document.head.appendChild(style);

    const svgNS = 'http://www.w3.org/2000/svg';
    const filters = document.createElementNS(svgNS, 'svg');
    filters.setAttribute('aria-hidden', 'true');
    filters.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    filters.innerHTML = `<filter id="itemWaterDistortion" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.028" numOctaves="2" seed="7" result="waterNoise">
        <animate attributeName="baseFrequency" dur="3.4s" values="0.012 0.028;0.02 0.045;0.012 0.028" repeatCount="indefinite" />
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="waterNoise" scale="7" xChannelSelector="R" yChannelSelector="G" />
    </filter>`;
    document.body.appendChild(filters);
  }
};
