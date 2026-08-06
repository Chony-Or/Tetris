/**
 * controllerSetup.js
 * =====================================================================
 * "PRESS ANY BUTTON TO JOIN" LOBBY
 * ---------------------------------------------------------------------
 * Replaces the old sequential controller-confirmation flow with a
 * dynamic join lobby, matching how modern local-multiplayer arcade
 * games onboard players:
 *
 *   - Up to 4 slots. Any unclaimed keyboard layout (KB1/KB2) or gamepad
 *     fires a slot claim the instant it sends its first input.
 *   - Slots fill visually the moment a device joins, with an icon
 *     (gamepad vs keyboard), an auto-assigned player color, and a
 *     "press [B] / Backspace to leave" hint.
 *   - A device can never occupy two slots (duplicate-assignment guard).
 *   - Players can leave before the match starts (gamepad B/Back button
 *     on their own pad, or Backspace for the most-recently-joined
 *     keyboard layout, or a mouse click on the slot as a fallback).
 *   - Hot-plugging works the whole time the lobby is open — connecting
 *     a new gamepad mid-lobby immediately becomes joinable.
 *   - "Start Match" appears once >=1 slot is filled and can be
 *     triggered from any joined controller's Start button, Enter on
 *     keyboard, or a click — fully navigable via FocusNav either way.
 *
 * onComplete(playerCount, assignments) fires with the same shape the
 * rest of the game (MatchManager.setupPlayers) already expects, so
 * nothing downstream needed to change.
 * =====================================================================
 */
"use strict";

