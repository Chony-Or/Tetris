/**
 * matchSetup.js
 * =====================================================================
 * MATCH SETUP SCREEN — HUMAN + OPTIONAL AI BOT SLOTS
 * ---------------------------------------------------------------------
 * Runs right after the "press any button to join" lobby (controllerSetup.js)
 * has finished collecting human players. It never changes who the humans
 * are or which device they claimed — it only decides the overall match
 * size (1-4) and, for any slots beyond the humans who joined, whether
 * that slot is an AI bot (and at what difficulty) or simply left out of
 * the match entirely.
 *
 * Design notes:
 *  - The game must never force all 4 slots to be occupied — match size
 *    is an explicit choice here, defaulting to "just the humans who
 *    joined" (or the last size used, if it still fits).
 *  - A slot beyond the chosen match size is never turned into a Player
 *    object at all (see MatchManager.setupPlayers in game.js) — there
 *    is no "inactive player" to update, render, or run AI for, so an
 *    unused slot costs nothing rather than needing to be specially
 *    skipped every frame.
 *  - Match size + per-slot bot difficulty persist across sessions via
 *    localStorage, the same pattern AudioManager/MatchManager already
 *    use elsewhere in this project.
 * =====================================================================
 */
"use strict";

const MatchSetupMenu = {
  MAX_SLOTS: 4,
  DIFFICULTIES: ['easy', 'normal', 'hard', 'expert'],
  STORAGE_KEY: 'tetrisai.matchSetup',

  els: {},
  humanAssignments: [],
  matchSize: 2,
  botDifficulty: {}, // 0-based slot index (>= human count) -> difficulty string
  onComplete: null,
  _savedMatchSize: null,
  _savedBotDifficulty: null,

  init() {
    if (document.getElementById('matchSetupOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay hidden';
    overlay.id = 'matchSetupOverlay';
    overlay.innerHTML = `
      <div class="logo" style="font-size:30px;">MATCH SETUP</div>
      <div class="overlay-sub" id="msSub" style="max-width:640px;"></div>
      <div class="player-count-select" id="msSizeSelect"></div>
      <div class="cs-list ms-slot-list" id="msSlotList"></div>
      <button class="btn primary" id="msStartBtn">Start Match</button>
      <div class="controls-hint" style="max-width:560px;">Bots play by the same rules as everyone else — same gravity, collisions, and lock delay. Higher difficulty means faster, sharper play.</div>
    `;
    document.body.appendChild(overlay);
    this.els.overlay = overlay;
    this.els.sizeSelect = overlay.querySelector('#msSizeSelect');
    this.els.slotList = overlay.querySelector('#msSlotList');
    this.els.sub = overlay.querySelector('#msSub');
    overlay.querySelector('#msStartBtn').addEventListener('click', () => this._finish());
  },

  _loadSaved() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Number.isFinite(s.matchSize)) this._savedMatchSize = s.matchSize;
        if (s.botDifficulty && typeof s.botDifficulty === 'object') this._savedBotDifficulty = s.botDifficulty;
      }
    } catch (e) { /* ignore corrupt settings */ }
  },

  _save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
        matchSize: this.matchSize,
        botDifficulty: this.botDifficulty
      }));
    } catch (e) { /* storage unavailable — ignore */ }
  },

  /**
   * show(humanAssignments, onComplete)
   * humanAssignments: the assignments array ControllerSetup.finish()
   *   produced (each already has a confirmed device — keyboard layout
   *   or a specific gamepad index). onComplete(finalCount, finalAssignments)
   *   fires once the player confirms, with bot slots appended.
   */
  show(humanAssignments, onComplete) {
    this.init();
    this._loadSaved();
    this.humanAssignments = humanAssignments;
    this.onComplete = onComplete;
    const humanCount = humanAssignments.length;
    // Match size can never be smaller than the number of humans who
    // already joined, and defaults to the last-used size when it still
    // fits, otherwise just the humans themselves.
    this.matchSize = Math.max(humanCount, Math.min(this.MAX_SLOTS, this._savedMatchSize || humanCount));
    this.botDifficulty = {};
    for (let i = humanCount; i < this.MAX_SLOTS; i++) {
      this.botDifficulty[i] = (this._savedBotDifficulty && this._savedBotDifficulty[i]) || 'normal';
    }
    this._render();
    this.els.overlay.classList.remove('hidden');
    FocusNav.push(this.els.overlay, () => {
      // Back out of Match Setup returns to the join lobby so humans can
      // add/remove devices before trying again.
      this.els.overlay.classList.add('hidden');
      FocusNav.pop();
      ControllerSetup.show();
    });
  },

  _render() {
    const humanCount = this.humanAssignments.length;
    const botCount = this.matchSize - humanCount;
    this.els.sub.textContent = botCount === 0
      ? `${humanCount} human player${humanCount === 1 ? '' : 's'} joined. Add AI bots below, or start as-is.`
      : `${humanCount} human player${humanCount === 1 ? '' : 's'} joined, plus ${botCount} bot${botCount === 1 ? '' : 's'}.`;

    this.els.sizeSelect.innerHTML = [1, 2, 3, 4].map(n => {
      const disabled = n < humanCount;
      return `<button class="count-btn ${n === this.matchSize ? 'active' : ''}" data-size="${n}" ${disabled ? 'disabled' : ''}>${n}</button>`;
    }).join('');
    this.els.sizeSelect.querySelectorAll('.count-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        this.matchSize = Number(btn.dataset.size);
        if (window.AudioManager) AudioManager.buttonClick();
        this._render();
      });
    });

    let rows = '';
    for (let i = 0; i < this.MAX_SLOTS; i++) {
      const num = i + 1;
      const color = PLAYER_COLORS[i];
      if (i < humanCount) {
        const a = this.humanAssignments[i];
        rows += `<div class="cs-row cs-row-final ms-slot-row"><b style="color:${color}">PLAYER ${num}</b> — ${a.label} (Human)</div>`;
      } else if (i < this.matchSize) {
        const diff = this.botDifficulty[i] || 'normal';
        const diffBtns = this.DIFFICULTIES.map(d =>
          `<button class="btn ms-diff-btn ${d === diff ? 'primary' : ''}" data-slot="${i}" data-diff="${d}">${d[0].toUpperCase() + d.slice(1)}</button>`
        ).join('');
        rows += `<div class="cs-row cs-row-final ms-slot-row ms-bot-row">
          <span class="ms-slot-name" style="color:${color}">PLAYER ${num}</span>
          <span class="ms-slot-type">BOT</span>
          <div class="ms-diff-group">${diffBtns}</div>
        </div>`;
      } else {
        rows += `<div class="cs-row ms-slot-row ms-inactive-row">PLAYER ${num} — Inactive</div>`;
      }
    }
    this.els.slotList.innerHTML = rows;
    this.els.slotList.querySelectorAll('.ms-diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const slot = Number(btn.dataset.slot);
        this.botDifficulty[slot] = btn.dataset.diff;
        if (window.AudioManager) AudioManager.buttonClick();
        this._render();
      });
    });
    FocusNav.refresh(true);
  },

  _finish() {
    const assignments = this.humanAssignments.slice();
    for (let i = this.humanAssignments.length; i < this.matchSize; i++) {
      const diff = this.botDifficulty[i] || 'normal';
      const label = 'BOT (' + diff[0].toUpperCase() + diff.slice(1) + ')';
      assignments.push({ type: 'bot', difficulty: diff, label });
    }
    this._save();
    if (window.AudioManager) AudioManager.buttonClick();
    this.els.overlay.classList.add('hidden');
    FocusNav.pop();
    const size = this.matchSize;
    const complete = this.onComplete;
    this.onComplete = null;
    if (complete) complete(size, assignments);
  }
};
