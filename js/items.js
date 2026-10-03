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
 *   Player.hardDrop()       -> ItemsSystem.interceptPickerVertical(player, -1)
 *   Gamepad D-Pad Down      -> ItemsSystem.interceptPickerVertical(player, +1)
 *   Player.tryRotate()      -> ItemsSystem.interceptRotate(player) [picker input lock]
 *   Player.hold()           -> ItemsSystem.interceptHold(player)        [picker confirm]
 *   updatePlayerPhysics()   -> ItemsSystem.isPickerOpen / isInvincible  [freeze + garbage delay]
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
 *        4       | NO roll. Invincibility for INVINCIBILITY_MS (5s) and a
 *                | picker opens with 3 options (Shield always + 2 random
 *                | tier 2-3). Pick one (and, for attacks, a target).
 *   A T-spin counts as +1 row for the roll (capped at 3, so it never
 *   grants invincibility).
 *   Not every clear pays out: ACQUIRE_CHANCE_BY_ROWS sets the chance
 *   per clear size (45% / 70% / 90%) before the tier roll happens.
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
 * blocks offensive items while it lasts (not consumed). Incoming GARBAGE is
 * not cancelled — it queues and lands when invincibility ends, so it's a
 * timing tool, not a free dodge. Offensive items are telegraphed
 * (TELEGRAPH_MS) so the victim can still react (e.g. get a Shield up).
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

  // Chance that a clear of N rows pays out at all (before the tier roll).
  // The "Item Drop Chance" slider in Settings scales these (100% = as written).
  ACQUIRE_CHANCE_BY_ROWS: { 1: 0.45, 2: 0.70, 3: 0.90 },

  // A T-spin line clear counts as this many extra rows (capped at 3 rows
  // so it can never grant invincibility). Set 0 to disable.
  TSPIN_ROW_BONUS: 1,

  // Clearing this many rows (or more) grants invincibility + the picker
  // instead of a random roll.
  INVINCIBILITY_ROWS: 4,
  INVINCIBILITY_MS: 5000,   // blocks offensive items; incoming garbage queues until it ends

  // 4-row picker. Piece gravity/lock delay are PAUSED while it is open.
  // D-Pad Up/Down cycle the choice; A or HOLD confirms. Y remains item-use during play.
  PICKER_OPTIONS: 3,            // how many choices are offered
  PICKER_GUARANTEED: ['SHIELD'],// always offered (if it exists in ITEM_DEFS)
  PICKER_POOL_TIERS: [2, 3],    // the rest are random from these tiers
  PICKER_MS: 5000,              // total gravity pause for item + optional target selection
  PICKER_TARGET_MS: 1500,       // target selection is capped by the total picker deadline

  // Offensive items warn the victim this long before they land.
  TELEGRAPH_MS: 800,

  // Blast item
  BLAST_RADIUS: 3,        // cells, Euclidean distance from the blast centre
  BLAST_INNER_MARGIN: 2,  // blast centre must be this many columns in from each wall
  BLAST_APPLY_GRAVITY: false, // true = blocks above the hole fall down afterwards
  BLAST_JUNK_CHANCE: 0.30,    // chance each destroyed block turns into junk garbage instead (0 = off)
  BLAST_BONUS_GARBAGE: 1,     // garbage lines also sent on top of the crater (0 = off)

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
    tier: 1, weight: 1, duration: 6000, gravityMult: 2.4, desc: 'Your gravity slows way down for 6s.'
  },
  FOG: {
    id: 'FOG', label: 'Fog', icon: '🌫️', kind: 'offense', color: '190,190,205',
    tier: 1, weight: 1, duration: 7000, desc: "Clouds the leader's board for 7s."
  },
  ROW_ERASE: {
    id: 'ROW_ERASE', label: 'Row Erase', icon: '🧽', kind: 'self', color: '120,220,170',
    tier: 1, weight: 0.5, rows: 1, desc: 'Removes the bottom row of your own board.'
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
    tier: 3, weight: 1, desc: "Blows up the leader's inner blocks (3-block radius), leaves junk + 1 garbage."
  },
  GARBAGE_MEGA: {
    id: 'GARBAGE_MEGA', label: 'Garbage++', icon: '☄️', kind: 'offense', color: '255,60,90',
    tier: 3, weight: 1, amount: 4, desc: 'Sends 4 bonus garbage lines to the leader.'
  },
  MEGA_ERASE: {
    id: 'MEGA_ERASE', label: 'Mega Erase', icon: '🌊', kind: 'self', color: '90,200,255',
    tier: 3, weight: 1, rows: 2, desc: 'Removes the bottom 2 rows of your own board.'
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
  MEGA_ERASE(ctx) { ctx.sys._eraseBottomRows(ctx.target, ctx.def.rows || 2, ctx.def); },

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
  ACQUIRE_CHANCE: 1.0,    // SCALE on ITEM_CONFIG.ACQUIRE_CHANCE_BY_ROWS (1.0 = as written; settings slider)
  LINES_TO_QUALIFY: 1,    // minimum rows cleared before items can drop at all
  SETTINGS_KEY: 'tetrisai.itemSettings.v3', // v3: drop chance is now a scale on per-row chances
  state: {}, // playerId -> see resetPlayerState()
  _pending: [], // telegraphed offensive items waiting to land: { source, target, def, t, el }
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
    this._pending = [];
    players.forEach(p => {
      this._removePickerDom(p.id);
      this._clearIncoming(p.id);
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
      picker: null,            // { stage, options, index, targets, tIndex, startedAt, endsAt } while the 4-row picker is open
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
    let rows = info.numCleared;

    // 4+ rows: invincibility + pick (no random roll)
    if (rows >= ITEM_CONFIG.INVINCIBILITY_ROWS) { this._startInvincibility(player); return; }

    // T-spin bonus: counts as extra rows, but never reaches the invincibility tier.
    if (info.isTspin) rows = Math.min(ITEM_CONFIG.INVINCIBILITY_ROWS - 1, rows + ITEM_CONFIG.TSPIN_ROW_BONUS);

    if (rows < this.LINES_TO_QUALIFY) return;
    if (st.held) { this._flashWasted(player.id); return; } // no stockpiling
    const base = ITEM_CONFIG.ACQUIRE_CHANCE_BY_ROWS[rows] ?? 1;
    if (Math.random() >= Math.min(1, base * this.ACQUIRE_CHANCE)) return;
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
    st.invincibleUntil = now + ITEM_CONFIG.INVINCIBILITY_MS;
    const pickerDeadline = now + ITEM_CONFIG.PICKER_MS;
    st.picker = {
      stage: 'item', options: this._buildPickerOptions(), index: 0,
      chosen: null, targets: [], tIndex: 0,
      startedAt: now, endsAt: pickerDeadline, deadline: pickerDeadline
    };
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

  /** True while the 4-row picker is open — game.js freezes that player's gravity/lock timer. */
  isPickerOpen(player) {
    const st = this.state[player.id];
    return !!(this.enabled && st && st.picker);
  },

  /** Picker choices: the guaranteed ids first, then random picks (by weight) from PICKER_POOL_TIERS. Sorted by tier. */
  _buildPickerOptions() {
    const out = ITEM_CONFIG.PICKER_GUARANTEED.filter(id => ITEM_DEFS[id]).slice(0, ITEM_CONFIG.PICKER_OPTIONS);
    const pool = ItemCatalog.ids().filter(id =>
      ITEM_CONFIG.PICKER_POOL_TIERS.includes(ITEM_DEFS[id].tier) && !out.includes(id));
    while (out.length < ITEM_CONFIG.PICKER_OPTIONS && pool.length) {
      const pick = this._weightedPick(pool, id => ITEM_DEFS[id].weight ?? 1);
      if (!pick) break;
      out.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    if (out.length === 0) out.push(...ItemCatalog.ids().slice(0, ITEM_CONFIG.PICKER_OPTIONS)); // misconfigured: never an empty picker
    return out.sort((a, b) => ITEM_DEFS[a].tier - ITEM_DEFS[b].tier);
  },

  /** Living opponents, leader first (most lines, then score). */
  _rankedOpponents(player) {
    if (typeof MatchManager === 'undefined') return [];
    return MatchManager.players
      .filter(p => p.alive && p.id !== player.id)
      .sort((a, b) => (b.lines - a.lines) || (b.score - a.score));
  },

  /** D-Pad/vertical movement cycles choices; rotation buttons are ignored while picking. */
  interceptPickerVertical(player, dir) {
    const st = this.state[player.id];
    if (!this.enabled || !st || !st.picker) return false;
    const pk = st.picker;
    const choices = pk.stage === 'item' ? pk.options : pk.targets;
    const indexKey = pk.stage === 'item' ? 'index' : 'tIndex';
    if (choices.length) pk[indexKey] = (pk[indexKey] + dir + choices.length) % choices.length;
    this._renderPicker(player.id);
    if (typeof AudioManager !== 'undefined') AudioManager.navMove();
    return true;
  },

  interceptRotate(player) {
    const st = this.state[player.id];
    return !!(this.enabled && st && st.picker);
  },

  /** Player.hold hook: while the picker is open, HOLD confirms (humans only). */
  interceptHold(player) {
    const st = this.state[player.id];
    if (!this.enabled || !st || !st.picker) return false;
    if (player.assignment && player.assignment.type === 'bot') return false;
    this._confirmPicker(player);
    return true;
  },

  /** Confirm the highlighted option. Attacks go on to a target stage when there is more than one opponent. */
  _confirmPicker(player) {
    const st = this.state[player.id];
    const pk = st && st.picker;
    if (!pk) return;

    if (pk.stage === 'item') {
      const def = ITEM_DEFS[pk.options[pk.index]];
      if (!def) { this._closePicker(player.id); return; }
      if (def.kind === 'offense') {
        const targets = this._rankedOpponents(player);
        if (targets.length > 1) {
          const now = performance.now();
          const deadline = pk.deadline ?? (pk.startedAt + ITEM_CONFIG.PICKER_MS);
          Object.assign(pk, { stage: 'target', chosen: def.id, targets, tIndex: 0, startedAt: now, endsAt: Math.min(deadline, now + ITEM_CONFIG.PICKER_TARGET_MS) });
          this._renderPicker(player.id);
          if (typeof AudioManager !== 'undefined') AudioManager.navConfirm();
          return;
        }
        this._closePicker(player.id);
        this._fire(player, def, targets[0]);
        return;
      }
      this._closePicker(player.id);
      this._fire(player, def);
      return;
    }

    // target stage
    const def = ITEM_DEFS[pk.chosen];
    const target = pk.targets[pk.tIndex];
    this._closePicker(player.id);
    if (def) this._fire(player, def, target);
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

    // Picker open: the item button confirms the highlighted option (same as Hold).
    if (st.picker) { this._confirmPicker(player); return; }

    if (!st.held) return;
    const def = ITEM_DEFS[st.held];
    st.held = null;
    this._renderSlot(player.id);
    if (def) this._fire(player, def);
  },

  /** `target` is only used by offensive items; omitted = the current leader. */
  _fire(player, def, target) {
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleItemUse(player.id);
    if (def.kind === 'self') {
      this._runEffect(def, player, player);
      this._burstIcon(player.id, def);
      if (typeof AudioManager !== 'undefined') AudioManager.itemUseSelf();
    } else {
      target = (target && target.alive) ? target : this._pickLeaderTarget(player);
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

  /**
   * Offensive items are TELEGRAPHED: an "INCOMING" warning shows on the
   * victim's board for TELEGRAPH_MS, then _resolveOffense() decides the
   * outcome. Invincibility / Shield are checked at landing time, so a
   * victim who reacts in the window can still defend.
   */
  applyOffense(source, target, def) {
    if (!target) return;
    const el = this._showIncoming(target.id, def);
    this._pending.push({ source, target, def, t: ITEM_CONFIG.TELEGRAPH_MS, el });
    this._animateFire(source.id, target.id, def, false, true);
    if (typeof AudioManager !== 'undefined') AudioManager.garbageWarn();
    if (typeof vibrationManager !== 'undefined') vibrationManager.rumbleGarbageWarning(target.id);
  },

  _resolveOffense(entry) {
    const { source, target, def, el } = entry;
    if (el) el.remove();
    this._pruneIncoming(target.id);
    if (!target.alive) return;
    const tgtState = this.state[target.id];
    // Invincibility: blocked, NOT consumed.
    if (this.isInvincible(target)) { this._blocked(target.id); return; }
    // Shield: blocked, consumed.
    if (tgtState && tgtState.shield) {
      tgtState.shield = false;
      this._updateBadges(target.id);
      this._blocked(target.id);
      return;
    }
    this._runEffect(def, source, target);
    this._flashImpact(target.id, def);
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
    if (this.isInvincible(player)) return false; // not absorbed: garbage queues and lands when invincibility ends (see updatePlayerPhysics)
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
    const R = ITEM_CONFIG.BLAST_RADIUS;
    const center = this._blastCenter(target);
    if (center) {
      const destroyed = [];
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
        if (dr * dr + dc * dc > R * R) continue;
        const rr = center.r + dr, cc = center.c + dc;
        if (rr >= HIDDEN && rr < TOTAL_ROWS && cc >= 0 && cc < COLS && target.grid[rr][cc]) {
          target.grid[rr][cc] = null;
          destroyed.push([rr, cc]);
        }
      }
      // Junk: some of the debris comes back as garbage blocks (never inside the falling piece).
      if (ITEM_CONFIG.BLAST_JUNK_CHANCE > 0) {
        let live = [];
        try { live = target.cellsFor(target.current, target.rotState, target.px, target.py); } catch (e) { /* no active piece */ }
        const inPiece = (r, c) => live.some(([lr, lc]) => lr === r && lc === c);
        destroyed.forEach(([r, c]) => {
          if (Math.random() < ITEM_CONFIG.BLAST_JUNK_CHANCE && !inPiece(r, c)) target.grid[r][c] = 'G';
        });
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
    }
    // Guaranteed sting even on a flat/empty board.
    if (ITEM_CONFIG.BLAST_BONUS_GARBAGE > 0) target.receiveGarbage(ITEM_CONFIG.BLAST_BONUS_GARBAGE);
  },

  /* =================== PER-FRAME TICK =================== */
  update(dt, players) {
    if (!this.enabled) return;
    const now = performance.now();

    // Telegraphed attacks: count down (pause-safe, update() only runs while playing) and land.
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const e = this._pending[i];
      e.t -= dt;
      if (e.t <= 0) { this._pending.splice(i, 1); this._resolveOffense(e); }
    }

    players.forEach(p => {
      const st = this.state[p.id];
      if (!st) return;

      if (st._fogShown && st.fogUntil <= now) this._showFog(p.id, false);

      // Picker lifecycle
      const pk = st.picker;
      if (pk) {
        if (!p.alive) this._closePicker(p.id);
        else if (now >= pk.endsAt) {
          if (pk.stage === 'target') {            // ran out of time choosing a target: default to the leader
            const def = ITEM_DEFS[pk.chosen], leader = pk.targets[0];
            this._closePicker(p.id);
            if (def) this._fire(p, def, leader);
          } else this._closePicker(p.id);          // ran out of time choosing an item: nothing is used
        } else this._updatePickerBar(p.id);
      }
      if (st.invincibleUntil && st.invincibleUntil <= now) {
        st.invincibleUntil = 0;
        const frame = document.getElementById('frame' + p.id);
        if (frame) frame.classList.remove('item-invincible');
      }
      this._updateBadges(p.id);

      // Bots: choose from the picker, or use the held item, after a consistent reaction delay.
      const isBot = p.assignment && p.assignment.type === 'bot' && p.alive;
      if (isBot && (st.picker || st.held)) {
        st._botTimer += dt;
        if (st._botTimer >= ITEM_CONFIG.BOT_USE_DELAY_MS) {
          st._botTimer = 0;
          if (st.picker && st.picker.stage === 'item') {
            st.picker.index = Math.max(0, st.picker.options.indexOf(this._botChoose(p, st.picker.options)));
          } // target stage: bots keep index 0 = the leader
          this.tryUse(p);
        }
      } else st._botTimer = 0;
    });
  },

  /** Bot picker heuristic: tall stack -> heal/defend; otherwise the strongest attack on offer. */
  _botChoose(p, options) {
    let top = TOTAL_ROWS;
    for (let r = HIDDEN; r < TOTAL_ROWS; r++) if (p.grid[r].some(c => c)) { top = r; break; }
    const stackHeight = TOTAL_ROWS - top;
    const prefer = stackHeight >= 12
      ? ['MEGA_ERASE', 'SHIELD', 'ROW_ERASE']
      : ['BLAST', 'GARBAGE_MEGA', 'GARBAGE_PLUS', 'CLEAR_COLUMN'];
    return prefer.find(id => options.includes(id)) || options[0];
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
    const pk = st.picker;
    let box = frame.querySelector('.item-picker');
    if (!box) {
      box = document.createElement('div');
      box.className = 'item-picker';
      frame.appendChild(box);
    }
    let title, rows, hint;
    if (pk.stage === 'item') {
      title = '⭐ PICK A POWER-UP';
      rows = pk.options.map((id, i) => {
        const d = ITEM_DEFS[id];
        return `<div class="item-picker-row ${i === pk.index ? 'sel' : ''}" style="--c:${d.color}">
          <span class="ip-icon">${d.icon}</span>
          <span class="ip-text"><b>${d.label}</b> · T${d.tier}<br><small>${d.desc}</small></span></div>`;
      }).join('');
      hint = 'D-PAD ↑ / ↓ choose · A / HOLD confirm';
    } else {
      title = '🎯 CHOOSE TARGET';
      rows = pk.targets.map((t, i) => {
        const color = (typeof PLAYER_COLORS !== 'undefined' && PLAYER_COLORS[t.id - 1]) || '#ffd25f';
        return `<div class="item-picker-row ${i === pk.tIndex ? 'sel' : ''}">
          <span class="ip-icon">🎯</span>
          <span class="ip-text"><b style="color:${color}">PLAYER ${t.id}</b>${i === 0 ? ' · leader' : ''}</span></div>`;
      }).join('');
      hint = 'D-PAD ↑ / ↓ choose · A / HOLD fire (no pick = leader)';
    }
    box.innerHTML = `
      <div class="item-picker-title">${title}</div>
      ${rows}
      <div class="item-picker-hint">${hint}</div>
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
  _animateFire(sourceId, targetId, def, blocked, noImpact) {
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
    if (!blocked && !noImpact) {
      tgtFrame.style.setProperty('--item-color', def.color);
      tgtFrame.classList.remove('item-impact'); void tgtFrame.offsetWidth; tgtFrame.classList.add('item-impact');
      setTimeout(() => tgtFrame.classList.remove('item-impact'), 450);
    }
  },

  _flashImpact(playerId, def) {
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    frame.style.setProperty('--item-color', def.color);
    frame.classList.remove('item-impact'); void frame.offsetWidth; frame.classList.add('item-impact');
    setTimeout(() => frame.classList.remove('item-impact'), 450);
  },

  /** "ICON NAME INCOMING" strip at the bottom of the victim's board for the telegraph window. */
  _showIncoming(playerId, def) {
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return null;
    let wrap = frame.querySelector('.item-incoming-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'item-incoming-wrap'; frame.appendChild(wrap); }
    const el = document.createElement('div');
    el.className = 'item-incoming';
    el.style.setProperty('--c', def.color);
    el.innerHTML = `${def.icon} <b>${def.label.toUpperCase()}</b> INCOMING`;
    wrap.appendChild(el);
    return el;
  },

  _pruneIncoming(playerId) {
    const frame = document.getElementById('frame' + playerId);
    const wrap = frame && frame.querySelector('.item-incoming-wrap');
    if (wrap && !wrap.children.length) wrap.remove();
  },

  _clearIncoming(playerId) {
    const frame = document.getElementById('frame' + playerId);
    const wrap = frame && frame.querySelector('.item-incoming-wrap');
    if (wrap) wrap.remove();
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
        content: ''; position: absolute; inset: -45%;
        background: repeating-radial-gradient(ellipse 115% 52% at 18% 25%, transparent 0 18px, rgba(220,250,255,0.2) 20px, transparent 24px 42px),
          repeating-radial-gradient(ellipse 110% 48% at 82% 75%, transparent 0 22px, rgba(190,239,255,0.14) 24px, transparent 28px 50px),
          linear-gradient(110deg, transparent 36%, rgba(220,250,255,0.08) 48%, transparent 61%);
        filter: url(#itemWaterDistortion); mix-blend-mode: screen; opacity: .88;
        animation: itemWaterWaves 2.4s ease-in-out infinite alternate;
      }
      @keyframes itemWaterWaves { from{transform:translate(-5%,-3%) rotate(-5deg) scale(1);background-position:0 0,0 0,0 0} to{transform:translate(5%,3%) rotate(4deg) scale(1.08);background-position:42px -28px,-34px 38px,26px 0} }

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
        position: absolute; left: 8px; right: 8px; top: 8px; bottom: 8px; z-index: 7; pointer-events: none;
        display: flex; flex-direction: column; justify-content: center; overflow: auto;
        padding: 14px 12px; border-radius: 10px; text-align: center; color: #fff;
        background: rgba(10,9,16,0.94); border: 2px solid rgba(255,210,95,0.85);
        box-shadow: 0 0 30px rgba(255,210,95,0.5); font-size: 15px;
        backdrop-filter: blur(5px); animation: itemPickerZoom .22s cubic-bezier(.2,.8,.2,1) both;
      }
      @keyframes itemPickerZoom { from{opacity:0;transform:scale(.82)} to{opacity:1;transform:scale(1)} }
      .item-picker-title { font-size: 1.2em; font-weight: 700; letter-spacing: 1px; color: rgb(255,210,95); margin-bottom: 10px; }
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
      .item-picker-row {
        display: flex; gap: 8px; align-items: center; text-align: left;
        min-height: 48px; padding: 8px 10px; margin-top: 6px; border-radius: 8px; opacity: .72;
        background: rgba(var(--c,255,210,95),0.08); border: 1px solid rgba(var(--c,255,210,95),0.25);
      }
      .item-picker-row.sel { opacity: 1; border: 2px solid rgb(var(--c,255,210,95)); box-shadow: 0 0 10px rgba(var(--c,255,210,95),0.7); }
      .ip-icon { flex: 0 0 32px; font-size: 27px; line-height: 1; text-align: center; }
      .ip-text { font-size: 14px; line-height: 1.3; }
      .ip-text small { opacity: .78; font-size: 11px; line-height: 1.3; }
      .item-picker-hint { margin-top: 9px; font-size: 12px; font-weight: 700; color: rgba(255,255,255,.82); }
      .item-picker-bar { flex: 0 0 5px; margin-top: 9px; }

      @keyframes itemIncoming { 0%,100%{opacity:1;} 50%{opacity:.55;} }
      .item-incoming-wrap { position: absolute; left: 6px; right: 6px; bottom: 8px; z-index: 7; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
      .item-incoming {
        padding: 4px 8px; border-radius: 8px; text-align: center; font-size: 11px; color: #fff; letter-spacing: .5px;
        background: rgba(var(--c,255,84,112),0.3); border: 1px solid rgba(var(--c,255,84,112),0.9);
        animation: itemIncoming .3s ease-in-out infinite;
      }
    `;
    const style = document.createElement('style');
    style.id = 'itemsSystemStyle';
    style.textContent = css;
    document.head.appendChild(style);

    const svgNS = 'http://www.w3.org/2000/svg';
    const filters = document.createElementNS(svgNS, 'svg');
    filters.setAttribute('aria-hidden', 'true');
    filters.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    filters.innerHTML = `<filter id="itemWaterDistortion" x="-12%" y="-12%" width="124%" height="124%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="2" seed="7" result="waterNoise">
        <animate attributeName="baseFrequency" dur="2.8s" values="0.008 0.018;0.02 0.042;0.008 0.018" repeatCount="indefinite" />
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="waterNoise" scale="16" xChannelSelector="R" yChannelSelector="G">
        <animate attributeName="scale" dur="2.8s" values="12;22;12" repeatCount="indefinite" />
      </feDisplacementMap>
    </filter>`;
    document.body.appendChild(filters);
  }
};
