# MIS TETRIS AI

A browser-based local multiplayer Tetris game built with plain HTML, CSS, and JavaScript. The project supports 1 to 4 players, keyboard controls, gamepad support, procedural audio, visual effects, split-screen gameplay, and a full menu system.

## Project Overview

This project is a styled arcade-inspired Tetris experience designed for local play. Players can join from either keyboard layouts or connected controllers, battle in the same match, and trigger garbage attacks, combos, T-spin bonuses, and back-to-back chains.

The game includes:

- Local multiplayer for 1-4 players
- Keyboard and gamepad input support
- Dynamic match setup and lobby flow
- Pause, settings, and result screens
- Audio synthesis without external asset files
- Visual effects and animated background layers
- Adjustable match difficulty settings
- Saveable settings using browser localStorage

## Main Features

### Gameplay

- Classic falling-block mechanics with locking, ghost piece preview, and hold system
- Bag-based randomizer for fair piece distribution
- Rotation logic with SRS-style wall kicks
- Line clears, combo bonuses, back-to-back chains, and garbage attacks
- Player elimination and survival-based match ranking
- Match timer and persistent results UI

### Controls

- Keyboard: WASD and arrow layouts
- Gamepad: standard controller input with hot-plug support
- Start/pause behavior is handled through gamepad and keyboard events
- Controller setup supports mixed keyboard + controller players

### Audio and Effects

- Procedural music generation using Web Audio API
- Bus-based audio mixing for master, music, SFX, and UI
- Voice pooling to avoid excessive overlap from repeated sounds
- Vibration support for connected gamepads
- Animated background effects and board FX

### Menus and UX

- Start screen and lobby flow
- Settings menu with volume sliders and performance toggle
- Controls reference overlay
- Results screen with rematch and return-to-menu actions
- Focus navigation for controller-first interaction

## Project Structure

```text
Tetris/
├── index.html
├── README.md
├── img/
│   └── controller.png
├── js/
│   ├── audio.js
│   ├── background.js
│   ├── bak_2game.js
│   ├── bak_game.js
│   ├── bak_settings.js
│   ├── bnak_nav.js
│   ├── controllerSetup.js
│   ├── effects.js
│   ├── game.js
│   ├── gamepadConfig.js
│   ├── nav.js
│   ├── settings.js
│   └── VibrationManager.js
└── .git/
```

## Key Files

### index.html

The main application entry point. It loads the UI structure, style definitions, and script files needed for the game.

### js/game.js

Contains the main Tetris engine: board state, piece logic, scoring, garbage handling, state updates, and match lifecycle.

### js/controllerSetup.js

Handles the lobby flow where players join by keyboard or gamepad, including hot-plugging and slot management.

### js/audio.js

Constructs the Web Audio-based music and sound system. It manages mixing, procedural tracks, UI sounds, and game effects.

### js/settings.js

Defines the settings and controls overlays, including volume controls and gameplay configuration.

### js/nav.js

Provides controller focus navigation for menus and overlays.

### js/effects.js and js/background.js

Handle visual effects, background animation, and game FX rendering.

### js/gamepadConfig.js

Defines gamepad mappings and configuration details for supported controllers.

### js/VibrationManager.js

Handles rumble/vibration feedback for controller devices.

## How to Run

Because this is a static browser game, you can run it by opening the project in a browser.

Recommended option:

1. Open a terminal in the project folder.
2. Start a local web server.
3. Open the site in your browser.

Example:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

You can also open the index.html file directly in a browser, though a simple local server is often more reliable for browser behavior and audio initialization.

## Controls Reference

### Keyboard

- WASD layout:
  - A / D: move left/right
  - S: soft drop
  - W: hard drop
  - Q / E: rotate
  - Left Shift: hold
  - Esc: pause

- Arrow layout:
  - Left / Right: move
  - Down: soft drop
  - Up: hard drop
  - Comma / Period: rotate
  - Right Shift: hold
  - Esc: pause

### Gamepad

- D-pad or left stick: move
- Face buttons: rotate
- Bumpers/triggers: hold actions
- D-pad up or stick up: hard drop
- Start: pause

## Notes

- The project is intentionally built with no build step or package manager requirement.
- Most configuration and state are stored in the browser via localStorage.
- The code is structured for learning and gameplay experimentation, especially in the JS files.
- Several backup files such as bak_game.js and bak_settings.js are included, likely as historical references or earlier versions.

## Development Notes

If you want to extend the game, common editing points are:

- Gameplay balance and scoring: js/game.js
- Menu and settings behavior: js/settings.js
- Navigation and focus flow: js/nav.js
- Audio changes: js/audio.js
- Visual polish: js/effects.js, js/background.js
- Input and controller configuration: js/gamepadConfig.js

## Summary

This project is a complete local multiplayer Tetris game with arcade presentation, controller support, and procedural audio, all built in front-end web technologies. It is ideal for playtesting, experimentation, and further enhancement.
