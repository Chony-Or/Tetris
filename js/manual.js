"use strict";

const ManualGuide = {
  overlay: null,
  activeTab: 'play',
  selectedItem: 'SHIELD',
  demoTimers: [],
  tabPollFrame: 0,
  previousBumpers: {},
  practice: null,
  pieceIndex: 0,

  PIECES: [
    { name: 'T', color: '196,107,255', cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { name: 'I', color: '107,214,255', cells: [[1, 0], [1, 1], [1, 2], [1, 3]] },
    { name: 'L', color: '255,157,61', cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },
    { name: 'O', color: '255,210,95', cells: [[0, 1], [0, 2], [1, 1], [1, 2]] },
    { name: 'S', color: '95,255,143', cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { name: 'J', color: '62,230,217', cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
    { name: 'Z', color: '255,84,112', cells: [[0, 0], [0, 1], [1, 1], [1, 2]] }
  ],

  init() {
    if (this.overlay) return;
    const style = document.createElement('style');
    style.textContent = `
      .start-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
      .manual-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:1.5vh 1.5vw;background:rgba(5,5,10,.88);backdrop-filter:blur(12px)}
      .manual-overlay.hidden{display:none}
      .manual-window{width:min(1920px,100%);height:min(1200px,100%);min-height:0;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse at 0 0,rgba(62,230,217,.08),transparent 45%),radial-gradient(ellipse at 100% 100%,rgba(255,84,112,.07),transparent 42%),#111018;border:1px solid #34313f;border-radius:10px;box-shadow:0 20px 90px rgba(0,0,0,.7)}
      .manual-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 26px 14px;border-bottom:1px solid #2a2836}
      .manual-kicker{font:700 10px var(--font-mono,Consolas,monospace);color:#3ee6d9;letter-spacing:.08em}
      .manual-title{font:700 30px var(--font-display,'Arial Narrow',sans-serif);color:#eae7f2}
      .manual-subtitle{margin-top:2px;color:#8b87a0;font:12px var(--font-mono,Consolas,monospace)}
      .manual-nav{display:flex;gap:6px;padding:10px 26px;border-bottom:1px solid #2a2836;background:rgba(255,255,255,.015)}
      .manual-tab{min-width:100px;padding:8px 13px;border:1px solid transparent;border-radius:5px;background:transparent;color:#8b87a0;font:700 12px var(--font-display,'Arial Narrow',sans-serif);text-transform:uppercase;cursor:pointer}
      .manual-tab:hover,.manual-tab.nav-focus{color:#eae7f2;border-color:#3a3747}
      .manual-tab.active{color:#ffd25f;border-color:rgba(255,210,95,.4);background:rgba(255,210,95,.07)}
      .manual-content{flex:1;min-height:0;overflow:auto;padding:14px 22px;scrollbar-width:thin;scrollbar-color:#454153 transparent}
      .manual-content h2{margin:0 0 9px;color:#eae7f2;font:700 20px var(--font-display,'Arial Narrow',sans-serif)}
      .manual-content h3{margin:0 0 5px;color:#ffd25f;font:700 14px var(--font-display,'Arial Narrow',sans-serif);text-transform:uppercase}
      .manual-content p,.manual-content li{color:#b5b1c2;font:13px/1.55 var(--font-mono,Consolas,monospace)}
      .manual-content strong{color:#eae7f2}
      .manual-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(210px,.65fr);gap:14px;margin-bottom:8px}
      .manual-callout{padding:10px 15px;border-left:3px solid #3ee6d9;background:linear-gradient(110deg,rgba(62,230,217,.09),rgba(255,255,255,.018));}
      .manual-callout p{max-width:650px}
      .manual-item-intro .manual-callout{padding:6px 12px}
      .manual-item-intro .manual-callout h2{margin-bottom:3px;font-size:18px}
      .manual-item-intro .manual-callout p{max-width:850px;font-size:11px;line-height:1.35}
      .manual-item-intro .manual-stat{padding:8px 12px}
      .manual-item-intro .manual-stat b{font-size:21px}
      .manual-item-intro .manual-stat span{font-size:9px;line-height:1.35}
      .manual-stat{display:flex;flex-direction:column;justify-content:center;padding:16px;border:1px solid #2a2836;background:rgba(0,0,0,.17)}
      .manual-stat b{color:#ff5470;font:700 24px var(--font-display,'Arial Narrow',sans-serif)}
      .manual-stat span{color:#8b87a0;font:10px/1.5 var(--font-mono,Consolas,monospace)}
      .manual-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .manual-card{min-height:112px;padding:14px;border:1px solid #2a2836;border-radius:6px;background:rgba(255,255,255,.025)}
      .manual-card p{margin-top:6px}
      .manual-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}
      .manual-control-group{padding:13px;border-top:2px solid #3a3747;background:rgba(255,255,255,.02)}
      .manual-control-group p{margin-top:4px;font-size:11px}
      .manual-note{margin-top:10px;padding:9px 12px;border:1px solid rgba(255,210,95,.22);background:rgba(255,210,95,.045)}
      .manual-item-layout{display:grid;grid-template-columns:minmax(270px,320px) minmax(0,1fr);gap:18px;align-items:start}
      .manual-item-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:6px}
      .manual-item-btn{display:grid;grid-template-columns:24px minmax(0,1fr);gap:5px;align-items:center;text-align:left;min-height:44px;padding:5px 7px;border-color:#302d3c;background:#15141e}
      .manual-item-btn.selected{border-color:rgba(62,230,217,.65);box-shadow:inset 3px 0 #3ee6d9;color:#eae7f2}
      .manual-item-icon{font-size:20px;text-align:center}
      .manual-item-name{font:700 13px var(--font-display,'Arial Narrow',sans-serif)}
      .manual-item-kind{display:block;margin-top:2px;color:#8b87a0;font:9px var(--font-mono,Consolas,monospace);text-transform:uppercase}
      .manual-item-detail{min-width:0;padding:2px 0}
      .manual-item-detail-head{display:flex;gap:12px;align-items:center;margin-bottom:5px}
      .manual-item-detail-icon{font-size:36px}
      .manual-item-detail h2{margin:0}
      .manual-item-detail p{margin:8px 0}
      .manual-item-use-note{margin:6px 0 0;color:#8b87a0!important;font-size:11px!important}
      .manual-duel{width:100%;margin:9px auto 0;padding:8px 18px;border:1px solid #302d3c;border-radius:6px;background:linear-gradient(130deg,rgba(62,230,217,.045),rgba(255,84,112,.045))}
      .manual-duel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}
      .manual-duel-head h3{margin:0}
      .manual-duel-stage{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:clamp(60px,10vw,150px);width:min(100%,900px);margin:0 auto}
      .manual-duel-player{position:relative;min-width:0;text-align:center}
      .manual-duel-name{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;color:#eae7f2;font:700 13px var(--font-mono,Consolas,monospace)}
      .manual-duel-role{color:#8b87a0;font-size:9px;font-weight:400}
      .manual-duel-board{position:relative;display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(14,1fr);gap:4px;width:min(100%,300px);aspect-ratio:10/13;margin:0 auto;padding:9px;border:1px solid #3a3747;border-radius:5px;background:#090810;overflow:hidden;box-shadow:inset 0 0 18px rgba(0,0,0,.35)}
      .manual-duel-cell{border-radius:2px;background:rgba(255,255,255,.035)}
      .manual-duel-cell.filled{background:rgba(62,230,217,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)}
      .manual-duel-cell.garbage{background:linear-gradient(135deg,#ff5470,#a7354c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
      .manual-duel-cell.hole{background:transparent;box-shadow:none}
      .manual-falling-piece{position:absolute;inset:9px;z-index:2;display:none;grid-template-columns:repeat(10,minmax(0,1fr));grid-template-rows:repeat(14,minmax(0,1fr));gap:4px;pointer-events:none}
      .manual-falling-cell{border-radius:3px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),0 0 12px currentColor}
      .manual-falling-piece.slow-piece{color:#c46bff}
      .manual-falling-piece.slow-piece .manual-falling-cell{background:#c46bff}
      .manual-falling-piece.heavy-piece{color:#ff9d3d}
      .manual-falling-piece.heavy-piece .manual-falling-cell{background:#ff9d3d}
      .manual-duel-stage[data-item="SLOWMO"][data-phase="flight"] .manual-duel-player[data-player="1"] .manual-falling-piece,
      .manual-duel-stage[data-item="SLOWMO"][data-phase="result"] .manual-duel-player[data-player="1"] .manual-falling-piece{display:grid;animation:manualFallSlow 3.2s linear infinite}
      .manual-duel-stage[data-item="HEAVY"][data-phase="flight"] .manual-duel-player[data-player="2"] .manual-falling-piece,
      .manual-duel-stage[data-item="HEAVY"][data-phase="result"] .manual-duel-player[data-player="2"] .manual-falling-piece{display:grid;animation:manualFallFast .72s linear infinite}
      @keyframes manualFallSlow{0%{transform:translateY(0)}84%{transform:translateY(60%)}100%{transform:translateY(60%)}}
      @keyframes manualFallFast{0%{transform:translateY(0)}84%{transform:translateY(60%)}100%{transform:translateY(60%)}}
      .manual-duel-status{min-height:18px;margin-top:5px;color:#8b87a0;font:11px var(--font-mono,Consolas,monospace)}
      .manual-duel-shield{position:absolute;z-index:2;top:42%;left:50%;padding:3px 6px;border:1px solid rgba(107,214,255,.75);border-radius:3px;background:rgba(10,26,38,.92);color:#6bd6ff;font:700 9px var(--font-mono,Consolas,monospace);transform:translate(-50%,-50%);white-space:nowrap}
      .manual-duel-projectile{position:absolute;z-index:4;top:48%;left:22%;display:none;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid rgba(255,84,112,.85);border-radius:50%;background:rgba(255,84,112,.3);box-shadow:0 0 16px rgba(255,84,112,.8);font-size:14px;transform:translate(-50%,-50%)}
      .manual-duel-stage.is-playing .manual-duel-projectile{display:flex;animation:manualProjectile .9s cubic-bezier(.2,.65,.35,1) forwards}
      .manual-duel-stage[data-item="SHIELD"] .manual-duel-projectile{left:78%}
      .manual-duel-stage[data-item="SHIELD"].is-playing .manual-duel-projectile{animation-name:manualProjectileReverse}
      .manual-duel-stage[data-item="CLEAR_COLUMN"] .manual-duel-projectile,
      .manual-duel-stage[data-item="SLOWMO"] .manual-duel-projectile{left:22%}
      .manual-duel-stage[data-item="CLEAR_COLUMN"].is-playing .manual-duel-projectile,
      .manual-duel-stage[data-item="SLOWMO"].is-playing .manual-duel-projectile{animation-name:manualSelfProjectile}
      @keyframes manualProjectile{to{left:78%;transform:translate(-50%,-50%) scale(.7);opacity:.45}}
      @keyframes manualProjectileReverse{to{left:22%;transform:translate(-50%,-50%) scale(.7);opacity:.45}}
      @keyframes manualSelfProjectile{45%{transform:translate(-50%,-50%) scale(1.35);box-shadow:0 0 22px rgba(62,230,217,.9)}100%{left:22%;transform:translate(-50%,-50%) scale(.65);opacity:.35}}
      .manual-duel-stage[data-item="SHIELD"][data-phase="result"] .manual-duel-shield{border-color:#ffd25f;color:#ffd25f;box-shadow:0 0 14px rgba(255,210,95,.55)}
      .manual-duel-stage[data-item="SHIELD"][data-phase="result"] .manual-duel-shield{animation:manualShieldBlock .32s ease-out}
      .manual-duel-stage[data-item="SHIELD"][data-phase="result"] .manual-duel-player[data-player="1"] .manual-duel-board{box-shadow:0 0 18px rgba(107,214,255,.3)}
      .manual-duel-stage[data-item="GARBAGE_PLUS"][data-phase="result"] .manual-duel-player[data-player="2"] .manual-duel-board{box-shadow:0 0 18px rgba(255,84,112,.42)}
      .manual-duel-stage[data-item="GARBAGE_PLUS"][data-phase="result"] .manual-duel-cell.garbage{animation:manualGarbageRise .38s ease-out both}
      .manual-duel-stage[data-item="GARBAGE_PLUS"][data-phase="result"] .manual-duel-cell.garbage:nth-child(6n){animation-delay:.12s}
      .manual-duel-stage[data-item="FOG"][data-phase="result"] .manual-duel-player[data-player="2"] .manual-duel-board{filter:blur(2px) brightness(.65)}
      .manual-duel-stage[data-item="HEAVY"][data-phase="result"] .manual-duel-player[data-player="2"] .manual-duel-board{animation:manualHeavy .2s ease-in-out 4 alternate}
      .manual-duel-stage[data-item="SLOWMO"][data-phase="result"] .manual-duel-player[data-player="1"] .manual-duel-board{animation:manualSlow 1.1s ease-in-out 2}
      .manual-duel-stage[data-item="CLEAR_COLUMN"][data-phase="result"] .manual-duel-player[data-player="1"] .manual-duel-board .manual-duel-cell:nth-child(10n+1){opacity:.15}
      .manual-duel-caption{min-height:26px;margin:5px auto 0;text-align:center;color:#b5b1c2;font:12px/1.4 var(--font-mono,Consolas,monospace)}
      .manual-duel-controls{display:flex;justify-content:center;margin-top:3px}
      @keyframes manualHeavy{to{transform:translateY(4px)}}
      @keyframes manualSlow{50%{filter:saturate(.25);opacity:.6}}
      @keyframes manualGarbageRise{from{transform:translateY(14px);opacity:.15}to{transform:translateY(0);opacity:1}}
      @keyframes manualShieldBlock{35%{transform:translate(-50%,-50%) scale(1.18)}100%{transform:translate(-50%,-50%) scale(1)}}
      .manual-practice-layout{display:grid;grid-template-columns:minmax(190px,260px) minmax(0,1fr);gap:20px;align-items:start}
      .manual-practice-board{display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(14,1fr);width:min(100%,260px);aspect-ratio:10/14;gap:2px;padding:6px;border:1px solid #3a3747;border-radius:6px;background:#090810;box-shadow:0 0 22px rgba(62,230,217,.06)}
      .manual-cell{min-width:0;min-height:0;border-radius:2px;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px rgba(255,255,255,.025)}
      .manual-cell.locked{background:rgba(255,84,112,.55);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
      .manual-cell.active-piece{background:var(--piece-color);box-shadow:inset 0 0 0 1px rgba(255,255,255,.34),0 0 8px rgba(var(--piece-rgb),.45)}
      .manual-practice-actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}
      .manual-practice-actions .btn{padding:8px 11px}
      .manual-practice-stats{display:flex;gap:16px;margin:12px 0;color:#8b87a0;font:10px var(--font-mono,Consolas,monospace)}
      .manual-practice-stats b{color:#ffd25f}
      .manual-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 20px;border-top:1px solid #2a2836;color:#777386;font:9px var(--font-mono,Consolas,monospace)}
      .manual-close{padding:7px 15px}
      .manual-overlay .nav-focus{outline:2px solid #3ee6d9;outline-offset:2px}
      @media(min-width:701px) and (max-height:900px){.manual-head{padding:12px 22px 9px}.manual-nav{padding:7px 22px}.manual-content{padding:10px 18px}.manual-content p,.manual-content li{line-height:1.45}.manual-hero{margin-bottom:6px}.manual-item-layout{grid-template-columns:minmax(270px,300px) minmax(0,1fr);gap:14px}.manual-duel{margin-top:1px;padding:6px 14px}.manual-duel-board{width:min(100%,185px)}.manual-duel-name{margin-bottom:4px}.manual-duel-caption{min-height:22px;margin:4px auto 0}.manual-duel-controls{margin-top:2px}.manual-note{margin-top:7px;padding:7px 10px}}
      @media(min-width:701px) and (max-height:780px){.manual-head{padding:9px 18px 7px}.manual-nav{padding:5px 18px}.manual-content{padding:7px 14px}.manual-item-layout{grid-template-columns:minmax(250px,280px) minmax(0,1fr);gap:12px}.manual-item-btn{min-height:40px;padding:4px 6px}.manual-duel{margin-top:6px;padding:6px 12px}.manual-duel-board{width:min(100%,150px)}.manual-duel-head{margin-bottom:4px}.manual-duel-caption{min-height:20px;margin:3px auto 0}.manual-duel-controls{margin-top:2px}}
      @media(max-width:700px){.manual-overlay{padding:8px}.manual-window{width:100%;height:100%;border-radius:7px}.manual-head{padding:12px 14px}.manual-title{font-size:22px}.manual-nav{padding:8px 12px}.manual-tab{flex:1;min-width:0;padding:8px 5px}.manual-content{padding:14px}.manual-hero,.manual-item-layout,.manual-practice-layout{grid-template-columns:1fr}.manual-grid,.manual-controls{grid-template-columns:1fr 1fr}.manual-stat{min-height:80px}.manual-item-list{display:grid;grid-template-columns:1fr 1fr}.manual-item-btn{grid-template-columns:24px 1fr;padding:7px 5px}.manual-item-name{font-size:11px}.manual-item-kind{font-size:8px}.manual-item-detail{min-height:0}.manual-practice-board{width:min(100%,240px);margin:auto}.manual-footer{padding:8px 12px}}
      @media(max-width:700px){.manual-duel{padding:10px}.manual-duel-head{align-items:flex-start;flex-direction:column;gap:4px}.manual-duel-stage{gap:24px}.manual-duel-board{width:min(100%,160px);gap:2px;padding:4px}.manual-duel-name{font-size:9px}.manual-duel-role{font-size:8px}.manual-duel-status{font-size:8px}.manual-duel-shield{font-size:7px;padding:2px 3px}.manual-duel-projectile{width:21px;height:21px;font-size:11px}}
      @media(max-height:560px){.manual-head{padding:8px 14px}.manual-nav{padding:5px 12px}.manual-content{padding:8px 12px}.manual-window{height:100%}.manual-title{font-size:21px}.manual-grid{gap:6px}.manual-card{min-height:90px;padding:9px}}
    `;
    document.head.appendChild(style);
    this.overlay = document.createElement('section');
    this.overlay.id = 'manualOverlay';
    this.overlay.className = 'manual-overlay hidden';
    this.overlay.setAttribute('aria-label', 'Game manual');
    this.overlay.innerHTML = `
      <div class="manual-window">
        <header class="manual-head">
          <div><div class="manual-kicker">FIELD GUIDE / TETRIS AI</div><div class="manual-title">Game Manual</div><div class="manual-subtitle">Rules, controls, power-ups, and a practice board</div></div>
          <span class="manual-kicker">01 / PLAY</span>
        </header>
        <nav class="manual-nav" aria-label="Manual sections">
          <button class="manual-tab tab-btn active" data-tab="play">How to Play</button>
          <button class="manual-tab tab-btn" data-tab="items">Power-ups</button>
          <button class="manual-tab tab-btn" data-tab="practice">Practice</button>
        </nav>
        <main class="manual-content" id="manualContent"></main>
        <footer class="manual-footer"><span>LB / RB: CHANGE PAGE &nbsp; ARROWS: NAVIGATE &nbsp; A / ENTER: SELECT &nbsp; B / ESC: CLOSE</span><button class="btn manual-close" data-action="close">Close</button></footer>
      </div>`;
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('click', (event) => this._onClick(event));
  },

  open() {
    this.init();
    this._render();
    this.overlay.classList.remove('hidden');
    this.previousBumpers = {};
    this.tabPollFrame = requestAnimationFrame(this._pollPageTabs.bind(this));
    FocusNav.push(this.overlay, () => this.close());
  },

  close() {
    if (!this.overlay || this.overlay.classList.contains('hidden')) return;
    this.overlay.classList.add('hidden');
    this.demoTimers.forEach(clearTimeout);
    this.demoTimers = [];
    cancelAnimationFrame(this.tabPollFrame);
    this.tabPollFrame = 0;
    this.previousBumpers = {};
    FocusNav.pop();
  },

  _pollPageTabs() {
    if (!this.overlay || this.overlay.classList.contains('hidden')) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let direction = 0;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const previous = this.previousBumpers[i] || {};
      const lb = !!(pad.buttons[4] && pad.buttons[4].pressed);
      const rb = !!(pad.buttons[5] && pad.buttons[5].pressed);
      if (!direction && lb && !previous.lb) direction = -1;
      if (!direction && rb && !previous.rb) direction = 1;
      this.previousBumpers[i] = { lb, rb };
    }
    if (direction) this._cycleTab(direction);
    this.tabPollFrame = requestAnimationFrame(this._pollPageTabs.bind(this));
  },

  _cycleTab(direction) {
    const tabs = ['play', 'items', 'practice'];
    const index = tabs.indexOf(this.activeTab);
    this.activeTab = tabs[(index + direction + tabs.length) % tabs.length];
    if (window.AudioManager) AudioManager.navMove();
    this._render();
  },

  _render() {
    this.overlay.querySelectorAll('.manual-tab').forEach((tab) => {
      const active = tab.dataset.tab === this.activeTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const subtitle = this.overlay.querySelector('.manual-head .manual-kicker:last-child');
    subtitle.textContent = this.activeTab === 'play' ? '01 / PLAY' : this.activeTab === 'items' ? '02 / POWER-UPS' : '03 / PRACTICE';
    const content = this.overlay.querySelector('#manualContent');
    if (this.activeTab === 'items') this._renderItems(content);
    else if (this.activeTab === 'practice') this._renderPractice(content);
    else this._renderPlay(content);
    FocusNav.refresh(true);
  },

  _renderPlay(content) {
    content.innerHTML = `
      <section class="manual-hero">
        <div class="manual-callout"><h2>Build. Clear. Survive.</h2><p>Move falling tetrominoes into place and complete horizontal rows. Cleared rows score points and can send garbage to opponents. In solo play, keep stacking without topping out; in battle, be the last player standing.</p></div>
        <div class="manual-stat"><b>4 lines</b><span>One Tetris clear scores 800 base points and sends a strong garbage attack. Hard clears can extend back-to-back pressure.</span></div>
      </section>
      <section class="manual-grid">
        <article class="manual-card"><h3>Place pieces</h3><p>Move left or right, rotate to fit gaps, then drop. A soft drop speeds descent; a hard drop locks the piece immediately.</p></article>
        <article class="manual-card"><h3>Clear rows</h3><p>Fill every cell in a horizontal row to clear it. Multiple rows, T-spins, combos, and perfect clears earn more score or attack.</p></article>
        <article class="manual-card"><h3>Manage the stack</h3><p>Keep the pile low and leave room to maneuver. Garbage arrives as rows with a hole; stack toward the opening instead of sealing it.</p></article>
      </section>
      <section class="manual-controls">
        <article class="manual-control-group"><h3>Keyboard / WASD</h3><p><strong>A / D</strong> move<br><strong>S</strong> soft drop, <strong>W</strong> hard drop<br><strong>Q / E</strong> rotate<br><strong>Left Shift</strong> hold piece<br><strong>C</strong> use item</p></article>
        <article class="manual-control-group"><h3>Keyboard / Arrows</h3><p><strong>Left / Right</strong> move<br><strong>Down</strong> soft drop, <strong>Up</strong> hard drop<br><strong>, / .</strong> rotate<br><strong>Right Shift</strong> hold piece<br><strong>/</strong> use item</p></article>
        <article class="manual-control-group"><h3>Gamepad</h3><p><strong>D-pad / stick</strong> move<br><strong>Face buttons</strong> rotate<br><strong>D-pad up</strong> hard drop<br><strong>LB / RB / triggers</strong> hold<br><strong>Y</strong> use item</p></article>
      </section>
      <div class="manual-note"><p><strong>Match pace:</strong> everyone shares the same gravity speed. The level rises from the highest line count in the match; the default is one level per 10 lines. Open the <strong>Practice</strong> tab to move, rotate, and drop sample pieces without affecting a match.</p></div>`;
  },

  _renderItems(content) {
    this.demoTimers.forEach(clearTimeout);
    this.demoTimers = [];
    const defs = typeof ITEM_DEFS === 'undefined' ? {} : ITEM_DEFS;
    const entries = Object.values(defs);
    const selected = defs[this.selectedItem] || entries[0];
    const list = entries.map((item) => `
      <button class="btn manual-item-btn ${item.id === (selected && selected.id) ? 'selected' : ''}" data-item="${item.id}" style="--item-rgb:${item.color}">
        <span class="manual-item-icon">${item.icon}</span><span><span class="manual-item-name">${item.label}</span><span class="manual-item-kind">${item.kind === 'self' ? 'Self effect' : 'Targets the leader'}</span></span>
      </button>`).join('');
    const itemContent = selected ? `
      <div class="manual-item-detail-head"><span class="manual-item-detail-icon">${selected.icon}</span><div><h2>${selected.label}</h2><p>${selected.kind === 'self' ? 'Helps your board' : 'Affects the current match leader'}</p></div></div>
      <p>${selected.desc}</p>
    ` : '<h2>Power-ups unavailable</h2><p>Item definitions could not be loaded.</p>';
    content.innerHTML = `
      <div class="manual-hero manual-item-intro"><div class="manual-callout"><h2>Earn a boost. Spend it wisely.</h2><p>Items are optional and off by default. A Tetris, T-spin, or 3+ combo can earn one. Offensive items hit the living leader; a Shield blocks the next attack or garbage hit.</p></div><div class="manual-stat"><b>55%</b><span>Chance to receive one item after a qualifying clear. Only one item can be held at once.</span></div></div>
      <div class="manual-item-layout"><nav class="manual-item-list" aria-label="Power-up list">${list}</nav><section class="manual-item-detail">${itemContent}</section></div>
      ${selected ? this._duelSampleMarkup(selected) : ''}`;
    if (selected) this._scheduleDuelDemo();
  },

  _scheduleDuelDemo() {
    const timer = setTimeout(() => {
      this.demoTimers = this.demoTimers.filter(activeTimer => activeTimer !== timer);
      if (this.activeTab === 'items' && this.overlay && !this.overlay.classList.contains('hidden')) this._tryItem();
    }, 450);
    this.demoTimers.push(timer);
  },

  _duelSampleMarkup(item) {
    const board = (player) => {
      const cells = Array.from({ length: 140 }, (_, index) => {
        const row = Math.floor(index / 10), col = index % 10;
        const filled = row >= 10 && (player === 1 ? col !== 3 : col !== 6);
        return `<span class="manual-duel-cell ${filled ? 'filled' : ''}" data-cell="${index}"></span>`;
      }).join('');
      const isSlowPiece = item.id === 'SLOWMO' && player === 1;
      const isHeavyPiece = item.id === 'HEAVY' && player === 2;
      const fallingPiece = isSlowPiece || isHeavyPiece
        ? `<div class="manual-falling-piece ${isSlowPiece ? 'slow-piece' : 'heavy-piece'}" aria-hidden="true"><span class="manual-falling-cell" style="grid-area:3/5"></span><span class="manual-falling-cell" style="grid-area:3/6"></span><span class="manual-falling-cell" style="grid-area:4/5"></span><span class="manual-falling-cell" style="grid-area:4/6"></span></div>`
        : '';
      const role = player === 1 ? (item.id === 'SHIELD' ? 'Shield holder' : 'Uses item') : (item.kind === 'offense' ? 'Leader / target' : 'Other player');
      const shield = item.id === 'SHIELD' && player === 1 ? '<span class="manual-duel-shield">SHIELD READY</span>' : '';
      const status = item.id === 'SHIELD' && player === 1 ? 'Incoming hit will be blocked' : 'Stack shown before item use';
      return `<div class="manual-duel-player" data-player="${player}"><div class="manual-duel-name"><span>PLAYER ${player}</span><span class="manual-duel-role">${role}</span></div><div class="manual-duel-board">${cells}${shield}${fallingPiece}</div><div class="manual-duel-status">${status}</div></div>`;
    };
    const caption = item.id === 'SHIELD'
      ? 'Player 2 sends an attack. Player 1’s Shield absorbs it; their stack stays unchanged.'
      : item.id === 'GARBAGE_PLUS'
        ? 'Player 1 uses Garbage+. Two garbage rows rise on the leader’s board, each with a gap.'
        : `${item.label} is used by Player 1. Watch the affected board when you run the sample.`;
    const source = item.id === 'SHIELD' ? '✦' : item.icon;
    return `<section class="manual-duel"><div class="manual-duel-head"><h3>Two-player sample</h3><span class="manual-item-kind">SIMULATED MATCH / NO GAME STATE CHANGES</span></div><div class="manual-duel-stage" id="manualDuelStage" data-item="${item.id}" data-phase="ready">${board(1)}${board(2)}<span class="manual-duel-projectile" aria-hidden="true">${source}</span></div><p class="manual-duel-caption" id="manualDuelCaption" aria-live="polite">${caption}</p><div class="manual-duel-controls"><button class="btn primary" data-action="run-duel">↻ Replay sample</button></div></section>`;
  },

  _renderPractice(content) {
    content.innerHTML = `
      <div class="manual-practice-layout">
        <div><h2>Practice placement</h2><p>Try to fit the piece into the sample stack. This sandbox pauses until you press a control, so you can experiment at your own pace.</p>
          <div class="manual-practice-board" id="manualPracticeBoard" aria-label="Interactive Tetris practice board"></div>
          <div class="manual-practice-stats"><span>LINES <b id="manualPracticeLines">0</b></span><span>SCORE <b id="manualPracticeScore">0</b></span></div>
        </div>
        <div><h3>Piece controls</h3><div class="manual-practice-actions">
          <button class="btn" data-action="left" aria-label="Move piece left">← Left</button><button class="btn" data-action="right" aria-label="Move piece right">Right →</button>
          <button class="btn" data-action="rotate" aria-label="Rotate piece">Rotate ↻</button><button class="btn primary" data-action="drop">Hard drop</button>
          <button class="btn" data-action="reset-practice">Reset</button>
        </div><div class="manual-note"><p id="manualPracticeHint"><strong>Tip:</strong> line up the active piece over an opening. Rotation changes its orientation; a hard drop locks it and checks for full rows.</p></div>
          <h3 style="margin-top:16px">Item sample</h3><p>Open <strong>Power-ups</strong>, choose an item, then select <strong>Try sample</strong> to see its effect preview.</p>
        </div>
      </div>`;
    this._resetPractice();
  },

  _resetPractice() {
    this.practice = { grid: Array.from({ length: 14 }, () => Array(10).fill(0)), piece: 0, x: 3, y: 0, rotation: 0, lines: 0, score: 0 };
    this.practice.grid[12] = [1, 1, 0, 0, 1, 1, 1, 1, 1, 1];
    this.practice.grid[13] = [1, 1, 1, 1, 0, 0, 1, 1, 1, 1];
    this.pieceIndex = 0;
    this._renderPracticeBoard();
  },

  _pieceCells() {
    const piece = this.PIECES[this.practice.piece];
    return piece.cells.map(([row, col]) => {
      let r = row, c = col;
      for (let turn = 0; turn < this.practice.rotation; turn++) [r, c] = [c, 3 - r];
      return [r, c];
    });
  },

  _collides(x, y, rotation) {
    const original = this.practice.rotation;
    this.practice.rotation = rotation;
    const cells = this._pieceCells();
    this.practice.rotation = original;
    return cells.some(([row, col]) => {
      const boardX = x + col, boardY = y + row;
      return boardX < 0 || boardX >= 10 || boardY >= 14 || (boardY >= 0 && this.practice.grid[boardY][boardX]);
    });
  },

  _renderPracticeBoard() {
    const board = this.overlay.querySelector('#manualPracticeBoard');
    if (!board || !this.practice) return;
    const active = new Set(this._pieceCells().map(([row, col]) => `${this.practice.y + row}:${this.practice.x + col}`));
    const piece = this.PIECES[this.practice.piece];
    board.innerHTML = this.practice.grid.map((row, r) => row.map((cell, c) => {
      const isActive = active.has(`${r}:${c}`);
      const style = isActive ? `style="--piece-color:rgb(${piece.color});--piece-rgb:${piece.color}"` : '';
      return `<span class="manual-cell ${cell ? 'locked' : ''} ${isActive ? 'active-piece' : ''}" ${style}></span>`;
    }).join('')).join('');
    const lines = this.overlay.querySelector('#manualPracticeLines');
    const score = this.overlay.querySelector('#manualPracticeScore');
    if (lines) lines.textContent = this.practice.lines;
    if (score) score.textContent = this.practice.score;
  },

  _movePractice(dx) {
    if (!this._collides(this.practice.x + dx, this.practice.y, this.practice.rotation)) this.practice.x += dx;
    this._renderPracticeBoard();
  },

  _rotatePractice() {
    const next = (this.practice.rotation + 1) % 4;
    if (!this._collides(this.practice.x, this.practice.y, next)) this.practice.rotation = next;
    this._renderPracticeBoard();
  },

  _dropPractice() {
    while (!this._collides(this.practice.x, this.practice.y + 1, this.practice.rotation)) this.practice.y++;
    this._pieceCells().forEach(([row, col]) => {
      const boardY = this.practice.y + row, boardX = this.practice.x + col;
      if (boardY >= 0) this.practice.grid[boardY][boardX] = 1;
    });
    const remaining = this.practice.grid.filter((row) => !row.every(Boolean));
    const cleared = 14 - remaining.length;
    if (cleared) {
      this.practice.grid = Array.from({ length: cleared }, () => Array(10).fill(0)).concat(remaining);
      this.practice.lines += cleared;
      this.practice.score += [0, 100, 300, 500, 800][cleared] || 0;
    }
    this.pieceIndex = (this.pieceIndex + 1) % this.PIECES.length;
    this.practice.piece = this.pieceIndex;
    this.practice.x = 3;
    this.practice.y = 0;
    this.practice.rotation = 0;
    if (this._collides(this.practice.x, this.practice.y, this.practice.rotation)) {
      const hint = this.overlay.querySelector('#manualPracticeHint');
      if (hint) hint.innerHTML = '<strong>Stack reached the top.</strong> Reset the sample and try another placement.';
    }
    this._renderPracticeBoard();
  },

  _tryItem() {
    const item = typeof ITEM_DEFS === 'undefined' ? null : ITEM_DEFS[this.selectedItem];
    const stage = this.overlay.querySelector('#manualDuelStage');
    const caption = this.overlay.querySelector('#manualDuelCaption');
    if (!stage || !caption || !item) return;
    this.demoTimers.forEach(clearTimeout);
    this.demoTimers = [];
    this._resetDuelSample(stage, item);
    stage.classList.remove('is-playing');
    void stage.offsetWidth;
    stage.dataset.phase = 'flight';
    stage.classList.add('is-playing');
    caption.textContent = item.id === 'SHIELD'
      ? 'Player 2 sends an incoming attack toward Player 1...'
      : item.kind === 'self'
        ? `Player 1 activates ${item.label} on their own board...`
        : `Player 1 sends ${item.label} toward Player 2, the current leader...`;

    this.demoTimers.push(setTimeout(() => {
      stage.classList.remove('is-playing');
      stage.dataset.phase = 'result';
      const p1 = stage.querySelector('[data-player="1"]');
      const p2 = stage.querySelector('[data-player="2"]');
      const p1Status = p1.querySelector('.manual-duel-status');
      const p2Status = p2.querySelector('.manual-duel-status');
      if (item.id === 'SHIELD') {
        stage.querySelector('.manual-duel-shield').textContent = 'HIT BLOCKED';
        p1Status.textContent = 'Shield consumed; board protected';
        p2Status.textContent = 'Attack absorbed by Player 1';
        caption.textContent = 'Blocked! Player 1 loses the Shield, but no garbage reaches their board.';
      } else if (item.id === 'GARBAGE_PLUS') {
        const cells = Array.from(p2.querySelectorAll('.manual-duel-cell'));
        cells.forEach((cell, index) => {
          const row = Math.floor(index / 10), col = index % 10;
          cell.className = 'manual-duel-cell';
          if (row >= 10 && col !== 6) cell.classList.add('filled');
          if ((row === 8 && col !== 2) || (row === 9 && col !== 7)) cell.classList.add('garbage');
          if ((row === 8 && col === 2) || (row === 9 && col === 7)) cell.classList.add('hole');
        });
        p1Status.textContent = 'Garbage+ used';
        p2Status.textContent = '+2 garbage rows received';
        caption.textContent = 'Sent! Two red garbage rows rise on Player 2’s board. Each row leaves one open hole.';
      } else if (item.id === 'CLEAR_COLUMN') {
        p1.querySelectorAll('.manual-duel-cell').forEach((cell, index) => {
          if (index % 10 === 0) cell.classList.remove('filled');
        });
        p1Status.textContent = 'Tallest column wiped';
        p2Status.textContent = 'Unaffected';
        caption.textContent = 'Player 1 clears one of their tallest columns to make room in the stack.';
      } else if (item.id === 'SLOWMO') {
        p1Status.textContent = 'Purple piece falls slowly / 6s';
        p2Status.textContent = 'Unaffected';
        caption.textContent = 'The purple block falls slowly on Player 1’s board. Slow-Mo lengthens the fall interval for 6 seconds.';
      } else if (item.id === 'FOG') {
        p1Status.textContent = 'Fog sent';
        p2Status.textContent = 'Board obscured for 5 seconds';
        caption.textContent = 'Player 2’s board is fogged for 5 seconds, making their stack harder to read.';
      } else if (item.id === 'HEAVY') {
        p1Status.textContent = 'Heavy Piece sent';
        p2Status.textContent = 'Orange piece falls fast / 5s';
        caption.textContent = 'The orange block drops rapidly on Player 2’s board. Heavy Piece shortens the fall interval for 5 seconds.';
      }
    }, 920));
  },

  _resetDuelSample(stage, item) {
    stage.dataset.phase = 'ready';
    const p1 = stage.querySelector('[data-player="1"]');
    const p2 = stage.querySelector('[data-player="2"]');
    [p1, p2].forEach((player, playerIndex) => {
      player.querySelectorAll('.manual-duel-cell').forEach((cell, index) => {
        const row = Math.floor(index / 10), col = index % 10;
        cell.className = 'manual-duel-cell';
        if (row >= 10 && (playerIndex === 0 ? col !== 3 : col !== 6)) cell.classList.add('filled');
      });
      player.querySelector('.manual-duel-status').textContent = 'Stack shown before item use';
    });
    p1.querySelector('.manual-duel-status').textContent = item.id === 'SHIELD' ? 'Incoming hit will be blocked' : 'Stack shown before item use';
    const shield = stage.querySelector('.manual-duel-shield');
    if (shield) shield.textContent = 'SHIELD READY';
  },

  _onClick(event) {
    const button = event.target.closest('button');
    if (!button || !this.overlay.contains(button)) return;
    if (button.dataset.tab) {
      this.activeTab = button.dataset.tab;
      this._render();
    } else if (button.dataset.item) {
      this.selectedItem = button.dataset.item;
      this._renderItems(this.overlay.querySelector('#manualContent'));
      FocusNav.refresh(true);
    } else if (button.dataset.action === 'close') this.close();
    else if (button.dataset.action === 'run-duel') this._tryItem();
    else if (button.dataset.action === 'left') this._movePractice(-1);
    else if (button.dataset.action === 'right') this._movePractice(1);
    else if (button.dataset.action === 'rotate') this._rotatePractice();
    else if (button.dataset.action === 'drop') this._dropPractice();
    else if (button.dataset.action === 'reset-practice') this._resetPractice();
    if (window.AudioManager) AudioManager.buttonClick();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('openManualBtn');
  if (startButton) startButton.addEventListener('click', () => ManualGuide.open());
});