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

  let game = null; // { players, current, dice, awaitingMove, legal }

  // Precompute the 52 main-track grid cells (col,row) in clockwise order,
  // starting at Red's entry. This is the standard Ludo path layout.
  const TRACK_CELLS = buildTrackCells();
  // Home-column cells per player (6 each), from track toward center.
  const HOME_CELLS = buildHomeCells();
  // Yard slot cells per player (4 each).
  const YARD_CELLS = buildYardCells();

  function buildTrackCells() {
    // Grid is 15x15, indices 0..14. Center cross forms the track.
    // Hand-laid standard Ludo path (clockwise), 52 cells.
    const p = [];
    // Red entry start at (1,6) going right... we use the well-known layout.
    const seq = [
      [1,6],[2,6],[3,6],[4,6],[5,6],      // Red arm top row of lower-left path
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
    return p; // length 52
  }

  function buildHomeCells() {
    // 6 cells leading to center (7,7) for each player.
    return {
      0: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],   // Red  -> from left
      1: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],   // Green-> from top
      2: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],// Yellow-> from right
      3: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],// Blue -> from bottom
    };
  }

  function buildYardCells() {
    return {
      0: [[2,2],[3,2],[2,3],[3,3]],       // Red  top-left
      1: [[11,2],[12,2],[11,3],[12,3]],   // Green top-right
      2: [[11,11],[12,11],[11,12],[12,12]], // Yellow bottom-right
      3: [[2,11],[3,11],[2,12],[3,12]],   // Blue bottom-left
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
    if (pos.state === 'done') return { c: 7, r: 7 };
    return { c: 7, r: 7 };
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // base grid background
    ctx.fillStyle = '#2a1e0e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw track cells
    for (let i = 0; i < TRACK_CELLS.length; i++) {
      const { c, r } = TRACK_CELLS[i];
      drawCell(c, r, SAFE_SQUARES.has(i) ? '#5a4a2a' : '#efe6d0', '#000');
    }
    // home columns colored per player
    for (const def of PLAYER_DEFS) {
      if (!game || def.id >= game.numPlayers) continue;
      for (const [c, r] of HOME_CELLS[def.id]) drawCell(c, r, def.color, '#000', 0.55);
      // yard area
      const yc = YARD_CELLS[def.id];
      for (const [c, r] of yc) drawCell(c, r, def.color, '#000', 0.35);
    }
    // center
    drawCell(7, 7, '#f2c200', '#000');

    // tokens
    if (game) {
      for (const player of game.players) {
        const def = PLAYER_DEFS[player.id];
        player.tokens.forEach((pos, idx) => {
          const { c, r } = tokenCell(player.id, pos, idx);
          const { x, y } = cellCenter(c, r);
          // small offset so multiple tokens on a cell don't fully overlap
          const off = (idx - 1.5) * 4;
          drawToken(x + off, y + off, def.color,
            game.awaitingMove && game.current === player.id &&
            game.legal.some(m => m.tokenIndex === idx));
        });
      }
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

  function drawToken(x, y, color, highlight) {
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = highlight ? 3 : 1.5;
    ctx.strokeStyle = highlight ? '#fff' : '#000';
    ctx.stroke();
  }

  // ----- UI wiring -----
  const setup = document.getElementById('setup');
  const turnArea = document.getElementById('turnArea');
  const statusEl = document.getElementById('status');
  const diceEl = document.getElementById('dice');
  const rollBtn = document.getElementById('rollBtn');
  const resetBtn = document.getElementById('resetBtn');
  const startBtn = document.getElementById('startBtn');
  const legend = document.getElementById('legend');

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

  function startGame() {
    const n = parseInt(document.getElementById('playerCount').value, 10);
    game = newGame(n);
    setup.classList.add('hidden');
    turnArea.classList.remove('hidden');
    rollBtn.disabled = false;
    diceEl.textContent = '🎲';
    setStatus(`${PLAYER_DEFS[game.current].name}'s turn — roll!`);
    renderLegend();
    draw();
  }

  function roll() {
    if (!game || game.awaitingMove) return;
    const dice = 1 + Math.floor(Math.random() * 6);
    game.dice = dice;
    diceEl.textContent = dice;
    const legal = legalMoves(game, game.current, dice);
    game.legal = legal;
    if (legal.length === 0) {
      setStatus(`${PLAYER_DEFS[game.current].name} rolled ${dice} — no legal move.`);
      nextTurn(dice === 6);
      return;
    }
    game.awaitingMove = true;
    rollBtn.disabled = true;
    setStatus(`${PLAYER_DEFS[game.current].name} rolled ${dice} — tap a highlighted token.`);
    draw();
  }

  function nextTurn(extra) {
    game.awaitingMove = false;
    game.legal = [];
    rollBtn.disabled = false;
    if (!extra) {
      game.current = (game.current + 1) % game.numPlayers;
    }
    setStatus(`${PLAYER_DEFS[game.current].name}'s turn — roll!` + (extra ? ' (bonus for 6)' : ''));
    renderLegend();
    draw();
  }

  canvas.addEventListener('click', (e) => {
    if (!game || !game.awaitingMove) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const player = game.players.find(p => p.id === game.current);
    // find a legal token near the click
    for (const move of game.legal) {
      const pos = player.tokens[move.tokenIndex];
      const { c, r } = tokenCell(player.id, pos, move.tokenIndex);
      const { x, y } = cellCenter(c, r);
      if (Math.hypot(mx - x, my - y) <= CELL * 0.5) {
        const res = applyMove(game, player.id, move.tokenIndex, move.dest);
        let msg = '';
        if (res.captured.length) msg = ` Captured ${res.captured.length} token(s)!`;
        if (hasWon(player)) {
          setStatus(`🏆 ${PLAYER_DEFS[player.id].name} wins!`);
          game.awaitingMove = false;
          rollBtn.disabled = true;
          renderLegend();
          draw();
          return;
        }
        nextTurn(game.dice === 6);
        if (msg) setStatus(statusEl.textContent + msg);
        return;
      }
    }
  });

  rollBtn.addEventListener('click', roll);
  resetBtn.addEventListener('click', () => {
    game = null;
    turnArea.classList.add('hidden');
    setup.classList.remove('hidden');
    legend.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
  startBtn.addEventListener('click', startGame);

  // initial empty board
  draw();
}
