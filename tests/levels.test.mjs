import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LEVELS, occupied, move, isWin, solve } from '../dist/levels.js';

const started = performance.now();
const key = p => p.join(',');
const floor = (w, h) => Array.from({ length: w * h }, (_, i) => [i % w, Math.floor(i / w)]);
const empty = { tiles: floor(9, 10), start: { x: 3, y: 3, o: 0 }, goal: [6, 3] };

assert.deepEqual(occupied({ x: 2, y: 4, o: 0 }), [[2, 4]]);
assert.deepEqual(occupied({ x: 2, y: 4, o: 1 }), [[2, 4], [3, 4]]);
assert.deepEqual(occupied({ x: 2, y: 4, o: 2 }), [[2, 4], [2, 5]]);

for (const [direction, opposite, halfway, end] of [
  ['right', 'left', { x: 4, y: 3, o: 1, mask: 0 }, { x: 6, y: 3, o: 0, mask: 0 }],
  ['left', 'right', { x: 1, y: 3, o: 1, mask: 0 }, { x: 0, y: 3, o: 0, mask: 0 }],
  ['down', 'up', { x: 3, y: 4, o: 2, mask: 0 }, { x: 3, y: 6, o: 0, mask: 0 }],
  ['up', 'down', { x: 3, y: 1, o: 2, mask: 0 }, { x: 3, y: 0, o: 0, mask: 0 }],
]) {
  const first = move(empty, empty.start, direction);
  assert.deepEqual(first, halfway, `${direction}: correct tumbling orientation`);
  assert.deepEqual(move(empty, first, direction), end, `${direction}: two rolls travel three tiles`);
  assert.deepEqual(move(empty, first, opposite), { ...empty.start, mask: 0 }, `${direction}: roll is reversible on plain ground`);
}
assert.deepEqual(move(empty, { x: 3, y: 3, o: 1 }, 'down'), { x: 3, y: 4, o: 1, mask: 0 });
assert.deepEqual(move(empty, { x: 3, y: 3, o: 2 }, 'right'), { x: 4, y: 3, o: 2, mask: 0 });
assert.equal(move(empty, { x: 0, y: 0, o: 0 }, 'left'), null);
assert.equal(move(empty, empty.start, 'diagonal'), null);
assert.equal(isWin(empty, { x: 6, y: 3, o: 1 }), false, 'lying across the hole does not win');
assert.equal(isWin(empty, { x: 6, y: 3, o: 0 }), true);
const crossingHole = { ...empty, goal: [4, 3] };
const lyingOverHole = move(crossingHole, crossingHole.start, 'right');
assert.ok(lyingOverHole, 'the hole supports a block lying across it');
assert.equal(isWin(crossingHole, lyingOverHole), false, 'crossing the hole while lying does not end the level');
assert.deepEqual(solve(empty), ['right', 'right'], 'solver finds a known two-roll optimum');
assert.deepEqual(solve(empty, { x: 6, y: 3, o: 0 }), []);
assert.equal(solve({ tiles: [[0, 0], [5, 5]], start: { x: 0, y: 0, o: 0 }, goal: [5, 5] }), null);

const glass = { ...empty, fragile: [[4, 3], [6, 3]] };
const flatOnGlass = move(glass, glass.start, 'right');
assert.ok(flatOnGlass, 'glass supports a lying block');
assert.equal(move(glass, flatOnGlass, 'right'), null, 'glass breaks under an upright block');

const circuit = { tiles: floor(7, 4), start: { x: 0, y: 0, o: 0 }, goal: [6, 0], switches: [{ at: [1, 0], bit: 0 }], bridges: [{ at: [2, 0], bit: 0 }] };
const switched = move(circuit, circuit.start, 'right');
assert.deepEqual(switched, { x: 1, y: 0, o: 1, mask: 1 }, 'entering a button enables its bridge');
assert.equal(move(circuit, { ...circuit.start, mask: 1 }, 'right'), null, 'a bridge cannot disappear under the landing block');
const offButton = move(circuit, switched, 'right');
assert.equal(offButton.mask, 1, 'leaving the button preserves its state');
assert.equal(move(circuit, offButton, 'left'), null, 're-entering toggles a button, rather than setting it permanently');
const twoBits = { ...empty, switches: [{ at: [4, 3], bit: 1 }] };
assert.equal(move(twoBits, { ...empty.start, mask: 1 }, 'right').mask, 3, 'independent circuits preserve other bits');
assert.equal(empty.start.mask, undefined, 'moves never mutate the input state');

function canonicalGeometry(level) {
  const variants = [];
  for (let t = 0; t < 8; t++) {
    const points = level.tiles.map(([x, y]) => {
      if (t & 1) x = -x;
      if (t & 2) y = -y;
      return t & 4 ? [y, x] : [x, y];
    });
    const mx = Math.min(...points.map(p => p[0]));
    const my = Math.min(...points.map(p => p[1]));
    variants.push(points.map(([x, y]) => `${x - mx},${y - my}`).sort().join(';'));
  }
  return variants.sort()[0];
}

