/**
 * aiController.js
 * =====================================================================
 * TETRIS AI BOT SYSTEM
 * ---------------------------------------------------------------------
 * Gives AI-controlled players (assignment.type === 'bot', see
 * ControllerSetup / MatchSetupMenu) a way to play using the *exact*
 * same Player API a human's keyboard/gamepad input drives: move(),
 * tryRotate(), hold(), hardDrop(), and the softDropping flag. A bot
 * never touches grid/px/py/rotState directly and never bypasses
 * collision, lock delay, or gravity — see game.js's gridCollides(),
 * which this file's search uses read-only, on a *cloned* grid.
 *
 * Architecture (kept in one file for simplicity, but cleanly separated
 * into independent pieces so any one of them can be swapped out later):
 *
 *   DIFFICULTY_PROFILES  - tunable knobs per difficulty (Easy/Normal/
 *                           Hard/Expert): evaluation weights, lookahead
 *                           depth, mistake rate, reaction/input timing.
 *   BoardEvaluator        - scores a hypothetical resulting grid with a
 *                           weighted heuristic (aggregate height, holes,
 *                           bumpiness, completed lines, well depth...).
 *   MovePlanner           - enumerates every legal placement of a piece
 *                           (all rotations x all columns, simulated by
 *                           hard-dropping against a cloned grid), scores
 *                           each with BoardEvaluator (optionally with a
 *                           1-piece lookahead), and picks the best one —
 *                           also deciding whether swapping via Hold
 *                           would be an improvement.
 *   BotInputSimulator     - turns one MovePlanner decision into a
 *                           sequence of realistically-paced discrete
 *                           inputs (rotate, then slide, then drop),
 *                           executed a step at a time across frames so
 *                           a bot "plays" instead of teleporting.
 *   AIController          - the per-frame entry point MatchManager.loop
 *                           calls; dispatches to BotInputSimulator for
 *                           every live bot player.
 *
 * PERFORMANCE: a full placement search is only run once per spawned
 * piece (not per frame) — roughly 4 rotations x ~10 columns x (x2 for
 * a Hold candidate) x (x~40 again for 1-ply lookahead on Hard/Expert),
 * a few hundred cheap array scans, cached until the next piece. With
 * up to 3 simultaneous bots this is comfortably sub-millisecond work
 * spread across an already-idle animation frame — no stutter, no
 * frame drops, no per-frame recomputation.
 * =====================================================================
 */
"use strict";

/* ===================== DIFFICULTY PROFILES =====================
 * EDIT HERE TO RETUNE BOT SKILL/PERSONALITY
 * File: js/aiController.js | Section: DIFFICULTY_PROFILES
 * -----------------------------------------------------------------
 * weights       — heuristic weights fed into BoardEvaluator.evaluate().
 *                 Negative = "avoid", positive = "seek out".
 * lookaheadDepth— 0 = judge only the current piece's placement.
 *                 1 = also consider the best placement of the *next*
 *                 bag piece before committing (stronger, pricier).
 * useHold       — whether this difficulty is allowed to use Hold at all.
 * holdMargin    — how much better a held placement's score must be
 *                 before the bot bothers holding (avoids hold-flapping).
 * mistakeChance — probability, per piece, of a difficulty-appropriate
 *                 misjudgment (a randomly weaker, but still legal,
 *                 placement) instead of the true best one.
 * mistakeSpread — how far down the sorted candidate list a "mistake"
 *                 is allowed to reach into (as a fraction of the pool).
 * reactionMs    — [min,max] delay before a bot starts acting on a new
 *                 piece, simulating human perception + decision time.
 * moveIntervalMs— delay between each discrete input action (rotate
 *                 step / slide step) — the bot's "reflexes".
 * dropStyle     — 'hard' = always hard-drops once aligned (fast/precise).
 *                 'soft' = eases down via soft-drop + natural lock delay
 *                 (slower, more human, occasionally leaves openings).
 *                 'mixed'= coin-flip between the two per piece.
 * =================================================================== */
