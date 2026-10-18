/* Headless tests for Ghana Ludo rules. Run: node test.js
 * No framework — plain asserts, exits non-zero on failure.
 */
const g = require('./game.js');
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', name); }
}

// --- computeMove: yard ---
check('yard: non-6 cannot leave', g.computeMove({state:'yard'}, 3) === null);
check('yard: 6 enters track step 0', JSON.stringify(g.computeMove({state:'yard'}, 6)) === JSON.stringify({state:'track',step:0}));

// --- computeMove: track advance ---
check('track: simple advance', JSON.stringify(g.computeMove({state:'track',step:0}, 5)) === JSON.stringify({state:'track',step:5}));
check('track: last track step 50', JSON.stringify(g.computeMove({state:'track',step:45}, 5)) === JSON.stringify({state:'track',step:50}));

// --- computeMove: entering home column ---
// step 50 + 1 => home step 0
check('track->home entry', JSON.stringify(g.computeMove({state:'track',step:50}, 1)) === JSON.stringify({state:'home',step:0}));
// step 50 + 6 => home step 5 (last home cell), NOT done
check('track->home last cell', JSON.stringify(g.computeMove({state:'track',step:50}, 6)) === JSON.stringify({state:'home',step:5}));
// step 50 + 7 => done exactly
check('track->done exact (+7)', JSON.stringify(g.computeMove({state:'track',step:50}, 7)) === JSON.stringify({state:'done'}));
// a die only goes to 6, but validate overshoot guard with a larger hypothetical: step 50 + 8 would be illegal
check('track overshoot illegal (+8)', g.computeMove({state:'track',step:50}, 8) === null);

// --- computeMove: home column ---
check('home advance', JSON.stringify(g.computeMove({state:'home',step:0}, 3)) === JSON.stringify({state:'home',step:3}));
check('home exact to done', JSON.stringify(g.computeMove({state:'home',step:0}, 6)) === JSON.stringify({state:'done'}));
check('home overshoot illegal', g.computeMove({state:'home',step:4}, 5) === null);
check('done cannot move', g.computeMove({state:'done'}, 3) === null);

// --- toGlobalIndex wraps ---
check('global index player0 step0', g.toGlobalIndex(0, 0) === 0);
check('global index player1 step0', g.toGlobalIndex(1, 0) === 13);
check('global index wraps mod 52', g.toGlobalIndex(3, 20) === (39 + 20) % 52);

// --- legalMoves ---
const freshPlayer = { id:0, tokens:[{state:'yard'},{state:'yard'},{state:'yard'},{state:'yard'}] };
const stateFresh = { players:[freshPlayer] };
check('all in yard, roll 3 => 0 moves', g.legalMoves(stateFresh, 0, 3).length === 0);
check('all in yard, roll 6 => 4 moves', g.legalMoves(stateFresh, 0, 6).length === 4);

// --- applyMove capture ---
// Red token on global square X (not safe), Green token also on that square -> Red lands, Green captured.
// Red step s where global = toGlobal(0,s). Pick s=2 (global 2, not in SAFE set {0,8,13,21,26,34,39,47}).
const capState = {
  players: [
    { id:0, tokens:[{state:'track',step:1},{state:'yard'},{state:'yard'},{state:'yard'}] },
    { id:1, tokens:[{state:'track', step:(2 - 13 + 52) % 52 /* makes green global = 2 */},{state:'yard'},{state:'yard'},{state:'yard'}] },
  ],
};
// Move Red from step1 by 1 -> step2 (global 2). Green is engineered to sit on global 2.
const greenGlobalBefore = g.toGlobalIndex(1, capState.players[1].tokens[0].step);
check('capture setup: green on global 2', greenGlobalBefore === 2);
const res = g.applyMove(capState, 0, 0, {state:'track',step:2});
check('capture: green sent to yard', capState.players[1].tokens[0].state === 'yard');
check('capture: reported one capture', res.captured.length === 1);

// --- capture does NOT happen on safe square ---
// global 8 is safe. Red local step for global 8 = 8. Put green there too.
const safeState = {
  players: [
    { id:0, tokens:[{state:'track',step:7},{state:'yard'},{state:'yard'},{state:'yard'}] },
    { id:1, tokens:[{state:'track', step:(8 - 13 + 52) % 52},{state:'yard'},{state:'yard'},{state:'yard'}] },
  ],
};
check('safe setup: green on global 8', g.toGlobalIndex(1, safeState.players[1].tokens[0].step) === 8);
const res2 = g.applyMove(safeState, 0, 0, {state:'track',step:8});
check('safe square: no capture', safeState.players[1].tokens[0].state === 'track' && res2.captured.length === 0);

// --- hasWon ---
check('hasWon false when not all done', g.hasWon({tokens:[{state:'done'},{state:'done'},{state:'done'},{state:'home',step:2}]}) === false);
check('hasWon true when all done', g.hasWon({tokens:[{state:'done'},{state:'done'},{state:'done'},{state:'done'}]}) === true);

// --- chooseAIMove ---
// No moves when all in yard and dice != 6
check('AI: no move when stuck', g.chooseAIMove({players:[{id:0,tokens:[{state:'yard'},{state:'yard'},{state:'yard'},{state:'yard'}]}]}, 0, 3) === null);

// AI prefers a capture over a plain advance.
// Red token A at step 1 (can advance to step2 by rolling 1 -> global 2, capturing green there).
// Red token B at step 30 (plain advance). Green sits on global 2.
const aiCap = { players: [
  { id:0, tokens:[{state:'track',step:1},{state:'track',step:30},{state:'yard'},{state:'yard'}] },
  { id:1, tokens:[{state:'track', step:(2 - 13 + 52) % 52},{state:'yard'},{state:'yard'},{state:'yard'}] },
]};
const aiPick = g.chooseAIMove(aiCap, 0, 1);
check('AI: chooses capturing token (index 0)', aiPick && aiPick.tokenIndex === 0);
// capture adds +1000; minor progress/exposure adjustments net it well above any non-capture move
check('AI: capture scored dominantly high', aiPick && aiPick.score >= 900);

// AI prefers leaving the yard (dice 6) — with a yard token and an advance option, both legal on a 6.
const aiYard = { players: [
  { id:0, tokens:[{state:'yard'},{state:'track',step:5},{state:'yard'},{state:'yard'}] },
]};
const aiPick2 = g.chooseAIMove(aiYard, 0, 6);
check('AI: returns a legal move on 6', aiPick2 !== null);
check('AI: move is one of the two legal tokens', aiPick2 && [0,1].includes(aiPick2.tokenIndex));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
