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

// ----- Node test hook -----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeMove, legalMoves, applyMove, hasWon, toGlobalIndex,
    isSafe, PLAYER_DEFS, MAIN_TRACK_LEN, PATH_TRACK_STEPS, HOME_COL_STEPS, SAFE_SQUARES,
  };
}

// ----- Browser UI (skipped under Node) -----
if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const CELL = canvas.width / 15; // classic Ludo is a 15x15 grid

  let game = null;
  let anim = null;      // active token slide animation
  let flashes = [];     // capture flash particles
  let diceSpin = 0;     // frames remaining of dice spin

  const TRACK_CELLS = buildTrackCells();
  const HOME_CELLS = buildHomeCells();
  const YARD_CELLS = buildYardCells();

  function buildTrackCells() {
    const p = [];
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
    for (const [c, r] of seq) p.push({ c, r });
    return p;
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

  function cellCenter(c, r) {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
  }
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

  // Build the sequence of board cells a token passes through for a move,
  // so the slide animation follows the path (not a straight line).
  function pathPoints(playerId, from, to, tokenIndex) {
    const pts = [];
    // yard -> track entry: just two points
    if (from.state === 'yard') {
      pts.push(tokenXY(playerId, from, tokenIndex));
      pts.push(tokenXY(playerId, to, tokenIndex));
      return pts;
    }
    // walk step-by-step from 'from' to 'to' through track/home
    let cur = { ...from };
    pts.push(tokenXY(playerId, cur, tokenIndex));
    let guard = 0;
    while (guard++ < 80) {
      if (cur.state === to.state && cur.step === to.step) break;
      if (cur.state === 'done') break;
      // advance one step
      if (cur.state === 'track') {
        if (cur.step < PATH_TRACK_STEPS - 1 && !(to.state === 'home' || to.state === 'done') ) {
          cur = { state:'track', step: cur.step + 1 };
        } else if (cur.step < PATH_TRACK_STEPS - 1) {
          cur = { state:'track', step: cur.step + 1 };
        } else {
          cur = { state:'home', step: 0 };
        }
      } else if (cur.state === 'home') {
        if (cur.step < HOME_COL_STEPS - 1 && to.state === 'home') cur = { state:'home', step: cur.step + 1 };
        else if (to.state === 'done') { pts.push(cellCenter(7,7)); break; }
        else cur = { state:'home', step: cur.step + 1 };
      }
      pts.push(tokenXY(playerId, cur, tokenIndex));
      if (cur.state === to.state && cur.step === to.step) break;
    }
    return pts;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2a1e0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < TRACK_CELLS.length; i++) {
      const { c, r } = TRACK_CELLS[i];
      drawCell(c, r, SAFE_SQUARES.has(i) ? '#5a4a2a' : '#efe6d0', '#000');
      if (SAFE_SQUARES.has(i)) drawStar(c, r);
    }
    for (const def of PLAYER_DEFS) {
      if (!game || def.id >= game.numPlayers) continue;
      for (const [c, r] of HOME_CELLS[def.id]) drawCell(c, r, def.color, '#000', 0.55);
      for (const [c, r] of YARD_CELLS[def.id]) drawCell(c, r, def.color, '#000', 0.35);
    }
    drawCell(7, 7, '#f2c200', '#000');

    if (game) {
      for (const player of game.players) {
        const def = PLAYER_DEFS[player.id];
        player.tokens.forEach((pos, idx) => {
          // if this token is mid-animation, skip (drawn separately on top)
          if (anim && anim.playerId === player.id && anim.tokenIndex === idx) return;
          const { x, y } = tokenXY(player.id, pos, idx);
          const off = (idx - 1.5) * 4;
          const movable = game.awaitingMove && game.current === player.id &&
            game.legal.some(m => m.tokenIndex === idx);
          drawToken(x + off, y + off, def.color, movable);
        });
      }
      // animating token on top
      if (anim) {
        const def = PLAYER_DEFS[anim.playerId];
        drawToken(anim.x, anim.y, def.color, false);
      }
    }
    // capture flashes
    for (const f of flashes) {
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.beginPath();
      ctx.arc(f.x, f.y, (1 - f.life / f.max) * CELL * 1.2, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
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
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.font = `${CELL * 0.5}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', x, y);
  }
  function drawToken(x, y, color, highlight) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = highlight ? 3.5 : 1.5;
    ctx.strokeStyle = highlight ? '#fff' : '#000';
    ctx.stroke();
    if (highlight) {
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ----- animation loop -----
  function loop() {
    let needMore = false;
    if (anim) {
      anim.t += anim.speed;
      // advance along polyline pts by fraction t (0..1 over whole path)
      const segs = anim.pts.length - 1;
      const pos = anim.t * segs;
      const i = Math.min(Math.floor(pos), segs - 1);
      const frac = pos - i;
      const a = anim.pts[i], b = anim.pts[i + 1];
      anim.x = a.x + (b.x - a.x) * frac;
      anim.y = a.y + (b.y - a.y) * frac;
      if (anim.t >= 1) {
        const done = anim.onDone;
        anim = null;
        if (done) done();
      } else {
        needMore = true;
      }
    }
    flashes = flashes.filter(f => (f.life -= 1) > 0);
    if (flashes.length) needMore = true;
    draw();
    if (needMore || anim) requestAnimationFrame(loop);
  }
  function kick() { requestAnimationFrame(loop); }

  function animateMove(playerId, tokenIndex, from, to, onDone) {
    const pts = pathPoints(playerId, from, to, tokenIndex);
    const segs = Math.max(1, pts.length - 1);
    anim = {
      playerId, tokenIndex, pts, t: 0,
      speed: Math.min(0.08, 0.6 / segs) * 1.6, // longer paths animate a bit faster per-seg
      x: pts[0].x, y: pts[0].y, onDone,
    };
    kick();
  }

  function addFlash(x, y) { flashes.push({ x, y, life: 24, max: 24 }); kick(); }

  // ----- UI wiring -----
  const setup = document.getElementById('setup');
  const turnArea = document.getElementById('turnArea');
  const statusEl = document.getElementById('status');
  const diceEl = document.getElementById('dice');
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
      chip.innerHTML = `<span class="dot" style="background:${def.color}"></span>${def.name} (${done}/4 home)`;
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
    game = newGame(n);
    setup.classList.add('hidden');
    turnArea.classList.remove('hidden');
    rollBtn.disabled = false;
    diceEl.textContent = '🎲';
    setStatus(`${PLAYER_DEFS[game.current].name}'s turn — roll!`);
    showBanner(`${PLAYER_DEFS[game.current].name} starts!`);
    renderLegend();
    draw();
  }

  function roll() {
    if (!game || game.awaitingMove || anim) return;
    rollBtn.disabled = true;
    diceEl.classList.add('rolling');
    // brief dice shuffle for feel
    let ticks = 8;
    const shuffle = setInterval(() => {
      diceEl.textContent = 1 + Math.floor(Math.random() * 6);
      if (--ticks <= 0) {
        clearInterval(shuffle);
        diceEl.classList.remove('rolling');
        settleRoll();
      }
    }, 55);
  }

  function settleRoll() {
    const dice = 1 + Math.floor(Math.random() * 6);
    game.dice = dice;
    diceEl.textContent = dice;
    const legal = legalMoves(game, game.current, dice);
    game.legal = legal;
    if (legal.length === 0) {
      setStatus(`${PLAYER_DEFS[game.current].name} rolled ${dice} — no legal move.`);
      setTimeout(() => nextTurn(dice === 6), 600);
      return;
    }
    game.awaitingMove = true;
    setStatus(`${PLAYER_DEFS[game.current].name} rolled ${dice} — tap a highlighted token.`);
    draw();
  }

  function nextTurn(extra) {
    game.awaitingMove = false;
    game.legal = [];
    rollBtn.disabled = false;
    if (!extra) game.current = (game.current + 1) % game.numPlayers;
    setStatus(`${PLAYER_DEFS[game.current].name}'s turn — roll!` + (extra ? ' (bonus 6!)' : ''));
    showBanner(extra ? `Bonus roll!` : `${PLAYER_DEFS[game.current].name}'s turn`);
    renderLegend();
    draw();
  }

  function handlePoint(clientX, clientY) {
    if (!game || !game.awaitingMove || anim) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (clientX - rect.left) * (canvas.width / rect.width);
    const my = (clientY - rect.top) * (canvas.height / rect.height);
    const player = game.players.find(p => p.id === game.current);
    for (const move of game.legal) {
      const pos = player.tokens[move.tokenIndex];
      const { x, y } = tokenXY(player.id, pos, move.tokenIndex);
      if (Math.hypot(mx - x, my - y) <= CELL * 0.55) {
        const from = { ...pos };
        const dest = move.dest;
        game.awaitingMove = false; // lock input during animation
        animateMove(player.id, move.tokenIndex, from, dest, () => {
          const res = applyMove(game, player.id, move.tokenIndex, dest);
          if (res.captured.length) {
            for (const cap of res.captured) {
              const cpos = { state:'track', step: 0 }; // already moved to yard; flash at dest
              const { x: fx, y: fy } = tokenXY(player.id, dest, move.tokenIndex);
              addFlash(fx, fy);
            }
            showBanner(`Capture! ${res.captured.length} sent home`, 1100);
          }
          if (hasWon(player)) {
            setStatus(`🏆 ${PLAYER_DEFS[player.id].name} wins!`);
            showBanner(`🏆 ${PLAYER_DEFS[player.id].name} wins!`, 4000);
            rollBtn.disabled = true;
            renderLegend();
            draw();
            return;
          }
          nextTurn(game.dice === 6);
        });
        return;
      }
    }
  }

  canvas.addEventListener('click', (e) => handlePoint(e.clientX, e.clientY));
  canvas.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length) {
      const t = e.changedTouches[0];
      e.preventDefault();
      handlePoint(t.clientX, t.clientY);
    }
  }, { passive: false });

  rollBtn.addEventListener('click', roll);
  resetBtn.addEventListener('click', () => {
    game = null; anim = null; flashes = [];
    turnArea.classList.add('hidden');
    setup.classList.remove('hidden');
    legend.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw();
  });
  startBtn.addEventListener('click', startGame);

  draw();
}
