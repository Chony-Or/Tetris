/**
 * nav.js
 * =====================================================================
 * CONTROLLER-FIRST MENU NAVIGATION
 * ---------------------------------------------------------------------
 * A single generic focus manager used by EVERY overlay in the game
 * (join lobby, start screen, settings, controls reference, pause menu,
 * results screen). No menu-specific navigation code lives anywhere
 * else — a screen becomes controller-navigable just by calling
 * `FocusNav.activate(containerEl)` when it opens and
 * `FocusNav.deactivate()` when it closes.
 *
 * NAVIGATION MODEL — SPATIAL, NOT LINEAR
 * ---------------------------------------------------------------------
 * Earlier versions treated every focusable element in a screen as one
 * flat list, and Up/Down simply stepped through it while Left/Right
 * only adjusted a slider. That made screens with side-by-side controls
 * (e.g. Match Setup's player-count row, or a bot's Easy/Normal/Hard/
 * Expert buttons) impossible to navigate horizontally — you had to
 * cursor past every single item to get from one end of a row to the
 * other.
 *
 * Now each arrow direction looks at the REAL on-screen position of
 * every focusable element and jumps to the nearest one that lies in
 * that direction (a standard "spatial navigation" approach, the same
 * idea TVs/consoles use for D-Pad menu navigation). This means:
 *   - Left/Right on a row of buttons (player-count, difficulty picks)
 *     moves across that row instead of falling through to the next
 *     item down the page.
 *   - Up/Down moves to the nearest item above/below, even if it isn't
 *     perfectly aligned.
 *   - Sliders keep working exactly as before: while a slider has
 *     focus, Left/Right adjusts its value instead of navigating away,
 *     so you don't overshoot into the next row while dragging a value.
 * No per-screen wiring is needed — this is automatic for every overlay
 * that already uses FocusNav.
 *
 * Supported inputs (any connected gamepad, standard mapping, works for
 * Xbox/PlayStation/generic pads since we only use the standard D-Pad,
 * left-stick, A/Cross(0), B/Circle(1), and Start(9) indices):
 *   D-Pad Up/Down/Left/Right or Left Stick -> move selection (spatial)
 *   A / Cross (button 0)                   -> confirm / click
 *   B / Circle (button 1)                  -> back / cancel
 *   Start (button 9)                       -> confirm (pause-equivalent)
 * Keyboard equivalents: Arrow Up/Down/Left/Right, Enter, Escape.
 * =====================================================================
 */
"use strict";

