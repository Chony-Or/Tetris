/**
 * items.js
 * =====================================================================
 * ITEMS & POWER-UPS MODE (opt-in, off by default)
 * ---------------------------------------------------------------------
 * A self-contained module — no other file needs to know its internals.
 * game.js calls out to it at a handful of well-defined points (all
 * guarded with `typeof ItemsSystem !== 'undefined'`, so the game runs
 * identically with this file removed):
 *
 *   Player.reset()          -> ItemsSystem.resetPlayerState(id)
 *   Player.lockPiece()      -> ItemsSystem.onLineClear(player, info)
 *   Player.receiveGarbage() -> ItemsSystem.consumeShieldIfActive(player)
 *   updatePlayerPhysics()   -> ItemsSystem.gravityMultiplier(player)
 *   MatchManager.loop()     -> ItemsSystem.update(dt, players)
 *   MatchManager.setupPlayers() -> ItemsSystem.init(players, enabled)
 *   MatchManager.beginPlay()/restart() -> ItemsSystem.resetMatch(players)
 *   Keyboard/Gamepad "item" button -> ItemsSystem.tryUse(player)
 *
 * FAIRNESS / "EQUALIZE TO ALL" DESIGN
 * ---------------------------------------------------------------------
 *  - Every player rolls under the exact same odds, off the exact same
 *    clear thresholds (Tetris / T-spin / 3+ combo) — human, bot,
 *    keyboard or gamepad, it's all identical.
 *  - Only one item can ever be held at once (no stockpiling).
 *  - Offensive items always auto-target whoever currently has the most
 *    lines cleared (the match leader) among living opponents. That
 *    makes items a built-in catch-up/rubber-band mechanic — the player
 *    who's doing best is the one who gets hit — rather than something
 *    that lets an already-winning player pile onto whoever's losing.
 *  - A Shield blocks the very next offensive item OR line-clear garbage
 *    attack aimed at that player, whichever comes first — so defense
 *    is never wasted or arbitrarily ignored.
 * =====================================================================
 */
"use strict";

const ITEM_DEFS = {
  SHIELD: {
    id: 'SHIELD', label: 'Shield', icon: '🛡️', kind: 'self', color: '107,214,255',
    desc: 'Blocks the next attack aimed at you.'
  },
  GARBAGE_PLUS: {
    id: 'GARBAGE_PLUS', label: 'Garbage+', icon: '💥', kind: 'offense', color: '255,84,112',
    amount: 2, desc: 'Sends 2 bonus garbage lines to the leader.'
  },
  CLEAR_COLUMN: {
    id: 'CLEAR_COLUMN', label: 'Clear Column', icon: '🧹', kind: 'self', color: '95,255,143',
    desc: "Wipes your single tallest column."
  },
  SLOWMO: {
    id: 'SLOWMO', label: 'Slow-Mo', icon: '🐌', kind: 'self', color: '196,107,255',
    duration: 6000, gravityMult: 1.9, desc: 'Your gravity slows down for 6s.'
  },
  FOG: {
    id: 'FOG', label: 'Fog', icon: '🌫️', kind: 'offense', color: '190,190,205',
    duration: 5000, desc: "Clouds the leader's board for 5s."
  },
  HEAVY: {
    id: 'HEAVY', label: 'Heavy Piece', icon: '⚓', kind: 'offense', color: '255,157,61',
    duration: 5000, gravityMult: 0.4, desc: "Speeds up the leader's gravity for 5s."
  }
};
const ITEM_POOL = Object.keys(ITEM_DEFS);

