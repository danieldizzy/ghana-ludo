/* Ghana Ludo — classic Ludo engine + canvas rendering.
 * Hot-seat 2-4 players. Pure-logic functions are exported for Node testing
 * via module.exports (guarded) so rules can be verified headlessly.
 */

// ----- Board model -----
// Classic Ludo: a shared main track of 52 squares (indices 0..51), traversed
// clockwise. Each player enters at a fixed square and, after a full loop, turns
// into a 6-square private home column, then a final home slot.
//
// We model each token's position as one of:
//   { state: 'yard' }                       -> not yet on board
//   { state: 'track', step: 0..50 }         -> steps taken along THIS player's path
//                                              before entering home column (0 = just entered)
//   { state: 'home', step: 0..5 }           -> in the home column
//   { state: 'done' }                       -> reached final home slot
//
// A player's path length on the main track is 51 steps (step 0..50), then 6 home
// steps (0..5), then done. Total distance to finish = 51 + 6 = 57 moves from entry,
// and a token needs to roll exactly onto 'done'.

const PLAYER_DEFS = [
  { id: 0, name: 'Red',    color: '#d7263d', entry: 0 },
  { id: 1, name: 'Green',  color: '#2a9d3b', entry: 13 },
  { id: 2, name: 'Yellow', color: '#f2c200', entry: 26 },
  { id: 3, name: 'Blue',   color: '#1f6feb', entry: 39 },
];

const MAIN_TRACK_LEN = 52;
const PATH_TRACK_STEPS = 51; // steps 0..50 on the main track for a given player
const HOME_COL_STEPS = 6;    // steps 0..5 in home column
// "Safe" squares (global track indices): each player's entry square + star squares.
const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Convert a player's local track step to a global main-track index.
function toGlobalIndex(playerId, step) {
  const entry = PLAYER_DEFS[playerId].entry;
  return (entry + step) % MAIN_TRACK_LEN;
}

// ----- Pure rules -----

// Given a token and a dice value, return the resulting token position or null if illegal.
function computeMove(token, dice) {
  if (token.state === 'done') return null;

  if (token.state === 'yard') {
    // Can only leave the yard on a 6, landing on entry (local step 0).
    if (dice === 6) return { state: 'track', step: 0 };
    return null;
  }

  if (token.state === 'track') {
    const target = token.step + dice;
    if (target <= PATH_TRACK_STEPS - 1) {
      return { state: 'track', step: target };
    }
    // entering / moving through home column
    const homeStep = target - PATH_TRACK_STEPS; // 0-based into home column
    if (homeStep < HOME_COL_STEPS) {
      return { state: 'home', step: homeStep };
    }
    if (homeStep === HOME_COL_STEPS) {
      return { state: 'done' };
    }
    return null; // overshoot — illegal
  }

  if (token.state === 'home') {
    const target = token.step + dice;
    if (target < HOME_COL_STEPS) return { state: 'home', step: target };
    if (target === HOME_COL_STEPS) return { state: 'done' };
    return null; // overshoot
  }

  return null;
}

// Are two on-track tokens on the same global square?
function sameTrackSquare(playerA, posA, playerB, posB) {
  if (posA.state !== 'track' || posB.state !== 'track') return false;
  return toGlobalIndex(playerA, posA.step) === toGlobalIndex(playerB, posB.step);
}

function isSafe(playerId, pos) {
  if (pos.state !== 'track') return false;
  return SAFE_SQUARES.has(toGlobalIndex(playerId, pos.step));
}

// Compute legal moves for a player given a dice roll.
// state.players = [{ id, tokens: [pos,pos,pos,pos] }]
function legalMoves(state, playerId, dice) {
  const player = state.players.find(p => p.id === playerId);
  const moves = [];
  player.tokens.forEach((tok, idx) => {
    const dest = computeMove(tok, dice);
    if (dest) moves.push({ tokenIndex: idx, dest });
  });
  return moves;
}

// Apply a move; mutates state. Returns { captured: [...] } info.
function applyMove(state, playerId, tokenIndex, dest) {
  const player = state.players.find(p => p.id === playerId);
  player.tokens[tokenIndex] = dest;

  const captured = [];
  if (dest.state === 'track' && !isSafe(playerId, dest)) {
    for (const other of state.players) {
      if (other.id === playerId) continue;
      other.tokens.forEach((otok, oidx) => {
        if (sameTrackSquare(playerId, dest, other.id, otok)) {
          other.tokens[oidx] = { state: 'yard' };
          captured.push({ playerId: other.id, tokenIndex: oidx });
        }
      });
    }
  }
  return { captured };
}