const DIFFICULTY_PROFILES = {
  easy: {
    label: 'Easy',
    weights: { aggregateHeight: -0.30, completedLines: 0.50, holes: -0.20, bumpiness: -0.08, maxHeight: -0.10, wellDepth: 0.00 },
    lookaheadDepth: 0,
    useHold: false,
    holdMargin: Infinity,
    mistakeChance: 0.35,
    mistakeSpread: 0.6,
    reactionMs: [500, 950],
    moveIntervalMs: 220,
    dropStyle: 'soft'
  },
  normal: {
    label: 'Normal',
    weights: { aggregateHeight: -0.51, completedLines: 0.76, holes: -0.36, bumpiness: -0.18, maxHeight: -0.15, wellDepth: 0.05 },
    lookaheadDepth: 0,
    useHold: true,
    holdMargin: 6,
    mistakeChance: 0.14,
    mistakeSpread: 0.3,
    reactionMs: [260, 460],
    moveIntervalMs: 140,
    dropStyle: 'mixed'
  },
  hard: {
    label: 'Hard',
    weights: { aggregateHeight: -0.55, completedLines: 0.90, holes: -0.50, bumpiness: -0.20, maxHeight: -0.20, wellDepth: 0.15 },
    lookaheadDepth: 1,
    useHold: true,
    holdMargin: 3,
    mistakeChance: 0.04,
    mistakeSpread: 0.12,
    reactionMs: [120, 230],
    moveIntervalMs: 90,
    dropStyle: 'hard'
  },
  expert: {
    label: 'Expert',
    weights: { aggregateHeight: -0.58, completedLines: 1.00, holes: -0.65, bumpiness: -0.25, maxHeight: -0.25, wellDepth: 0.25 },
    lookaheadDepth: 1,
    useHold: true,
    holdMargin: 1,
    mistakeChance: 0.0,
    mistakeSpread: 0,
    reactionMs: [60, 130],
    moveIntervalMs: 55,
    dropStyle: 'hard'
  }
};

/* =========================================================================
   BOARD EVALUATOR
   Pure heuristic scoring of a hypothetical *resulting* grid (after a
   piece has been placed and any completed lines removed). Higher is
   better. All inputs are read-only clones — never a live player's grid.
========================================================================= */
const BoardEvaluator = {
  evaluate(grid, weights, linesCleared) {
    const heights = this._columnHeights(grid);
    const aggregateHeight = heights.reduce((a, b) => a + b, 0);
    const holes = this._holes(grid);
    const bumpiness = this._bumpiness(heights);
    const maxHeight = Math.max(...heights);
    const wellDepth = this._wellSum(heights);
    return (
      weights.aggregateHeight * aggregateHeight +
      weights.completedLines * linesCleared +
      weights.holes * holes +
      weights.bumpiness * bumpiness +
      weights.maxHeight * maxHeight +
      weights.wellDepth * wellDepth
    );
  },

  _columnHeights(grid) {
    const heights = new Array(COLS).fill(0);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < grid.length; r++) {
        if (grid[r][c]) { heights[c] = grid.length - r; break; }
      }
    }
    return heights;
  },

  // Counts empty cells that have at least one filled cell somewhere above them.
  _holes(grid) {
    let holes = 0;
    for (let c = 0; c < COLS; c++) {
      let seenBlock = false;
      for (let r = 0; r < grid.length; r++) {
        if (grid[r][c]) seenBlock = true;
        else if (seenBlock) holes++;
      }
    }
    return holes;
  },

  _bumpiness(heights) {
    let total = 0;
    for (let c = 0; c < heights.length - 1; c++) total += Math.abs(heights[c] - heights[c + 1]);
    return total;
  },

  // Rewards keeping one column meaningfully lower than its neighbors (a
  // "well") — useful for setting up Tetrises with a vertical I piece.
  // Difficulty weight for this is 0 on Easy/Normal so lower difficulties
  // don't bother with this more advanced strategy.
  _wellSum(heights) {
    let total = 0;
    for (let c = 0; c < heights.length; c++) {
      const left = c === 0 ? null : heights[c - 1];
      const right = c === heights.length - 1 ? null : heights[c + 1];
      const neighborMin = left === null ? right : (right === null ? left : Math.min(left, right));
      if (neighborMin === null) continue;
      total += Math.max(0, neighborMin - heights[c]);
    }
    return total;
  }
};

