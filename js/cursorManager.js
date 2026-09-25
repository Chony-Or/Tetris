/**
 * cursorManager.js
 * =====================================================================
 * AUTO-HIDE MOUSE CURSOR DURING GAMEPLAY
 * ---------------------------------------------------------------------
 * The game is designed to be played entirely without a mouse ("No mouse
 * required anywhere in the game" — see the start screen), so a cursor
 * sitting idle over the boards during an active match is just visual
 * noise. This hides it after ~1s of no mouse activity, but ONLY while a
 * match is actively being played.
 *
 * Rather than wiring per-screen show/hide calls into every menu (start
 * screen, join lobby, match setup, settings, controls, pause, results —
 * see the feature request's screen list), this keys off the single
 * source of truth every one of those screens already implies:
 * MatchManager.state. The cursor is only ever hidden while
 * state === 'playing'; every other state (waiting/countdown/paused/
 * finished) leaves it alone. That also makes the edge cases fall out
 * for free — pausing, resuming, a match ending, alt-tabbing away and
 * back — because they're all just MatchManager state transitions (or,
 * for tab/focus changes, handled explicitly below).
 * =====================================================================
 */
"use strict";

const CursorManager = {
  IDLE_MS: 1000,
  hideTimer: null,
  hidden: false,

  init() {
    ['mousemove', 'mousedown', 'wheel'].forEach(evt =>
      document.addEventListener(evt, () => this._onActivity(), { passive: true })
    );
    // Alt-tabbing out (or the tab/window losing focus another way) should
    // never leave the cursor invisible somewhere the user can't find it.
    window.addEventListener('blur', () => this._forceShow());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._forceShow(); });

    this._armTimer();
    // A lightweight per-frame check (piggybacking on rAF, not a second
    // timer system) so the cursor snaps back the INSTANT gameplay stops
    // being active — e.g. pressing Escape to pause, a controller's Start
    // button, or a match ending — even with zero mouse movement, rather
    // than waiting for the next mousemove to notice.
    requestAnimationFrame(this._poll.bind(this));
  },

  _onActivity() {
    this._show();
    this._armTimer();
  },

  _armTimer() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (typeof MatchManager !== 'undefined' && MatchManager.state === 'playing') this._hide();
    }, this.IDLE_MS);
  },

  _poll() {
    if (this.hidden && (typeof MatchManager === 'undefined' || MatchManager.state !== 'playing')) {
      this._show();
    }
    requestAnimationFrame(this._poll.bind(this));
  },

  _hide() {
    if (this.hidden) return;
    this.hidden = true;
    document.body.classList.add('cursor-hidden');
  },

  _show() {
    if (!this.hidden) return;
    this.hidden = false;
    document.body.classList.remove('cursor-hidden');
  },

  _forceShow() {
    this._show();
    this._armTimer(); // re-arm so refocusing without further movement still hides again, if still mid-match
  }
};

document.addEventListener('DOMContentLoaded', () => CursorManager.init());