const ItemsSystem = {
  enabled: false,
  ACQUIRE_CHANCE: 0.55,
  BOT_USE_DELAY_MS: 650,
  state: {}, // playerId -> { held, shield, slowUntil, heavyUntil, fogUntil, _fogShown, _botTimer }
  _styleInjected: false,

  /* =================== LIFECYCLE =================== */
  init(players, enabled) {
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
      this.resetPlayerState(p.id);
      this._renderSlot(p.id);
      this._updateBadges(p.id);
      this._showFog(p.id, false);
      const frame = document.getElementById('frame' + p.id);
      if (frame) frame.classList.remove('item-shield-glow');
    });
  },

  resetPlayerState(playerId) {
    this.state[playerId] = {
      held: null, shield: false,
      slowUntil: 0, heavyUntil: 0, fogUntil: 0,
      _fogShown: false, _botTimer: 0
    };
  },

  /* =================== ACQUISITION =================== */
  qualifies(numCleared, isTspin, combo) {
    return numCleared >= 4 || isTspin || combo >= 3;
  },

  onLineClear(player, info) {
    if (!this.enabled) return;
    if (!this.qualifies(info.numCleared, info.isTspin, info.combo)) return;
    const st = this.state[player.id];
    if (!st) return;
    if (st.held) { this._flashWasted(player.id); return; } // already holding — clear "wasted", no stockpiling
    if (Math.random() > this.ACQUIRE_CHANCE) return;
    const itemId = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)];
    this.grantItem(player, itemId);
  },

  grantItem(player, itemId) {
    const st = this.state[player.id];
    if (!st) return;
    st.held = itemId;
    this._renderSlot(player.id, true);
    if ( (typeof AudioManager !== 'undefined')) AudioManager.itemPickup();
    if ( (typeof vibrationManager !== 'undefined')) vibrationManager.rumbleItemPickup(player.id);
  },

  /* =================== USE =================== */
  tryUse(player) {
    if (!this.enabled || !player.alive) return;
    const st = this.state[player.id];
    if (!st || !st.held) return;
    const def = ITEM_DEFS[st.held];
    st.held = null;
    this._renderSlot(player.id);

    if ( (typeof vibrationManager !== 'undefined')) vibrationManager.rumbleItemUse(player.id);

    if (def.kind === 'self') {
      this.applySelf(player, def);
      if ( (typeof AudioManager !== 'undefined')) AudioManager.itemUseSelf();
    } else {
      const target = this._pickLeaderTarget(player);
      if (!target) return; // no living opponent (shouldn't normally happen)
      this.applyOffense(player, target, def);
      if ( (typeof AudioManager !== 'undefined')) AudioManager.itemUseOffense();
    }
  },

  /** Auto-target: the living opponent with the most lines cleared (ties -> higher score). */
  _pickLeaderTarget(player) {
    if (typeof MatchManager === 'undefined') return null;
    const opponents = MatchManager.players.filter(p => p.alive && p.id !== player.id);
    if (opponents.length === 0) return null;
    return opponents.reduce((best, p) =>
      (p.lines > best.lines || (p.lines === best.lines && p.score > best.score)) ? p : best
    );
  },

  applySelf(player, def) {
    const st = this.state[player.id];
    switch (def.id) {
      case 'SHIELD':
        st.shield = true;
        this._updateBadges(player.id);
        this._pulseFrame(player.id, def.color, 'item-shield-glow');
        break;
      case 'CLEAR_COLUMN': {
        const col = this._tallestColumn(player);
        if (col !== -1) {
          for (let r = HIDDEN; r < TOTAL_ROWS; r++) player.grid[r][col] = null;
          player.updateGhost();
        }
        this._pulseFrame(player.id, def.color, 'item-column-flash');
        break;
      }
      case 'SLOWMO':
        st.slowUntil = performance.now() + def.duration;
        this._updateBadges(player.id);
        this._pulseFrame(player.id, def.color, 'item-selfuse-flash');
        break;
    }
    this._burstIcon(player.id, def);
  },

  applyOffense(source, target, def) {
    const tgtState = this.state[target.id];
    if (tgtState && tgtState.shield) {
      tgtState.shield = false;
      this._updateBadges(target.id);
      this._animateBlock(target.id);
      if ( (typeof AudioManager !== 'undefined')) AudioManager.itemBlocked();
      if ( (typeof vibrationManager !== 'undefined')) vibrationManager.rumbleItemBlocked(target.id);
      this._animateFire(source.id, target.id, def, true);
      return;
    }

    switch (def.id) {
      case 'GARBAGE_PLUS':
        target.receiveGarbage(def.amount);
        break;
      case 'FOG':
        tgtState.fogUntil = performance.now() + def.duration;
        this._showFog(target.id, true);
        this._updateBadges(target.id);
        break;
      case 'HEAVY':
        tgtState.heavyUntil = performance.now() + def.duration;
        this._updateBadges(target.id);
        break;
    }

    this._animateFire(source.id, target.id, def, false);
    if ( (typeof AudioManager !== 'undefined')) AudioManager.itemReceived();
    if ( (typeof vibrationManager !== 'undefined')) vibrationManager.rumbleItemReceived(target.id);
    if (typeof Effects !== 'undefined' && Effects.showDramaBanner) {
      Effects.showDramaBanner(`P${target.id} HIT BY ${def.label.toUpperCase()}`, { color: def.color, duration: 1100 });
    }
  },

  /** Called from Player.receiveGarbage() — true means the garbage was absorbed. */
  consumeShieldIfActive(player) {
    const st = this.state[player.id];
    if (st && st.shield) {
      st.shield = false;
      this._updateBadges(player.id);
      this._animateBlock(player.id);
      if ( (typeof AudioManager !== 'undefined')) AudioManager.itemBlocked();
      if ( (typeof vibrationManager !== 'undefined')) vibrationManager.rumbleItemBlocked(player.id);
      return true;
    }
    return false;
  },

  /** Called every physics tick — combines Slow-Mo (self) and Heavy Piece (received) multipliers. */
  gravityMultiplier(player) {
    const st = this.state[player.id];
    if (!st) return 1;
    const now = performance.now();
    let m = 1;
    if (st.slowUntil > now) m *= ITEM_DEFS.SLOWMO.gravityMult;
    if (st.heavyUntil > now) m *= ITEM_DEFS.HEAVY.gravityMult;
    return m;
  },

  _tallestColumn(player) {
    let bestCol = -1, bestRow = TOTAL_ROWS;
    for (let c = 0; c < COLS; c++) {
      for (let r = HIDDEN; r < TOTAL_ROWS; r++) {
        if (player.grid[r][c]) { if (r < bestRow) { bestRow = r; bestCol = c; } break; }
      }
    }
    return bestCol;
  },

  /* =================== PER-FRAME TICK =================== */
  update(dt, players) {
    if (!this.enabled) return;
    const now = performance.now();
    players.forEach(p => {
      const st = this.state[p.id];
      if (!st) return;

      if (st._fogShown && st.fogUntil <= now) this._showFog(p.id, false);
      this._updateBadges(p.id);

      // Bots: use whatever they're holding after a short, consistent "reaction" delay —
      // same rules, same timing, as any human would face pressing the button.
      if (p.assignment && p.assignment.type === 'bot' && p.alive && st.held) {
        st._botTimer += dt;
        if (st._botTimer >= this.BOT_USE_DELAY_MS) { st._botTimer = 0; this.tryUse(p); }
      } else {
        st._botTimer = 0;
      }
    });
  },

  /* =================== UI: SLOT / BADGES =================== */
  _renderSlot(playerId, justFilled) {
    const icon = document.getElementById('itemIcon' + playerId);
    const slot = document.getElementById('itemSlot' + playerId);
    if (!icon || !slot) return;
    const st = this.state[playerId];
    const def = st && st.held ? ITEM_DEFS[st.held] : null;
    icon.textContent = def ? def.icon : '';
    slot.title = def ? `${def.label} — ${def.desc}` : '';
    slot.style.setProperty('--item-color', def ? def.color : '255,255,255');
    slot.classList.toggle('filled', !!def);
    if (justFilled) {
      slot.classList.remove('item-pop'); void slot.offsetWidth; slot.classList.add('item-pop');
    }
  },

  _flashWasted(playerId) {
    const slot = document.getElementById('itemSlot' + playerId);
    if (!slot) return;
    slot.classList.remove('item-wasted'); void slot.offsetWidth; slot.classList.add('item-wasted');
    if ( (typeof AudioManager !== 'undefined')) AudioManager.itemWasted();
  },

  _updateBadges(playerId) {
    const el = document.getElementById('itemBadges' + playerId);
    if (!el) return;
    const st = this.state[playerId];
    if (!st) { el.innerHTML = ''; return; }
    const now = performance.now();
    const parts = [];
    if (st.shield) parts.push(`<span class="item-badge" style="--c:${ITEM_DEFS.SHIELD.color}">🛡️</span>`);
    if (st.slowUntil > now) parts.push(`<span class="item-badge" style="--c:${ITEM_DEFS.SLOWMO.color}">🐌 ${Math.ceil((st.slowUntil - now) / 1000)}s</span>`);
    if (st.heavyUntil > now) parts.push(`<span class="item-badge" style="--c:${ITEM_DEFS.HEAVY.color}">⚓ ${Math.ceil((st.heavyUntil - now) / 1000)}s</span>`);
    if (st.fogUntil > now) parts.push(`<span class="item-badge" style="--c:${ITEM_DEFS.FOG.color}">🌫️ ${Math.ceil((st.fogUntil - now) / 1000)}s</span>`);
    el.innerHTML = parts.join('');
  },

  /* =================== UI: BOARD ANIMATIONS =================== */
  _pulseFrame(playerId, color, className) {
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    frame.style.setProperty('--item-color', color);
    frame.classList.remove(className); void frame.offsetWidth; frame.classList.add(className);
    setTimeout(() => frame.classList.remove(className), 700);
  },

  _animateBlock(playerId) {
    this._pulseFrame(playerId, ITEM_DEFS.SHIELD.color, 'item-shield-block');
  },

  _showFog(playerId, on) {
    const st = this.state[playerId];
    const frame = document.getElementById('frame' + playerId);
    if (!frame) return;
    let overlay = frame.querySelector('.item-fog-overlay');
    if (on) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'item-fog-overlay';
        frame.appendChild(overlay);
      }
      requestAnimationFrame(() => overlay.classList.add('show'));
      if (st) st._fogShown = true;
    } else if (overlay) {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 500);
      if (st) st._fogShown = false;
    }
  },

  /** Floating icon flying from source player's board to target player's board. */
  _animateFire(sourceId, targetId, def, blocked) {
    const srcFrame = document.getElementById('frame' + sourceId);
    const tgtFrame = document.getElementById('frame' + targetId);
    if (!srcFrame || !tgtFrame) return;
    const a = srcFrame.getBoundingClientRect(), b = tgtFrame.getBoundingClientRect();
    const sx = a.left + a.width / 2, sy = a.top + a.height / 2;
    const tx = b.left + b.width / 2, ty = b.top + b.height / 2;

    const orb = document.createElement('div');
    orb.className = 'item-beam-orb';
    orb.textContent = def.icon;
    orb.style.setProperty('--c', def.color);
    orb.style.left = sx + 'px'; orb.style.top = sy + 'px';
    document.body.appendChild(orb);
    requestAnimationFrame(() => {
      orb.style.left = tx + 'px'; orb.style.top = ty + 'px';
      orb.style.transform = 'translate(-50%,-50%) scale(1.3)';
      orb.style.opacity = blocked ? '0.3' : '0';
    });
    setTimeout(() => orb.remove(), 520);

    if (!blocked) {
      tgtFrame.classList.remove('item-impact'); void tgtFrame.offsetWidth; tgtFrame.classList.add('item-impact');
      setTimeout(() => tgtFrame.classList.remove('item-impact'), 450);
    }
  },

  /** Small burst of the item's icon on the user's own board, for self-use feedback. */
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

  /* =================== STYLE (self-contained, no index.html/CSS edits needed) =================== */
  _injectStyle() {
    if (this._styleInjected) return;
    this._styleInjected = true;
    const css = `
      .item-box.hidden { display: none; }
      .item-slot {
        width: 48px; height: 48px; margin: 0 auto; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.04);
        border: 1.5px dashed rgba(255,255,255,0.18);
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
        animation: itemFrameGlow .7s ease-out;
        position: relative;
      }
      .board-frame.item-column-flash { --item-color: 95,255,143; }
      .board-frame.item-selfuse-flash { --item-color: 196,107,255; }
      .board-frame.item-shield-block { --item-color: 107,214,255; }
      .board-frame.item-impact { animation-duration: .45s; --item-color: 255,84,112; }

      .item-fog-overlay {
        position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
        background: radial-gradient(circle at 50% 40%, rgba(190,190,205,0.05), rgba(190,190,205,0.55));
        backdrop-filter: blur(2px);
        opacity: 0; transition: opacity .45s ease;
        z-index: 5;
      }
      .item-fog-overlay.show { opacity: 1; }

      .item-beam-orb {
        position: fixed; width: 34px; height: 34px; margin-left:-17px; margin-top:-17px;
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        font-size: 20px; pointer-events: none; z-index: 999;
        background: rgba(var(--c,255,255,255),0.25);
        box-shadow: 0 0 18px rgba(var(--c,255,255,255),0.85);
        transform: translate(-50%,-50%) scale(1);
        transition: left .5s cubic-bezier(.3,.6,.4,1), top .5s cubic-bezier(.3,.6,.4,1), opacity .5s ease, transform .5s ease;
      }

      @keyframes itemSelfBurst { 0%{transform:translate(-50%,-50%) scale(0.4);opacity:1;} 100%{transform:translate(-50%,-120%) scale(1.6);opacity:0;} }
      .item-self-burst {
        position: absolute; left:50%; top:50%; font-size: 30px; pointer-events:none; z-index: 6;
        animation: itemSelfBurst .65s ease-out forwards;
        filter: drop-shadow(0 0 10px rgba(var(--c,255,255,255),0.9));
      }
    `;
    const style = document.createElement('style');
    style.id = 'itemsSystemStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }
};