/* =========================================================================
   MOVE PLANNER
   Enumerates legal placements for a piece against a cloned grid, scores
   them, and picks a target { rotation, col, useHold }. Never mutates a
   live Player — reads player.grid/current/holdPiece/bag/canHold once,
   then works entirely on copies.
========================================================================= */
const MovePlanner = {
  // All legal resting placements of `type` against `grid` (rotation x column),
  // found by rotating in place (no wall-kick simulation needed here — kicks
  // only matter for *how* a human/bot rotates mid-air, not where a piece can
  // ultimately land) and hard-dropping straight down.
  _candidatesFor(grid, type) {
    const results = [];
    const rotations = type === 'O' ? [0] : [0, 1, 2, 3];
    rotations.forEach(rot => {
      const shape = SHAPES[type][rot];
      let minC = 99, maxC = -99;
      shape.forEach(([, c]) => { minC = Math.min(minC, c); maxC = Math.max(maxC, c); });
      const pyMin = -minC, pyMax = (COLS - 1) - maxC;
      for (let py = pyMin; py <= pyMax; py++) {
        let px = -4; // start well above the board — only column bounds matter up here
        while (!gridCollides(grid, type, rot, px + 1, py)) px++;
        const cells = cellsForShape(type, rot, px, py);
        if (cells.some(([r]) => r < 0)) continue; // piece would rest partly above the visible/hidden grid — not a real landing
        const newGrid = grid.map(row => row.slice());
        cells.forEach(([r, c]) => { newGrid[r][c] = type; });
        const clearedRows = [];
        for (let r = 0; r < newGrid.length; r++) { if (newGrid[r].every(cell => cell !== null)) clearedRows.push(r); }
        clearedRows.forEach(r => { newGrid.splice(r, 1); newGrid.unshift(new Array(COLS).fill(null)); });
        results.push({ rot, py, resultGrid: newGrid, linesCleared: clearedRows.length });
      }
    });
    return results;
  },

  // Scores every candidate placement for one piece, optionally blending in
  // a 1-ply lookahead (best placement of `lookaheadType` on top of each
  // candidate's resulting board).
  _bestForPiece(grid, type, profile, lookaheadType) {
    const candidates = this._candidatesFor(grid, type);
    if (candidates.length === 0) return null;
    candidates.forEach(c => {
      let score = BoardEvaluator.evaluate(c.resultGrid, profile.weights, c.linesCleared);
      if (profile.lookaheadDepth > 0 && lookaheadType) {
        const next = this._candidatesFor(c.resultGrid, lookaheadType);
        if (next.length > 0) {
          let bestNext = -Infinity;
          next.forEach(nc => {
            const s2 = BoardEvaluator.evaluate(nc.resultGrid, profile.weights, nc.linesCleared);
            if (s2 > bestNext) bestNext = s2;
          });
          score = score * 0.6 + bestNext * 0.4;
        }
      }
      c.score = score;
    });
    candidates.sort((a, b) => b.score - a.score);
    return { best: candidates[0], candidates };
  },

  /**
   * findBestMove(player, profile)
   * Returns { rotation, col, useHold } or null if no legal placement
   * exists (board effectively topped out — the bot just lets physics
   * take its course, same as a human out of good options).
   */
  findBestMove(player, profile) {
    const grid = player.grid;
    const currentType = player.current;
    const holdType = player.holdPiece;
    const nextType = player.bag.peek(1)[0];

    const noHold = this._bestForPiece(grid, currentType, profile, nextType);

    let useHold = false;
    let holdResult = null;
    if (profile.useHold && player.canHold) {
      const pieceAfterHold = holdType || nextType; // empty hold slot pulls the next bag piece in, same as real hold()
      if (pieceAfterHold) {
        holdResult = this._bestForPiece(grid, pieceAfterHold, profile, null);
        if (holdResult && (!noHold || holdResult.best.score > noHold.best.score + profile.holdMargin)) {
          useHold = true;
        }
      }
    }

    const chosen = useHold ? holdResult : noHold;
    if (!chosen) return null;

    // Difficulty-appropriate imperfection: sometimes take a real, legal,
    // but weaker placement instead of the true best one. Never applied
    // to a hold decision — the hold/no-hold choice itself stays "correct"
    // once made, only the *placement* gets fuzzy.
    let pick = chosen.best;
    if (!useHold && chosen.candidates.length > 1 && Math.random() < profile.mistakeChance) {
      const poolSize = Math.max(2, Math.floor(chosen.candidates.length * profile.mistakeSpread));
      const idx = 1 + Math.floor(Math.random() * Math.min(poolSize, chosen.candidates.length - 1));
      pick = chosen.candidates[idx] || pick;
    }

    return { rotation: pick.rot, col: pick.py, useHold };
  }
};

