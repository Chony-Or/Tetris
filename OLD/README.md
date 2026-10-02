# MIS TETRIS AI

A browser-based local multiplayer Tetris game built with plain HTML, CSS, and JavaScript. This project is designed for 1 to 4 players, supports keyboard and controller input, and features arcade styling, procedural audio, visual effects, and controller-first menu navigation.

## Overview

MIS TETRIS AI is a local split-screen Tetris experience focused on multiplayer competition. Players can join with keyboards or connected gamepads, build combo chains, send garbage to opponents, and survive elimination rounds until one player remains.

The game emphasizes:

- 1-4 player local matches
- Mixed keyboard and controller support
- Shared match setup and results flow
- Audio and visual feedback without external asset files
- Controller navigation in menus and overlays
- Adjustable match pacing and game settings

## Features

### Gameplay systems

- Classic falling-piece rules with lock delay and hard/soft drops
- Ghost-piece preview for landing guidance
- Hold mechanic and next-piece preview
- Seventh-bag randomizer for fair piece distribution
- Rotation with wall-kick logic for SRS-style behavior
- Line clears, combos, back-to-back chains, and T-spin detection
- Garbage attack propagation between players
- Elimination tracking and final standings screen
- Match timer and round summary panel

### Input and player management

- Keyboard layouts for WASD and arrow-based controls
- Gamepad detection and hot-plug support
- Mixed controller + keyboard lobby flow
- Player slot assignment and leave logic
- Start, pause, and rematch flows handled through overlay UI

### Audio and polish

- Procedural music generation using the Web Audio API
- Bus-based mixer for master, music, SFX, and UI volume
- Voice pooling for repeated move/rotate sounds
- Gamepad vibration support
- Background FX and arcadelike visual effects
- Low-performance toggle and persistent settings in localStorage

### User interface

- Full start menu, lobby screen, pause flow, settings menu, and results screen
- Controller-first focus navigation for interactive elements
- Settings sliders for volume and match speed tuning
- Controls reference screen with mapping information

## Project structure

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

## Key files

### index.html

The main application shell. It defines the game layout, overlays, UI components, and the script-loading order for the project.

### js/game.js

Contains the core gameplay engine, including board state, piece movement, rotation, attack logic, scoring, combos, and the main game loop.

### js/controllerSetup.js

Handles lobby creation, player joining, slot selection, gamepad joins, and match start flow.

### js/audio.js

Implements the audio system using the browser Web Audio API, including music loops, effects, volume controls, and voice pooling.

### js/settings.js

Creates the settings and controls overlays, as well as audio and gameplay tuning controls.

### js/nav.js

Provides generic focus management and keyboard/controller navigation for UI overlays.

### js/effects.js

Controls arcade visual effects and board animation feedback.

### js/background.js

Handles animated background elements and global visual atmosphere.

### js/gamepadConfig.js

Defines controller mappings and configuration metadata for supported gamepads.

### js/VibrationManager.js

Provides controller vibration and rumble handling for supported devices.

## Controls

### Keyboard

WASD layout:

- A / D: move left / right
- S: soft drop
- W: hard drop
- Q / E: rotate
- Left Shift: hold
- Esc: pause

Arrow layout:

- Left / Right: move
- Down: soft drop
- Up: hard drop
- Comma / Period: rotate
- Right Shift: hold
- Esc: pause

### Gamepad

- D-pad / left stick: move
- Face buttons: rotate
- Bumpers / triggers: hold-related actions
- D-pad up or stick up: hard drop
- Start: pause

## Running the project

This project is a static web app, so it can be run without a package install or build step.

### Option 1: local web server

From the project folder, run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

### Option 2: open directly

You can also open index.html in a browser, but a local server is generally more reliable for browser behavior and audio initialization.

## Settings and persistence

The game stores audio and preference settings in browser localStorage, including:

- master, music, SFX, and UI volume
- mute state
- low-performance visual mode
- lines-per-level setting for match pacing

## Notes

- The project includes legacy/back-up files such as bak_game.js, bak_settings.js, and bnak_nav.js for reference.
- The code is written in plain JavaScript and is designed for experimentation and learning.
- There is no framework or build pipeline required for normal use.

## Suggested areas for editing

If you want to modify gameplay or UI behavior, the most relevant files are:

- Gameplay balance and logic: js/game.js
- Menus and settings: js/settings.js
- Navigation and controller focus: js/nav.js
- Sound design: js/audio.js
- Visual effects: js/effects.js and js/background.js
- Input configuration: js/gamepadConfig.js

## Summary

MIS TETRIS AI is a complete local multiplayer Tetris project with arcade presentation, controller compatibility, score-based pressure, garbage attacks, procedural audio, and polished menu systems. It is suitable for local play, experimentation, and further feature development.
