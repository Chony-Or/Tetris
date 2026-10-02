/**
 * VibrationManager.js
 * =====================================================================
 * Centralizes ALL controller rumble/vibration requests.
 *
 * Responsibilities:
 *  - Track which physical gamepad (by index) is assigned to which player.
 *  - Fire vibrationActuator.playEffect() requests for that player's pad.
 *  - Debounce/prevent duplicate vibration spam (e.g. many small attacks
 *    landing in the same frame).
 *  - Gracefully no-op (never throw) when vibration isn't supported.
 * =====================================================================
 */

// =====================================================================
// VIBRATION SETTINGS
// EDIT HERE TO CHANGE RUMBLE STRENGTH
// File: js/VibrationManager.js | Section: RUMBLE_PROFILES
// =====================================================================
const RUMBLE_PROFILES = {
  // Attack-sent rumble, keyed by number of lines cleared / attack type
  ATTACK: {
    SINGLE: { duration: 100, weakMagnitude: 0.3, strongMagnitude: 0.3 },
    DOUBLE: { duration: 150, weakMagnitude: 0.5, strongMagnitude: 0.5 },
    TRIPLE: { duration: 200, weakMagnitude: 0.7, strongMagnitude: 0.7 },
    TETRIS: { duration: 300, weakMagnitude: 1.0, strongMagnitude: 1.0 },
    COMBO_BONUS: { duration: 120, weakMagnitude: 0.4, strongMagnitude: 0.6 }, // layered on top of base attack
    B2B_TETRIS: { duration: 380, weakMagnitude: 1.0, strongMagnitude: 1.0 }   // stronger than a normal Tetris
  },
  // Incoming-garbage sequence: a light warning pulse, then a harder impact
  // pulse once the garbage rows are actually inserted.
  GARBAGE_WARNING: { duration: 90, weakMagnitude: 0.25, strongMagnitude: 0.15 },
  GARBAGE_IMPACT_SMALL: { duration: 150, weakMagnitude: 0.5, strongMagnitude: 0.4 },
  GARBAGE_IMPACT_LARGE: { duration: 400, weakMagnitude: 1.0, strongMagnitude: 1.0 }, // "strongest vibration profile"
  // Misc lifecycle events
  GAME_START: { duration: 150, weakMagnitude: 0.4, strongMagnitude: 0.4 },
  PAUSE: { duration: 60, weakMagnitude: 0.3, strongMagnitude: 0.1 },
  RESUME: { duration: 60, weakMagnitude: 0.3, strongMagnitude: 0.1 },
  GAME_OVER: { duration: 500, weakMagnitude: 0.8, strongMagnitude: 0.9 },
  VICTORY: [ // pattern: a short array of pulses played in sequence
    { duration: 120, weakMagnitude: 0.6, strongMagnitude: 0.6, delayAfter: 80 },
    { duration: 120, weakMagnitude: 0.7, strongMagnitude: 0.7, delayAfter: 80 },
    { duration: 260, weakMagnitude: 1.0, strongMagnitude: 1.0, delayAfter: 0 }
  ],
  CONTROLLER_CONNECTED: { duration: 80, weakMagnitude: 0.3, strongMagnitude: 0.2 },
  CONTROLLER_ASSIGNED: { duration: 100, weakMagnitude: 0.5, strongMagnitude: 0.3 }
};

// Minimum ms between two vibration calls on the *same* pad, to stop spam
// when several small events land almost simultaneously.
const VIBRATION_COOLDOWN_MS = 60;

class VibrationManager {
  constructor() {
    // playerId -> physical gamepad index (set during controller setup)
    this.playerToGamepadIndex = new Map();
    // gamepadIndex -> timestamp of last vibration fired
    this.lastFireTime = new Map();
  }

  /** Called once during the controller-confirmation flow. */
  assignController(playerId, gamepadIndex) {
    this.playerToGamepadIndex.set(playerId, gamepadIndex);
  }

  clearAssignments() {
    this.playerToGamepadIndex.clear();
    this.lastFireTime.clear();
  }

  /**
   * rumblePlayer(playerId, profile)
   * profile: either a single {duration, weakMagnitude, strongMagnitude}
   * object, or an array of such objects to be played as a sequence.
   */
  rumblePlayer(playerId, profile) {
    if (!profile) return;
    const gamepadIndex = this.playerToGamepadIndex.get(playerId);
    if (gamepadIndex === undefined) return; // player has no assigned pad (keyboard-only)

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[gamepadIndex];
    if (!pad || !pad.vibrationActuator) return; // unsupported — silently no-op

    const now = performance.now();
    const last = this.lastFireTime.get(gamepadIndex) || 0;
    if (now - last < VIBRATION_COOLDOWN_MS) return; // debounce spam
    this.lastFireTime.set(gamepadIndex, now);

    if (Array.isArray(profile)) {
      this._playSequence(pad, profile, 0);
    } else {
      this._playOnce(pad, profile);
    }
  }

  _playOnce(pad, p) {
    try {
      // playEffect returns a Promise; we deliberately don't await it so
      // rumble calls never block game logic. Any rejection (unsupported
      // browser, pad disconnected mid-call, etc.) is swallowed here so
      // it can never surface as an unhandled error.
      pad.vibrationActuator.playEffect('dual-rumble', {
        duration: p.duration,
        weakMagnitude: p.weakMagnitude,
        strongMagnitude: p.strongMagnitude
      }).catch(() => { /* vibration not supported on this pad — ignore */ });
    } catch (e) {
      // Some browsers throw synchronously instead of rejecting; ignore either way.
    }
  }

  _playSequence(pad, steps, i) {
    if (i >= steps.length) return;
    const step = steps[i];
    this._playOnce(pad, step);
    const delay = (step.duration || 0) + (step.delayAfter || 0);
    setTimeout(() => this._playSequence(pad, steps, i + 1), delay);
  }

  /** Convenience wrapper for the attack-clear rumble tables. */
  rumbleAttack(playerId, linesCleared, isB2BTetris) {
    let base;
    if (isB2BTetris) base = RUMBLE_PROFILES.ATTACK.B2B_TETRIS;
    else if (linesCleared >= 4) base = RUMBLE_PROFILES.ATTACK.TETRIS;
    else if (linesCleared === 3) base = RUMBLE_PROFILES.ATTACK.TRIPLE;
    else if (linesCleared === 2) base = RUMBLE_PROFILES.ATTACK.DOUBLE;
    else if (linesCleared === 1) base = RUMBLE_PROFILES.ATTACK.SINGLE;
    if (base) this.rumblePlayer(playerId, base);
  }

  rumbleCombo(playerId) {
    this.rumblePlayer(playerId, RUMBLE_PROFILES.ATTACK.COMBO_BONUS);
  }

  rumbleGarbageWarning(playerId) {
    this.rumblePlayer(playerId, RUMBLE_PROFILES.GARBAGE_WARNING);
  }

  rumbleGarbageImpact(playerId, amount) {
    this.rumblePlayer(playerId, amount >= 6 ? RUMBLE_PROFILES.GARBAGE_IMPACT_LARGE : RUMBLE_PROFILES.GARBAGE_IMPACT_SMALL);
  }
}

// Single shared instance used across the whole app.
const vibrationManager = new VibrationManager();