function hasWon(player) {
  return player.tokens.every(t => t.state === 'done');
}

// ----- AI (pure, testable) -----
// Score each legal move and return the best one. Heuristic priorities:
//   +1000  move captures an opponent
//   +500   move finishes a token (reaches 'done')
//   +300   move brings a token out of the yard (dice===6)
//   +120   move lands on a safe square
//   +value advance distance (further progress preferred)
//   -80    moving onto a non-safe track square where an opponent could be adjacent-behind
// Returns { tokenIndex, dest, score } or null if no legal moves.
function chooseAIMove(state, playerId, dice) {
  const moves = legalMoves(state, playerId, dice);
  if (moves.length === 0) return null;
  const player = state.players.find(p => p.id === playerId);

  function progress(pos) {
    if (pos.state === 'yard') return 0;
    if (pos.state === 'track') return pos.step + 1;
    if (pos.state === 'home') return PATH_TRACK_STEPS + pos.step + 1;
    if (pos.state === 'done') return PATH_TRACK_STEPS + HOME_COL_STEPS + 2;
    return 0;
  }

  // Would this destination capture an opponent? (mirror of applyMove's capture rule)
  function capturesAt(dest) {
    if (dest.state !== 'track' || isSafe(playerId, dest)) return false;
    const g = toGlobalIndex(playerId, dest.step);
    for (const other of state.players) {
      if (other.id === playerId) continue;
      for (const otok of other.tokens) {
        if (otok.state === 'track' && toGlobalIndex(other.id, otok.step) === g) return true;
      }
    }
    return false;
  }

  let best = null;
  for (const m of moves) {
    const from = player.tokens[m.tokenIndex];
    let score = 0;
    if (capturesAt(m.dest)) score += 1000;
    if (m.dest.state === 'done') score += 500;
    if (from.state === 'yard' && m.dest.state === 'track') score += 300;
    if (isSafe(playerId, m.dest)) score += 120;
    score += progress(m.dest) * 2;
    if (m.dest.state === 'track' && !isSafe(playerId, m.dest)) score -= 20; // mild exposure penalty
    if (best === null || score > best.score) best = { tokenIndex: m.tokenIndex, dest: m.dest, score };
  }
  return best;
}

// ----- Node test hook -----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeMove, legalMoves, applyMove, hasWon, chooseAIMove, toGlobalIndex,
    isSafe, PLAYER_DEFS, MAIN_TRACK_LEN, PATH_TRACK_STEPS, HOME_COL_STEPS, SAFE_SQUARES,
  };
}