assert.equal(LEVELS.length, 120);
const silhouettes = new Set();
const names = new Set();
const stats = Array.from({ length: 6 }, () => ({ levels: 0, moves: 0, min: Infinity, max: 0 }));
for (const [index, level] of LEVELS.entries()) {
  const label = `Level ${index + 1} (${level.name})`;
  assert.equal(level.id, index + 1, `${label}: sequential id`);
  assert.equal(level.chapter, Math.floor(index / 20), `${label}: correct chapter`);
  assert.ok(level.name && !names.has(level.name), `${label}: distinct title`);
  names.add(level.name);
  assert.ok(level.tiles.length >= 7, `${label}: meaningful board`);
  const tiles = new Set(level.tiles.map(key));
  assert.equal(tiles.size, level.tiles.length, `${label}: no duplicate tiles`);
  assert.ok(tiles.has(key([level.start.x, level.start.y])) && tiles.has(key(level.goal)), `${label}: valid start and hole`);
  assert.equal(level.start.o, 0);
  assert.ok(!isWin(level, level.start), `${label}: start differs from goal`);
  assert.ok(Math.min(...level.tiles.map(p => p[0])) === 0 && Math.min(...level.tiles.map(p => p[1])) === 0);
  assert.ok(Math.max(...level.tiles.map(p => p[0])) < 9 && Math.max(...level.tiles.map(p => p[1])) < 10, `${label}: portrait board bounds`);

  const connected = new Set([key(level.tiles[0])]);
  const queue = [level.tiles[0]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const p of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (tiles.has(key(p)) && !connected.has(key(p))) { connected.add(key(p)); queue.push(p); }
  }
  assert.equal(connected.size, tiles.size, `${label}: no disconnected decorative islands`);
  const reachableStates = [{ ...level.start, mask: 0 }];
  const seenStates = new Set([`${level.start.x},${level.start.y},0,0`]);
  const reachableTiles = new Set();
  for (let i = 0; i < reachableStates.length; i++) {
    const current = reachableStates[i];
    occupied(current).forEach(p => reachableTiles.add(key(p)));
    if (isWin(level, current)) continue;
    for (const direction of ['up', 'down', 'left', 'right']) {
      const next = move(level, current, direction);
      if (!next) continue;
      const signature = `${next.x},${next.y},${next.o},${next.mask || 0}`;
      if (seenStates.has(signature)) continue;
      seenStates.add(signature);
      reachableStates.push(next);
    }
  }
  assert.equal(reachableTiles.size, tiles.size, `${label}: every tile is physically reachable before the level ends`);
  const signature = canonicalGeometry(level);
  assert.ok(!silhouettes.has(signature), `${label}: no rotated or mirrored duplicate board`);
  silhouettes.add(signature);

  let state = { ...level.start, mask: 0 };
  const touchedGlass = new Set();
  const crossedBridges = new Set();
  for (const direction of level.solution) {
    state = move(level, state, direction);
    assert.ok(state, `${label}: stored path is physically valid`);
    for (const p of occupied(state)) {
      if ((level.fragile || []).some(q => key(q) === key(p))) touchedGlass.add(key(p));
      if ((level.bridges || []).some(b => key(b.at) === key(p))) crossedBridges.add(key(p));
    }
  }
  assert.ok(isWin(level, state), `${label}: stored path ends upright in the hole`);
  const optimal = solve(level);
  assert.ok(optimal, `${label}: independently searched solution exists`);
  assert.equal(optimal.length, level.par, `${label}: par equals shortest possible solution`);
  assert.equal(level.solution.length, level.par, `${label}: stored path is optimal`);
  const midpoint = level.solution.slice(0, Math.floor(level.solution.length / 2)).reduce((s, d) => move(level, s, d), { ...level.start, mask: 0 });
  assert.ok(solve(level, midpoint), `${label}: contextual hint works midway through the level`);

  if (index < 40) assert.ok(!level.fragile && !level.switches && !level.bridges, `${label}: basic mechanics only`);
  if (level.chapter === 2 || level.chapter === 5) {
    assert.ok(level.fragile.length > 0, `${label}: glass chapter includes glass`);
    assert.equal(touchedGlass.size, level.fragile.length, `${label}: every glass tile participates in the designed route`);
  }
  if (level.chapter >= 3) {
    const circuits = level.chapter === 3 ? 1 : 2;
    assert.equal(level.switches.length, circuits, `${label}: expected number of circuits`);
    assert.equal(level.bridges.length, circuits);
    assert.equal(crossedBridges.size, circuits, `${label}: every bridge must be crossed`);
    assert.equal(solve({ ...level, switches: [] }), null, `${label}: buttons are required to finish`);
    for (const bridge of level.bridges) {
      assert.equal(solve({ ...level, tiles: level.tiles.filter(p => key(p) !== key(bridge.at)) }), null, `${label}: each bridge is essential`);
    }
  }
  const stat = stats[level.chapter];
  stat.levels++; stat.moves += level.par; stat.min = Math.min(stat.min, level.par); stat.max = Math.max(stat.max, level.par);
}
assert.ok(LEVELS[0].par >= 3 && LEVELS[0].par <= 6, 'first lesson is short');
for (const stat of stats) assert.equal(stat.levels, 20);
console.log(`PASS: 120 distinct campaign boards, optimal solutions, hints, glass, toggles and mandatory bridges (${Math.round(performance.now() - started)} ms).`);
console.table(stats.map((s, i) => ({ chapter: i + 1, levels: s.levels, minimum: s.min, maximum: s.max, average: +(s.moves / s.levels).toFixed(1) })));
