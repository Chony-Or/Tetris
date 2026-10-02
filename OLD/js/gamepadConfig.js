/**
 * gamepadConfig.js
 * =====================================================================
 * CENTRALIZED CONTROLLER MAPPING
 * ---------------------------------------------------------------------
 * This is the ONLY file you should need to touch to change what button
 * does what on a controller, or to add a new controller profile.
 *
 * Every button index below refers to the standard HTML5 Gamepad API
 * "standard" mapping layout (the same layout Chrome/Edge normalize
 * Xbox and most USB pads to):
 *
 *   0  = Face button A / Bottom face button
 *   1  = Face button B / Right face button
 *   2  = Face button X / Left face button
 *   3  = Face button Y / Top face button
 *   4  = Left bumper  (LB)
 *   5  = Right bumper (RB)
 *   6  = Left trigger  (LT)
 *   7  = Right trigger (RT)
 *   8  = Back / Select / View
 *   9  = Start / Menu
 *   10 = Left stick click
 *   11 = Right stick click
 *   12 = D-Pad Up
 *   13 = D-Pad Down
 *   14 = D-Pad Left
 *   15 = D-Pad Right
 * =====================================================================
 */

// =====================================================================
// CONTROLLER BUTTON MAPPINGS
// EDIT THIS SECTION TO CHANGE BUTTON ASSIGNMENTS
// File: js/gamepadConfig.js | Section: CONTROLLER_PROFILES
// =====================================================================
const CONTROLLER_PROFILES = {
  // Standard Xbox-family controllers (Xbox One / Series / 360 via xinput)
  XBOX: {
      label: 'Xbox Controller',
      LEFT_STICK_X: 0,
      LEFT_STICK_Y: 1,

      ROTATE_CW: 0,
      ROTATE_CCW: 1,
      HOLD: [4, 5, 6, 7],
      HARD_DROP: [12,2],
      SOFT_DROP_BTNS: [13],
      LEFT: 14,
      RIGHT: 15,
      PAUSE: 9,
      CONFIRM: 0,
      BACK: 1
  },

  // Generic / unbranded USB controllers (SNES-style USB pads, no-name gamepads, etc.)
  GENERIC: {
      label: 'Generic Controller',
      LEFT_STICK_X: 0,
      LEFT_STICK_Y: 1,
      RIGHT_STICK_X: 2,
      RIGHT_STICK_Y: 3,
      ROTATE_CW: 2,
      ROTATE_CCW: 1,
      HOLD: [4, 5, 6, 7],
      HARD_DROP: [12,3],
      SOFT_DROP_BTNS: [13],
      LEFT: 14,
      RIGHT: 15,
      PAUSE: 9,
      CONFIRM: 0,
      BACK: 1
  },
};

// Analog stick deadzone used as a fallback for LEFT/RIGHT movement on pads
// whose D-Pad reports as axes instead of buttons.
const STICK_DEADZONE = 0.4;

/**
 * detectControllerProfile(gamepad)
 * ---------------------------------------------------------------------
 * Chooses which CONTROLLER_PROFILES entry to use for a physical gamepad,
 * based on the gamepad's reported `id` string (vendor/product info is
 * embedded in this string by the browser, e.g. "Xbox 360 Controller
 * (STANDARD GAMEPAD Vendor: 045e Product: 028e)").
 *
 * Falls back to GENERIC and logs a console warning if the controller
 * can't be confidently identified as Xbox-family.
 */
function detectControllerProfile(gamepad) {
  if (!gamepad || !gamepad.id) {
    console.warn('[gamepadConfig] No gamepad id available, defaulting to GENERIC profile.');
    return { key: 'GENERIC', profile: CONTROLLER_PROFILES.GENERIC };
  }
  const id = gamepad.id.toLowerCase();
  const looksXbox = id.includes('xbox') || id.includes('xinput') || id.includes('045e'); // 045e = Microsoft vendor ID
  if (looksXbox) {
    return { key: 'XBOX', profile: CONTROLLER_PROFILES.XBOX };
  }
  console.warn(`[gamepadConfig] Unrecognized controller "${gamepad.id}" — using GENERIC profile.`);
  return { key: 'GENERIC', profile: CONTROLLER_PROFILES.GENERIC };
}

/**
 * KEYBOARD_MAPS
 * ---------------------------------------------------------------------
 * Keyboard is treated as its own "controller" that can only be assigned
 * to Player 1 or Player 2 (two physical key clusters share one keyboard).
 * Edit these to change keyboard bindings.
 * =====================================================================
 * EDIT THIS SECTION TO CHANGE KEYBOARD ASSIGNMENTS
 * File: js/gamepadConfig.js | Section: KEYBOARD_MAPS
 * =====================================================================
 */
const KEYBOARD_MAPS = {
  KB1: {
    label: 'Keyboard (WASD)',
    left: 'KeyA', right: 'KeyD', soft: 'KeyS', hard: 'KeyW',
    ccw: 'KeyQ', cw: 'KeyE', hold: 'ShiftLeft', pause: 'Escape'
  },
  KB2: {
    label: 'Keyboard (Arrows)',
    left: 'ArrowLeft', right: 'ArrowRight', soft: 'ArrowDown', hard: 'ArrowUp',
    ccw: 'Comma', cw: 'Period', hold: 'ShiftRight', pause: 'Escape'
  }
};