const ControllerSetup = {
  MAX_SLOTS: 4,
  slots: [null, null, null, null], // each: { type:'keyboard'|'gamepad', keyboardKey, gamepadIndex, profileKey, label, icon }
  onComplete: null,
  active: false,
  _pollHandle: null,
  _prevButtons: {},
  _lastKeyboardSlotIndex: -1,

  els: {},

  init(onComplete) {
    this.onComplete = onComplete;
    this.els.root = document.getElementById('controllerSetupOverlay');
    this.els.grid = document.getElementById('joinGrid');
    this.els.startBtn = document.getElementById('csStartGameBtn');
    this.els.sub = document.getElementById('lobbySub');

    this.els.startBtn.addEventListener('click', () => this.finish());

    window.addEventListener('gamepadconnected', () => this._renderGrid());
    window.addEventListener('gamepaddisconnected', (e) => this._handleGamepadDisconnect(e.gamepad.index));
  },

  show() {
    this.reset();
    this.active = true;
    this.els.root.classList.remove('hidden');
    this._renderGrid();
    this._startPolling();
    FocusNav.activate(this.els.root, () => { /* no-op: Back on lobby does nothing destructive */ });
    document.getElementById('hintBar').classList.add('show');
  },

  hide() {
    this.active = false;
    this.els.root.classList.add('hidden');
    this._stopPolling();
    FocusNav.deactivate();
    document.getElementById('hintBar').classList.remove('show');
  },

  reset() {
    this.slots = [null, null, null, null];
    this._lastKeyboardSlotIndex = -1;
    this._prevButtons = {};
  },

  /* =================== RENDER =================== */
  _renderGrid() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.els.grid.innerHTML = this.slots.map((s, i) => {
      const num = i + 1;
      if (!s) {
        return `<div class="join-slot" id="joinSlot${num}">
          <div class="slot-num">PLAYER ${num}</div>
          <div class="slot-icon">➕</div>
          <div class="slot-label">Press any button<br>to join</div>
        </div>`;
      }
      const color = (typeof PLAYER_COLORS !== 'undefined') ? PLAYER_COLORS[i] : '#ffd25f';
      const connected = s.type === 'gamepad' ? !!pads[s.gamepadIndex] : true;
      const icon = s.type === 'gamepad' ? '🎮' : '⌨';
      return `<div class="join-slot filled pulse" id="joinSlot${num}" style="border-color:${color};box-shadow:0 0 18px ${color}55;">
        <div class="slot-num" style="color:${color};">PLAYER ${num}</div>
        <div class="slot-icon">${icon}</div>
        <div class="slot-label">${s.label}${connected ? '' : ' <span style="color:var(--danger)">(disconnected)</span>'}</div>
        <div class="slot-leave">${s.type === 'gamepad' ? '[B] to leave' : 'Backspace to leave'}</div>
      </div>`;
    }).join('');

    // Mouse fallback: click a filled slot to leave (controller/keyboard remain fully sufficient without this).
    this.slots.forEach((s, i) => {
      if (!s) return;
      const el = document.getElementById('joinSlot' + (i + 1));
      if (el) el.addEventListener('click', () => this._leaveSlot(i));
    });

    const filledCount = this.slots.filter(Boolean).length;
    this.els.startBtn.classList.toggle('hidden', filledCount === 0);
    this.els.sub.textContent = filledCount === 0
      ? 'Press any button on a controller, or a movement key on a keyboard layout, to claim a player slot.'
      : `${filledCount} player${filledCount > 1 ? 's' : ''} joined. Press Start on your controller, or click Start Match, when ready.`;

    FocusNav.refresh(true);
  },

  /* =================== JOIN / LEAVE =================== */
  _firstOpenSlot() { return this.slots.findIndex(s => s === null); },

  _joinKeyboard(kbKey) {
    if (this.slots.some(s => s && s.type === 'keyboard' && s.keyboardKey === kbKey)) return; // already joined
    const idx = this._firstOpenSlot();
    if (idx === -1) return;
    const map = KEYBOARD_MAPS[kbKey];
    this.slots[idx] = { type: 'keyboard', keyboardKey: kbKey, label: map.label };
    this._lastKeyboardSlotIndex = idx;
    this._onJoined(idx);
  },

  _joinGamepad(padIndex, pad) {
    if (this.slots.some(s => s && s.type === 'gamepad' && s.gamepadIndex === padIndex)) return; // already joined
    const idx = this._firstOpenSlot();
    if (idx === -1) return;
    const { key, profile } = detectControllerProfile(pad);
    this.slots[idx] = { type: 'gamepad', gamepadIndex: padIndex, profileKey: key, label: `${profile.label} (pad ${padIndex})` };
    if (typeof vibrationManager !== 'undefined') {
      vibrationManager.assignController(idx + 1, padIndex);
      vibrationManager.rumblePlayer(idx + 1, RUMBLE_PROFILES.CONTROLLER_ASSIGNED);
    }
    this._onJoined(idx);
  },

  _onJoined(idx) {
    if (window.AudioManager) AudioManager.playerJoin();
    this._renderGrid();
    const el = document.getElementById('joinSlot' + (idx + 1));
    if (el) { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  },

  _leaveSlot(idx) {
    if (!this.slots[idx]) return;
    this.slots[idx] = null;
    if (window.AudioManager) AudioManager.playerLeave();
    this._renderGrid();
  },

  _handleGamepadDisconnect(padIndex) {
    const idx = this.slots.findIndex(s => s && s.type === 'gamepad' && s.gamepadIndex === padIndex);
    if (idx !== -1 && this.active) this._renderGrid(); // keep the slot but show "(disconnected)"; they can still start
  },

  /* =================== INPUT POLLING (join lobby only) =================== */
  _startPolling() {
    this._keydownHandler = (e) => this._onKeyDown(e.code);
    window.addEventListener('keydown', this._keydownHandler);
    const loop = () => {
      if (!this.active) return;
      this._pollGamepads();
      this._pollHandle = requestAnimationFrame(loop);
    };
    this._pollHandle = requestAnimationFrame(loop);
  },

  _stopPolling() {
    if (this._pollHandle) cancelAnimationFrame(this._pollHandle);
    this._pollHandle = null;
    if (this._keydownHandler) window.removeEventListener('keydown', this._keydownHandler);
    this._keydownHandler = null;
  },

  _onKeyDown(code) {
    if (!this.active) return;
    if (code === 'Backspace') {
      if (this._lastKeyboardSlotIndex !== -1 && this.slots[this._lastKeyboardSlotIndex]) {
        this._leaveSlot(this._lastKeyboardSlotIndex);
        this._lastKeyboardSlotIndex = -1;
      }
      return;
    }
    if (code === 'Enter') { this.finish(); return; }
    for (const kbKey of Object.keys(KEYBOARD_MAPS)) {
      const map = KEYBOARD_MAPS[kbKey];
      const relevantCodes = [map.left, map.right, map.soft, map.hard, map.ccw, map.cw, map.hold];
      if (relevantCodes.includes(code)) { this._joinKeyboard(kbKey); return; }
    }
  },

  _pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const prev = this._prevButtons[i] || [];
      const joinedIdx = this.slots.findIndex(s => s && s.type === 'gamepad' && s.gamepadIndex === i);

      pad.buttons.forEach((btn, bi) => {
        const wasPressed = !!prev[bi];
        if (btn.pressed && !wasPressed) {
          if (joinedIdx === -1) {
            this._joinGamepad(i, pad);
          } else if (bi === 1 || bi === 8) { // B / Circle or Back-Select = leave
            this._leaveSlot(joinedIdx);
          } else if (bi === 9) { // Start = begin match
            this.finish();
          }
        }
      });
      this._prevButtons[i] = pad.buttons.map(b => b.pressed);
    }
  },

  /* =================== START MATCH =================== */
  finish() {
    const joined = this.slots.map((s, i) => s ? { ...s } : null).filter(Boolean);
    if (joined.length === 0) return;
    // Renumber sequentially (1..N) in slot order so downstream code (which assumes
    // player ids 1..N with no gaps) keeps working regardless of which slots were used.
    const assignments = joined.map((a) => a);
    this.hide();
    if (this.onComplete) this.onComplete(assignments.length, assignments);
  }
};