const FocusNav = {
  container: null,
  items: [],
  index: 0,
  onBack: null,
  _stack: [],
  _pollHandle: null,
  _prevButtons: {},

  FOCUSABLE_SELECTOR: '.btn, .count-btn, .icon-btn, .settings-slider, .cs-slot-join, input[type="checkbox"], .results-btn, .tab-btn, .ms-diff-btn',

  init() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    this._pollHandle = requestAnimationFrame(this._loop.bind(this));
  },

  /** Call when an overlay opens. `onBack` is optional — fired on B/Escape. */
  activate(containerEl, onBack) {
    this.container = containerEl;
    this.onBack = onBack || null;
    this.refresh();
  },

  deactivate() {
    if (this.container) this._clearFocusClasses();
    this.container = null;
    this.items = [];
    this.onBack = null;
  },

  /** Like activate(), but remembers the current screen so pop() can return to it (for nested menus e.g. Settings opened from Pause). */
  push(containerEl, onBack) {
    if (this.container) this._stack.push({ container: this.container, index: this.index, onBack: this.onBack });
    this.activate(containerEl, onBack);
  },

  pop() {
    this._clearFocusClasses();
    const prev = this._stack.pop();
    if (prev) {
      this.container = prev.container; this.index = prev.index; this.onBack = prev.onBack;
      this.refresh(true);
    } else {
      this.deactivate();
    }
  },

  /** Re-scan the active container for focusable elements (call after re-rendering its innerHTML). */
  refresh(keepIndex) {
    if (!this.container) return;
    this._clearFocusClasses();
    this.items = Array.from(this.container.querySelectorAll(this.FOCUSABLE_SELECTOR))
      .filter(el => el.offsetParent !== null && !el.disabled);
    this.index = keepIndex && this.index < this.items.length ? this.index : 0;
    this._applyFocus();
  },

  _clearFocusClasses() {
    this.items.forEach(el => el.classList.remove('nav-focus'));
  },

  _applyFocus() {
    this._clearFocusClasses();
    const el = this.items[this.index];
    if (!el) return;
    el.classList.add('nav-focus');
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  },

  /* =================== SPATIAL NAVIGATION =================== */
  /**
   * moveDir(dx, dy) — jump to whichever focusable item best matches the
   * requested direction, based on actual layout position rather than
   * DOM order. dx/dy is one of (-1,0) (1,0) (0,-1) (0,1).
   */
  moveDir(dx, dy) {
    if (this.items.length < 2) return;
    const cur = this.items[this.index];
    if (!cur) return;
    const curRect = cur.getBoundingClientRect();
    const cx = curRect.left + curRect.width / 2;
    const cy = curRect.top + curRect.height / 2;

    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      if (i === this.index) continue;
      const r = this.items[i].getBoundingClientRect();
      const ix = r.left + r.width / 2;
      const iy = r.top + r.height / 2;
      const vx = ix - cx, vy = iy - cy;

      // Primary-axis displacement must point the way that was asked for
      // (allow a little slack so near-aligned items still count).
      const primary = dx !== 0 ? vx * dx : vy * dy;
      if (primary <= 2) continue;

      const perpendicular = dx !== 0 ? Math.abs(vy) : Math.abs(vx);
      // Favor items that are close and well-aligned on the perpendicular
      // axis (e.g. same row for left/right, same column for up/down).
      const score = primary + perpendicular * 2.2;
      if (score < bestScore) { bestScore = score; best = i; }
    }

    if (best === -1) {
      // Nothing lies in that direction (e.g. already at the edge of a
      // row) — fall back to linear wrap for Up/Down only, so Up/Down
      // still always gets you somewhere.
      if (dy !== 0) { this.index = (this.index + dy + this.items.length) % this.items.length; }
      else return;
    } else {
      this.index = best;
    }
    this._applyFocus();
    if (window.AudioManager) AudioManager.navMove();
  },

  confirm() {
    const el = this.items[this.index];
    if (!el) return;
    if (window.AudioManager) AudioManager.navConfirm();
    if (el.tagName === 'INPUT' && el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); return; }
    el.click();
  },

  back() {
    if (window.AudioManager) AudioManager.navBack();
    if (typeof this.onBack === 'function') this.onBack();
  },

  adjustSlider(dir) {
    const el = this.items[this.index];
    if (!el || el.type !== 'range') return;
    const step = Number(el.step) || 5;
    el.value = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * step));
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  },

  /** True when the currently focused item is a slider (Left/Right adjusts it instead of navigating). */
  _onSlider() {
    const el = this.items[this.index];
    return !!el && el.tagName === 'INPUT' && el.type === 'range';
  },

  _onKeyDown(e) {
    if (!this.container) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'ArrowUp') this.moveDir(0, -1);
    else if (e.code === 'ArrowDown') this.moveDir(0, 1);
    else if (e.code === 'ArrowLeft') { if (this._onSlider()) this.adjustSlider(-1); else this.moveDir(-1, 0); }
    else if (e.code === 'ArrowRight') { if (this._onSlider()) this.adjustSlider(1); else this.moveDir(1, 0); }
    else if (e.code === 'Enter' || e.code === 'Space') this.confirm();
    else if (e.code === 'Escape') this.back();
  },

  _loop() {
    if (this.container) this._pollGamepads();
    this._pollHandle = requestAnimationFrame(this._loop.bind(this));
  },

  _pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const prev = this._prevButtons[i] || [];
      const pressed = (bi) => pad.buttons[bi] && pad.buttons[bi].pressed;
      const justPressed = (bi) => pressed(bi) && !prev[bi];

      if (justPressed(0)) this.confirm();          // A / Cross
      if (justPressed(1)) this.back();              // B / Circle
      // NOTE: Start (button 9) is intentionally NOT wired to confirm() here.
      // The join lobby (controllerSetup.js) and in-match pause toggle
      // (GamepadSystem) each already have their own dedicated Start-button
      // handling. Having FocusNav ALSO treat Start as a generic confirm
      // caused both handlers to fire in the same frame — double-triggering
      // ControllerSetup.finish() or MatchManager.togglePause()/resumeFromPause()
      // — which is what made "Start Match" and "Pause" feel intermittently
      // broken. A / Cross (button 0) remains the sole generic confirm button.

      const axisY = pad.axes[1] || 0;
      const axisX = pad.axes[0] || 0;
      const dpadUp = pressed(12), dpadDown = pressed(13), dpadLeft = pressed(14), dpadRight = pressed(15);
      const up = dpadUp || axisY < -0.55;
      const down = dpadDown || axisY > 0.55;
      const left = dpadLeft || axisX < -0.55;
      const right = dpadRight || axisX > 0.55;

      const wasUp = prev._up, wasDown = prev._down, wasLeft = prev._left, wasRight = prev._right;
      if (up && !wasUp) this.moveDir(0, -1);
      if (down && !wasDown) this.moveDir(0, 1);
      if (left && !wasLeft) { if (this._onSlider()) this.adjustSlider(-1); else this.moveDir(-1, 0); }
      if (right && !wasRight) { if (this._onSlider()) this.adjustSlider(1); else this.moveDir(1, 0); }

      const snapshot = pad.buttons.map(b => b.pressed);
      snapshot._up = up; snapshot._down = down; snapshot._left = left; snapshot._right = right;
      this._prevButtons[i] = snapshot;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => FocusNav.init());
