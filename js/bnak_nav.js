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
 * Supported inputs (any connected gamepad, standard mapping, works for
 * Xbox/PlayStation/generic pads since we only use the standard D-Pad,
 * left-stick, A/Cross(0), B/Circle(1), and Start(9) indices):
 *   D-Pad Up/Down or Left Stick Up/Down  -> move selection
 *   D-Pad Left/Right or Left Stick L/R   -> adjust focused slider
 *   A / Cross (button 0)                 -> confirm / click
 *   B / Circle (button 1)                -> back / cancel
 *   Start (button 9)                     -> confirm (pause-equivalent)
 *   Left/Right bumper (4/5)              -> switch tab, where present
 * Keyboard equivalents: Arrow Up/Down, Arrow Left/Right, Enter, Escape.
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
  _repeatTimer: 0,
  _repeatDir: 0,

  FOCUSABLE_SELECTOR: '.btn, .count-btn, .icon-btn, .settings-slider, .cs-slot-join, input[type="checkbox"], .results-btn, .tab-btn',

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

  move(delta) {
    if (!this.items.length) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
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

  _onKeyDown(e) {
    if (!this.container) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'ArrowUp') this.move(-1);
    else if (e.code === 'ArrowDown') this.move(1);
    else if (e.code === 'ArrowLeft') this.adjustSlider(-1);
    else if (e.code === 'ArrowRight') this.adjustSlider(1);
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
      if (justPressed(1) || justPressed(9)) {       // B / Circle, or Start-as-back on some flows
        if (justPressed(1)) this.back();
      }
      if (justPressed(9) && !justPressed(1)) this.confirm(); // Start also confirms/starts

      const axisY = pad.axes[1] || 0;
      const dpadUp = pressed(12), dpadDown = pressed(13), dpadLeft = pressed(14), dpadRight = pressed(15);
      const up = dpadUp || axisY < -0.55;
      const down = dpadDown || axisY > 0.55;
      const left = dpadLeft || (pad.axes[0] || 0) < -0.55;
      const right = dpadRight || (pad.axes[0] || 0) > 0.55;

      const wasUp = prev._up, wasDown = prev._down, wasLeft = prev._left, wasRight = prev._right;
      if (up && !wasUp) this.move(-1);
      if (down && !wasDown) this.move(1);
      if (left && !wasLeft) this.adjustSlider(-1);
      if (right && !wasRight) this.adjustSlider(1);

      const snapshot = pad.buttons.map(b => b.pressed);
      snapshot._up = up; snapshot._down = down; snapshot._left = left; snapshot._right = right;
      this._prevButtons[i] = snapshot;
    }
  }
};

document.addEventListener('DOMContentLoaded', () => FocusNav.init());
