/**
 * settings.js
 * =====================================================================
 * SETTINGS MENU + CONTROLS REFERENCE
 * ---------------------------------------------------------------------
 * Renders the Audio Settings overlay (master/music/sfx/ui sliders, mute
 * toggle, reset-to-default, low-performance visuals toggle) and a
 * read-only Controls reference overlay. Both are reachable from the
 * pause menu and the settings gear on the start screen. Values are
 * read from / written to AudioManager + Effects, which persist to
 * localStorage themselves.
 * =====================================================================
 */
"use strict";

const SettingsMenu = {
  els: {},
  returnTo: null, // function to call when closing ('paused' -> reopen pause menu, etc.)

  init() {
    if (document.getElementById('settingsOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay hidden';
    overlay.id = 'settingsOverlay';
    overlay.innerHTML = `
      <div class="logo" style="font-size:26px;">AUDIO SETTINGS</div>
      <div class="settings-panel">
        ${this._sliderRow('master', 'Master Volume')}
        ${this._sliderRow('music', 'Music Volume')}
        ${this._sliderRow('sfx', 'Effects Volume')}
        ${this._sliderRow('ui', 'UI Volume')}
        <div class="settings-row">
          <label class="settings-check"><input type="checkbox" id="stMuteToggle"> Mute All</label>
          <label class="settings-check"><input type="checkbox" id="stLowPerf"> Low-Performance Visuals</label>
        </div>
        <div class="settings-btns">
          <button class="btn" id="stResetBtn">Reset to Default</button>
          <button class="btn primary" id="stCloseBtn">Done</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this.els.overlay = overlay;

    ['master', 'music', 'sfx', 'ui'].forEach(bus => {
      const slider = document.getElementById('st_' + bus);
      slider.addEventListener('input', () => {
        AudioManager.setVolume(bus, slider.value / 100);
        document.getElementById('stVal_' + bus).textContent = slider.value + '%';
      });
      slider.addEventListener('change', () => AudioManager.buttonClick());
    });

    document.getElementById('stMuteToggle').addEventListener('change', (e) => {
      AudioManager.setMuted(e.target.checked);
    });
    document.getElementById('stLowPerf').addEventListener('change', (e) => {
      Effects.lowPerf = e.target.checked;
      localStorage.setItem('tetrisai.lowPerf', e.target.checked ? '1' : '0');
    });
    document.getElementById('stResetBtn').addEventListener('click', () => {
      AudioManager.resetToDefaults();
      this._syncControls();
      AudioManager.buttonClick();
    });
    document.getElementById('stCloseBtn').addEventListener('click', () => this.close());

    overlay.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => AudioManager.buttonHover && AudioManager.ctx && AudioManager.buttonHover()));
  },

  _sliderRow(bus, label) {
    return `
      <div class="settings-row">
        <span class="settings-label">${label}</span>
        <input type="range" min="0" max="100" value="80" id="st_${bus}" class="settings-slider">
        <span class="settings-val" id="stVal_${bus}">80%</span>
      </div>`;
  },

  _syncControls() {
    ['master', 'music', 'sfx', 'ui'].forEach(bus => {
      const v = Math.round((AudioManager.volumes[bus] ?? 0.8) * 100);
      document.getElementById('st_' + bus).value = v;
      document.getElementById('stVal_' + bus).textContent = v + '%';
    });
    document.getElementById('stMuteToggle').checked = !!AudioManager.muted;
    document.getElementById('stLowPerf').checked = !!Effects.lowPerf;
  },

  open(returnTo) {
    this.init();
    this._syncControls();
    this.returnTo = returnTo || null;
    this.els.overlay.classList.remove('hidden');
    FocusNav.push(this.els.overlay, () => this.close());
  },

  close() {
    this.els.overlay.classList.add('hidden');
    FocusNav.pop();
    if (typeof this.returnTo === 'function') this.returnTo();
    this.returnTo = null;
  }
};

const ControlsMenu = {
  els: {},
  returnTo: null,

  init() {
    if (document.getElementById('controlsOverlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay hidden';
    overlay.id = 'controlsOverlay';
    overlay.innerHTML = `
      <div class="logo" style="font-size:26px;">CONTROLS</div>
      <div class="overlay-sub" style="max-width: 1160px;">
        <img src="img/controller.png" style="max-width:100%;border-radius:6px;border:1px solid var(--line);box-shadow:0 0 0 1px var(--line),0 10px 30px rgba(0,0,0,0.55);">
      </div>

      <div class="controls-grid">
        <div class="controls-card">
          <div class="controls-card-title">Keyboard (WASD)</div>
          <div>A / D — Move &nbsp; S — Soft Drop &nbsp; W — Hard Drop</div>
          <div>Q / E — Rotate &nbsp; Left Shift — Hold &nbsp; Esc — Pause</div>
        </div>
        <div class="controls-card">
          <div class="controls-card-title">Keyboard (Arrows)</div>
          <div>&larr; / &rarr; — Move &nbsp; &darr; — Soft Drop &nbsp; &uarr; — Hard Drop</div>
          <div>, / . — Rotate &nbsp; Right Shift — Hold &nbsp; Esc — Pause</div>
        </div>
        <div class="controls-card">
          <div class="controls-card-title">Gamepad</div>
          <div>D-Pad / Stick — Move &nbsp; Face Buttons — Rotate</div>
          <div>Bumpers/Triggers — Hold &nbsp; D-Pad Up or Stick Up — Hard Drop &nbsp; Start — Pause</div>
        </div>
      </div>
      <button class="btn primary" id="ctlCloseBtn">Done</button>`;
    document.body.appendChild(overlay);
    this.els.overlay = overlay;
    document.getElementById('ctlCloseBtn').addEventListener('click', () => this.close());
  },

  open(returnTo) {
    this.init();
    this.returnTo = returnTo || null;
    this.els.overlay.classList.remove('hidden');
    FocusNav.push(this.els.overlay, () => this.close());
  },

  close() {
    this.els.overlay.classList.add('hidden');
    FocusNav.pop();
    if (typeof this.returnTo === 'function') this.returnTo();
    this.returnTo = null;
  }
};