/* =========================================================================
   BOT INPUT SIMULATOR
   Converts one MovePlanner decision into a realistically-paced sequence
   of real Player input calls, one discrete action per allowed tick. This
   is a closed-loop controller (it re-reads the player's *actual* current
   rotation/column every tick rather than trusting an upfront plan), so
   it stays correct even when a real tryRotate() wall-kick nudges the
   piece somewhere the open-loop search didn't anticipate.
========================================================================= */
const BotInputSimulator = {
  _states: new Map(), // playerId -> per-bot state

  reset(playerId) { this._states.delete(playerId); },

  _get(playerId) {
    let st = this._states.get(playerId);
    if (!st) { st = { phase: 'idle', lastSpawnSeq: -1 }; this._states.set(playerId, st); }
    return st;
  },

  update(dt, player, profile) {
    const st = this._get(player.id);

    // A new piece to deal with (fresh spawn OR a hold-swap) — drop any
    // stale plan and roll a fresh human-like reaction delay.
    if (player.spawnSeq !== st.lastSpawnSeq) {
      st.lastSpawnSeq = player.spawnSeq;
      st.phase = 'thinking';
      st.reactionTimer = profile.reactionMs[0] + Math.random() * (profile.reactionMs[1] - profile.reactionMs[0]);
      st.actionTimer = 0;
      st.plan = null;
      st.holdUsed = false;
      st.dropDecision = profile.dropStyle === 'mixed' ? (Math.random() < 0.5 ? 'hard' : 'soft') : profile.dropStyle;
      player.softDropping = false; // clear any soft-drop left on from the previous piece
    }

    if (st.phase === 'thinking') {
      st.reactionTimer -= dt;
      if (st.reactionTimer <= 0) {
        st.plan = MovePlanner.findBestMove(player, profile);
        st.phase = 'acting';
        st.actionTimer = 0;
      }
      return;
    }

    if (st.phase !== 'acting') return; // 'done' — waiting for the next piece
    if (!st.plan) { st.phase = 'done'; return; } // no legal placement found; let gravity/lock resolve it, same as a stuck human

    st.actionTimer -= dt;
    if (st.actionTimer > 0) return;
    st.actionTimer = profile.moveIntervalMs;

    // 1) Hold, if planned, before doing anything else (matches the plan,
    //    which was computed for the piece that would result from holding).
    if (st.plan.useHold && !st.holdUsed && player.canHold) {
      player.hold();
      st.holdUsed = true;
      return;
    }

    // 2) Rotate toward the target rotation, shortest path (uses the 180
    //    rotate the same way a human pressing both rotate buttons would).
    if (player.rotState !== st.plan.rotation) {
      const diff = (st.plan.rotation - player.rotState + 4) % 4;
      if (diff === 2) player.tryRotate(2);
      else if (diff === 1) player.tryRotate(1);
      else player.tryRotate(-1);
      return;
    }

    // 3) Slide toward the target column.
    if (player.py !== st.plan.col) {
      player.move(player.py < st.plan.col ? 1 : -1);
      return;
    }

    // 4) Aligned — commit.
    if (st.dropDecision === 'soft') {
      player.softDropping = true; // gravity + normal lock delay finish the job, like a human easing it down
    } else {
      player.hardDrop();
    }
    st.phase = 'done';
  }
};

/* =========================================================================
   AI CONTROLLER
   Per-frame entry point called from MatchManager.loop(). Only ever acts
   on players explicitly assigned as bots — human players are completely
   untouched, and a slot that was never created as a Player (inactive)
   is never iterated over at all, so it costs nothing.
========================================================================= */
const AIController = {
  update(dt, players) {
    for (const p of players) {
      if (p.assignment.type !== 'bot' || !p.alive) continue;
      const profile = DIFFICULTY_PROFILES[p.assignment.difficulty] || DIFFICULTY_PROFILES.normal;
      BotInputSimulator.update(dt, p, profile);
    }
  },

  resetPlayer(playerId) { BotInputSimulator.reset(playerId); }
};