// ----- Browser UI (skipped under Node) -----
if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const fx = document.getElementById('fx');
  const fxc = fx.getContext('2d');
  const CELL = canvas.width / 15;

  let game = null;
  let anim = null;       // token slide
  let flashes = [];      // capture rings
  let pops = [];         // landing pop rings
  let confetti = [];     // win celebration
  let fxActive = false;
  let aiPlayers = new Set(); // which player ids are AI-controlled
  let soundOn = true;

  // ---------- WebAudio sound (no files) ----------
  const Sound = (() => {
    let actx = null;
    function ensure() {
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { actx = null; }
      }
      if (actx && actx.state === 'suspended') actx.resume();
      return actx;
    }
    function blip(freq, dur, type = 'sine', gain = 0.15, slideTo = null) {
      if (!soundOn) return;
      const ac = ensure();
      if (!ac) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    }
    return {
      unlock() { ensure(); },
      roll()    { blip(220, 0.08, 'square', 0.08); setTimeout(() => blip(300, 0.08, 'square', 0.08), 70); },
      move()    { blip(440, 0.07, 'triangle', 0.12); },
      land()    { blip(520, 0.09, 'sine', 0.14); },
      capture() { blip(300, 0.18, 'sawtooth', 0.18, 120); },
      win()     { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>blip(f,0.25,'triangle',0.18), i*140)); },
    };
  })();

  const TRACK_CELLS = buildTrackCells();
  const HOME_CELLS = buildHomeCells();
  const YARD_CELLS = buildYardCells();

  function buildTrackCells() {
    const seq = [
      [1,6],[2,6],[3,6],[4,6],[5,6],
      [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
      [7,0],
      [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],
      [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
      [14,7],
      [14,8],[13,8],[12,8],[11,8],[10,8],[9,8],
      [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
      [7,14],
      [6,14],[6,13],[6,12],[6,11],[6,10],[6,9],
      [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
      [0,7],
      [0,6],
    ];
    return seq.map(([c, r]) => ({ c, r }));
  }
  function buildHomeCells() {
    return {
      0: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
      1: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
      2: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
      3: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
    };
  }
  function buildYardCells() {
    return {
      0: [[2,2],[3,2],[2,3],[3,3]],
      1: [[11,2],[12,2],[11,3],[12,3]],
      2: [[11,11],[12,11],[11,12],[12,12]],
      3: [[2,11],[3,11],[2,12],[3,12]],
    };
  }

  function newGame(numPlayers) {
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
      players.push({ id: i, tokens: [ {state:'yard'},{state:'yard'},{state:'yard'},{state:'yard'} ] });
    }
    return { players, current: 0, dice: null, awaitingMove: false, legal: [], numPlayers };
  }

  function cellCenter(c, r) { return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }; }
  function tokenCell(playerId, pos, tokenIndex) {
    if (pos.state === 'yard') { const [c,r] = YARD_CELLS[playerId][tokenIndex]; return {c,r}; }
    if (pos.state === 'track') return TRACK_CELLS[toGlobalIndex(playerId, pos.step)];
    if (pos.state === 'home') { const [c,r] = HOME_CELLS[playerId][pos.step]; return {c,r}; }
    return { c: 7, r: 7 };
  }
  function tokenXY(playerId, pos, tokenIndex) {
    const { c, r } = tokenCell(playerId, pos, tokenIndex);
    return cellCenter(c, r);
  }

  function pathPoints(playerId, from, to, tokenIndex) {
    const pts = [];
    if (from.state === 'yard') {
      pts.push(tokenXY(playerId, from, tokenIndex));
      pts.push(tokenXY(playerId, to, tokenIndex));
      return pts;
    }
    let cur = { ...from };
    pts.push(tokenXY(playerId, cur, tokenIndex));
    let guard = 0;
    while (guard++ < 80) {
      if (cur.state === to.state && cur.step === to.step) break;
      if (cur.state === 'track') {
        if (cur.step < PATH_TRACK_STEPS - 1) cur = { state:'track', step: cur.step + 1 };
        else cur = { state:'home', step: 0 };
      } else if (cur.state === 'home') {
        if (to.state === 'done') { pts.push(cellCenter(7,7)); break; }
        cur = { state:'home', step: cur.step + 1 };
      } else break;
      pts.push(tokenXY(playerId, cur, tokenIndex));
      if (cur.state === to.state && cur.step === to.step) break;
    }
    return pts;
  }

  // ---------- board drawing (static layer) ----------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2a1e0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < TRACK_CELLS.length; i++) {
      const { c, r } = TRACK_CELLS[i];
      drawCell(c, r, SAFE_SQUARES.has(i) ? '#6a5428' : '#efe6d0', '#00000055');
      if (SAFE_SQUARES.has(i)) drawStar(c, r);
    }
    for (const def of PLAYER_DEFS) {
      if (!game || def.id >= game.numPlayers) continue;
      for (const [c, r] of HOME_CELLS[def.id]) drawCell(c, r, def.color, '#00000055', 0.6);
      // yard base block
      drawYard(def.id, def.color);
    }
    drawCenter();

    if (game) {
      for (const player of game.players) {
        const def = PLAYER_DEFS[player.id];
        player.tokens.forEach((pos, idx) => {
          if (anim && anim.playerId === player.id && anim.tokenIndex === idx) return;
          const { x, y } = tokenXY(player.id, pos, idx);
          const off = (idx - 1.5) * 4;
          const movable = game.awaitingMove && game.current === player.id &&
            game.legal.some(m => m.tokenIndex === idx);
          drawToken(x + off, y + off, def.color, movable);
        });
      }
      if (anim) drawToken(anim.x, anim.y, PLAYER_DEFS[anim.playerId].color, false, anim.lift);
    }
  }

  function drawYard(id, color) {
    const cells = YARD_CELLS[id];
    const minC = Math.min(...cells.map(c => c[0]));
    const minR = Math.min(...cells.map(c => c[1]));
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.fillRect(minC * CELL - CELL*0.3, minR * CELL - CELL*0.3, CELL*2.6, CELL*2.6);
    ctx.globalAlpha = 1;
    for (const [c, r] of cells) {
      ctx.fillStyle = '#efe6d0';
      ctx.beginPath();
      const { x, y } = cellCenter(c, r);
      ctx.arc(x, y, CELL*0.36, 0, Math.PI*2);
      ctx.fill();
    }
  }
  function drawCenter() {
    const cx = 7.5 * CELL, cy = 7.5 * CELL;
    // triangular home colored wedges
    const pts = [[6,6],[9,6],[9,9],[6,9]].map(([c,r]) => ({x:c*CELL, y:r*CELL}));
    const colors = ['#d7263d','#2a9d3b','#f2c200','#1f6feb'];
    const corners = [
      [{x:6*CELL,y:6*CELL},{x:9*CELL,y:6*CELL}],
      [{x:9*CELL,y:6*CELL},{x:9*CELL,y:9*CELL}],
      [{x:9*CELL,y:9*CELL},{x:6*CELL,y:9*CELL}],
      [{x:6*CELL,y:9*CELL},{x:6*CELL,y:6*CELL}],
    ];
    corners.forEach((edge, i) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(edge[0].x, edge[0].y);
      ctx.lineTo(edge[1].x, edge[1].y);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
    });
    // gold hub
    ctx.beginPath();
    ctx.arc(cx, cy, CELL*0.7, 0, Math.PI*2);
    ctx.fillStyle = '#f2c200';
    ctx.fill();
    ctx.strokeStyle = '#00000055';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#1a1206';
    ctx.font = `bold ${CELL*0.7}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', cx, cy + CELL*0.05);
  }
  function drawCell(c, r, fill, stroke, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
  }
  function drawStar(c, r) {
    const { x, y } = cellCenter(c, r);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.font = `${CELL * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', x, y);
  }
  function drawToken(x, y, color, highlight, lift = 0) {
    const r = CELL * 0.32;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 5 + lift * 10;
    ctx.shadowOffsetY = 2 + lift * 6;
    const grad = ctx.createRadialGradient(x - r*0.3, y - r*0.3 - lift*8, r*0.2, x, y - lift*8, r);
    grad.addColorStop(0, '#ffffffcc');
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, shade(color, -0.25));
    ctx.beginPath();
    ctx.arc(x, y - lift*8, r, 0, Math.PI*2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = highlight ? 3.5 : 1.5;
    ctx.strokeStyle = highlight ? '#fff' : '#0008';
    ctx.stroke();
    if (highlight) {
      ctx.beginPath();
      ctx.arc(x, y, r*1.35, 0, Math.PI*2);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, r + amt*255));
    g = Math.max(0, Math.min(255, g + amt*255));
    b = Math.max(0, Math.min(255, b + amt*255));
    return `rgb(${r|0},${g|0},${b|0})`;
  }

  // ---------- fx layer (effects canvas on top) ----------
  function drawFx() {
    fxc.clearRect(0, 0, fx.width, fx.height);
    for (const f of flashes) {
      fxc.globalAlpha = Math.max(0, f.life / f.max);
      fxc.beginPath();
      fxc.arc(f.x, f.y, (1 - f.life / f.max) * CELL * 1.4, 0, Math.PI*2);
      fxc.strokeStyle = '#fff';
      fxc.lineWidth = 3;
      fxc.stroke();
    }
    for (const p of pops) {
      fxc.globalAlpha = Math.max(0, p.life / p.max);
      fxc.beginPath();
      fxc.arc(p.x, p.y, (1 - p.life / p.max) * CELL * 0.9, 0, Math.PI*2);
      fxc.strokeStyle = p.color;
      fxc.lineWidth = 2.5;
      fxc.stroke();
    }
    for (const c of confetti) {
      fxc.globalAlpha = Math.max(0, c.life / c.max);
      fxc.fillStyle = c.color;
      fxc.fillRect(c.x, c.y, c.s, c.s);
    }
    fxc.globalAlpha = 1;
  }

  // ---------- unified animation loop ----------
  function tick() {
    let more = false;
    if (anim) {
      anim.t += anim.speed;
      const segs = anim.pts.length - 1;
      const pos = anim.t * segs;
      const i = Math.min(Math.floor(pos), segs - 1);
      const frac = pos - i;
      const a = anim.pts[i], b = anim.pts[i + 1];
      anim.x = a.x + (b.x - a.x) * frac;
      anim.y = a.y + (b.y - a.y) * frac;
      anim.lift = Math.sin(frac * Math.PI) * 0.5; // hop between cells
      if (anim.t >= 1) {
        const done = anim.onDone; anim = null;
        if (done) done();
      } else more = true;
    }
    flashes = flashes.filter(f => (f.life -= 1) > 0);
    pops = pops.filter(p => (p.life -= 1) > 0);
    confetti = confetti.filter(c => {
      c.x += c.vx; c.y += c.vy; c.vy += 0.15; c.life -= 1;
      return c.life > 0 && c.y < fx.height + 20;
    });
    if (flashes.length || pops.length || confetti.length) more = true;
    draw();
    drawFx();
    fxActive = more || !!anim;
    if (fxActive) requestAnimationFrame(tick);
  }
  function kick() { if (!fxActive) { fxActive = true; requestAnimationFrame(tick); } }

  function animateMove(playerId, tokenIndex, from, to, onDone) {
    const pts = pathPoints(playerId, from, to, tokenIndex);
    const segs = Math.max(1, pts.length - 1);
    anim = { playerId, tokenIndex, pts, t: 0, speed: Math.max(0.03, 0.14 / Math.sqrt(segs)),
             x: pts[0].x, y: pts[0].y, lift: 0, onDone };
    kick();
  }
  function addFlash(x, y) { flashes.push({ x, y, life: 26, max: 26 }); kick(); }
  function addPop(x, y, color) { pops.push({ x, y, color, life: 18, max: 18 }); kick(); }
  function burstConfetti() {
    const colors = ['#d7263d','#2a9d3b','#f2c200','#1f6feb','#ffffff'];
    for (let i = 0; i < 120; i++) {
      confetti.push({
        x: fx.width/2, y: fx.height/2,
        vx: (Math.random()-0.5)*10, vy: (Math.random()-1)*8,
        s: 4 + Math.random()*6, color: colors[i % colors.length],
        life: 90 + Math.random()*40, max: 130,
      });
    }
    kick();
  }

  // ---------- UI wiring ----------
  const setup = document.getElementById('setup');
  const gameLayout = document.getElementById('gameLayout');
  const statusEl = document.getElementById('status');
  const diceEl = document.getElementById('dice');
  const diceFace = document.getElementById('diceFace');
  const rollBtn = document.getElementById('rollBtn');
  const resetBtn = document.getElementById('resetBtn');
  const startBtn = document.getElementById('startBtn');
  const legend = document.getElementById('legend');
  const banner = document.getElementById('banner');

  function renderLegend() {
    legend.innerHTML = '';
    if (!game) return;
    for (const player of game.players) {
      const def = PLAYER_DEFS[player.id];
      const chip = document.createElement('div');
      chip.className = 'chip' + (game.current === player.id ? ' active' : '');
      const done = player.tokens.filter(t => t.state === 'done').length;
      chip.innerHTML = `<span class="dot" style="background:${def.color}"></span>${def.name}${isAI(player.id) ? '<span class="ai-tag">AI</span>' : ''}<span class="count">${done}/4 home</span>`;
      legend.appendChild(chip);
    }
  }
  function setStatus(msg) { statusEl.textContent = msg; }
  function showBanner(msg, ms = 900) {
    banner.textContent = msg;
    banner.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => banner.classList.remove('show'), ms);
  }

  function startGame() {
    const n = parseInt(document.getElementById('playerCount').value, 10);
    const aiCount = Math.min(parseInt(document.getElementById('aiCount').value, 10), n - 0);
    soundOn = document.getElementById('soundToggle').checked;
    Sound.unlock(); // user gesture → allow audio
    game = newGame(n);
    // Assign AI to the LAST aiCount players so player 0 (you) is human.
    aiPlayers = new Set();
    for (let i = n - aiCount; i < n; i++) if (i >= 1) aiPlayers.add(i);
    setup.classList.add('hidden');
    gameLayout.classList.remove('hidden');
    rollBtn.disabled = false;
    diceFace.textContent = '·';
    setStatus(`${PLAYER_DEFS[game.current].name}'s turn`);
    showBanner(`${PLAYER_DEFS[game.current].name} starts!`);
    renderLegend();
    draw(); drawFx();
    maybeAITurn();
  }

  function isAI(playerId) { return aiPlayers.has(playerId); }

  // If the current player is AI, auto-play its turn after a short beat.
  function maybeAITurn() {
    if (!game || game.awaitingMove || anim) return;
    if (!isAI(game.current)) return;
    rollBtn.disabled = true;
    setTimeout(() => { if (game && isAI(game.current)) roll(); }, 650);
  }

  function roll() {
    if (!game || game.awaitingMove || anim) return;
    rollBtn.disabled = true;
    diceEl.classList.add('rolling');
    let ticks = 9;
    const shuffle = setInterval(() => {
      diceFace.textContent = 1 + Math.floor(Math.random() * 6);
      if (--ticks <= 0) { clearInterval(shuffle); diceEl.classList.remove('rolling'); settleRoll(); }
    }, 60);
  }
  function settleRoll() {
    const dice = 1 + Math.floor(Math.random() * 6);
    game.dice = dice;
    diceFace.textContent = dice;
    Sound.roll();
    const legal = legalMoves(game, game.current, dice);
    game.legal = legal;
    if (legal.length === 0) {
      setStatus(`${PLAYER_DEFS[game.current].name} rolled ${dice} — no move`);
      setTimeout(() => nextTurn(dice === 6), 650);
      return;
    }
    game.awaitingMove = true;
    if (isAI(game.current)) {
      // AI picks and plays its move automatically.
      const pick = chooseAIMove(game, game.current, dice);
      setStatus(`${PLAYER_DEFS[game.current].name} (AI) rolled ${dice}`);
      setTimeout(() => { if (game && pick) executeMove(game.current, pick.tokenIndex, pick.dest); }, 500);
    } else {
      setStatus(`Rolled ${dice} — tap a glowing token`);
      draw();
    }
  }

  // Shared move executor used by both human taps and AI.
  function executeMove(playerId, tokenIndex, dest) {
    const player = game.players.find(p => p.id === playerId);
    const from = { ...player.tokens[tokenIndex] };
    game.awaitingMove = false;
    Sound.move();
    animateMove(playerId, tokenIndex, from, dest, () => {
      const res = applyMove(game, playerId, tokenIndex, dest);
      const land = tokenXY(playerId, dest, tokenIndex);
      addPop(land.x, land.y, PLAYER_DEFS[playerId].color);
      Sound.land();
      if (res.captured.length) {
        addFlash(land.x, land.y);
        Sound.capture();
        showBanner(`Capture! ${res.captured.length} sent home`, 1100);
      }
      if (hasWon(player)) {
        setStatus(`🏆 ${PLAYER_DEFS[playerId].name} wins!`);
        showBanner(`🏆 ${PLAYER_DEFS[playerId].name} wins!`, 5000);
        Sound.win();
        burstConfetti();
        rollBtn.disabled = true;
        renderLegend();
        return;
      }
      nextTurn(game.dice === 6);
    });
  }
  function nextTurn(extra) {
    game.awaitingMove = false;
    game.legal = [];
    if (!extra) game.current = (game.current + 1) % game.numPlayers;
    const aiTag = isAI(game.current) ? ' (AI)' : '';
    setStatus(`${PLAYER_DEFS[game.current].name}${aiTag}'s turn` + (extra ? ' (bonus 6!)' : ''));
    showBanner(extra ? 'Bonus roll!' : `${PLAYER_DEFS[game.current].name}'s turn`);
    renderLegend();
    draw();
    rollBtn.disabled = isAI(game.current);
    maybeAITurn();
  }

  function handlePoint(clientX, clientY) {
    if (!game || !game.awaitingMove || anim) return;
    if (isAI(game.current)) return; // ignore taps during AI turns
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) * (canvas.width / rect.width);
    const my = (clientY - rect.top) * (canvas.height / rect.height);
    const player = game.players.find(p => p.id === game.current);
    for (const move of game.legal) {
      const pos = player.tokens[move.tokenIndex];
      const { x, y } = tokenXY(player.id, pos, move.tokenIndex);
      if (Math.hypot(mx - x, my - y) <= CELL * 0.6) {
        executeMove(player.id, move.tokenIndex, move.dest);
        return;
      }
    }
  }

  canvas.addEventListener('click', (e) => handlePoint(e.clientX, e.clientY));
  canvas.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length) {
      e.preventDefault();
      const t = e.changedTouches[0];
      handlePoint(t.clientX, t.clientY);
    }
  }, { passive: false });

  rollBtn.addEventListener('click', roll);
  resetBtn.addEventListener('click', () => {
    game = null; anim = null; flashes = []; pops = []; confetti = []; aiPlayers = new Set();
    gameLayout.classList.add('hidden');
    setup.classList.remove('hidden');
    legend.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fxc.clearRect(0, 0, fx.width, fx.height);
  });
  startBtn.addEventListener('click', startGame);

  draw();
}
