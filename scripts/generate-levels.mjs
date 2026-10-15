/** Reproducible campaign authoring. Run: node scripts/generate-levels.mjs */
import fs from 'node:fs';
import { occupied, move, isWin, solve, DIRECTIONS } from '../dist/levels.js';

let seed = 0x4b55424f;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const integer = (a, b) => a + Math.floor(random() * (b - a + 1));
const shuffled = a => a.map(v => ({ v, r: random() })).sort((a, b) => a.r - b.r).map(x => x.v);
const key = p => p.join(',');
const skey = s => `${s.x},${s.y},${s.o},${s.mask || 0}`;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

const NAMES = [
  ['Первый перекат','За поворотом','Ступеньки','Боковой шаг','Перекладина','Маленький крюк','На другой берег','Обратный ход','Тихий двор','Узкий проход','Две тропинки','Карман','Полукруг','Смена курса','В центре','Короткая петля','Выше и правее','Лестничный пролёт','Последний поворот','Уверенный шаг'],
  ['Новый маршрут','Косая линия','Переулки','Кольцо','Не спеши','Развилка','Три угла','С дальнего края','Складка','Ключевой поворот','Возвращение','В обход','Петелька','Перекрёсток','Карманный лабиринт','По краю','С другой стороны','Узел','Скрытая тропа','Чувство ритма'],
  ['Тонкий лёд','Полегче','На боку','Стеклянный мост','Хрупкий маршрут','Не вставай','Прозрачная дуга','Бережный поворот','Лёгкий след','Скользящий шаг','Тихая переправа','Тонкая грань','Не дави','Лёгкое касание','Соседняя дорожка','Стеклянный коридор','Деликатный обход','Почти невесомый','На цыпочках','Хрустальный путь'],
  ['Первый контакт','Нажми и иди','Зелёный свет','Связанные берега','Пуск','Временный проход','Найди кнопку','Обратная связь','Разомкнутый круг','Мост к цели','На расстоянии','Правильный сигнал','Включённый маршрут','Сначала сюда','Связь установлена','Цепочка','Дальний контакт','Мягкий щелчок','Смена состояния','Все мосты открыты'],
  ['Два сигнала','По порядку','Вторая линия','Связанные пути','Переключение','Разные берега','Двойной обход','Сначала мост','Короткое замыкание','Верная цепь','Согласованный шаг','Встречные пути','Нужный момент','Две стороны','Световой узел','Пара контактов','Новая связь','Общий маршрут','Полная цепь','Мастер мостов'],
  ['Собрать всё','Хрупкая связь','Точный порядок','Свет и стекло','Точка опоры','Несколько шагов вперёд','Запомни маршрут','Двойная осторожность','Красивый обход','Всё связано','По тонкой линии','Сложить картину','Последовательность','Без лишних шагов','Дальний берег','Один верный путь','Большой поворот','Почти дома','Финальный маршрут','Домой'],
];

function component(level, start) {
  const queue = [{ ...start, mask: 0 }];
  const seen = new Set([skey(queue[0])]);
  const distance = [0];
  let farthest = 0;
  for (let head = 0; head < queue.length; head++) {
    const state = queue[head];
    if (state.o === 0 && distance[head] > distance[farthest]) farthest = head;
    for (const direction of DIRECTIONS) {
      const next = move(level, state, direction);
      if (!next || seen.has(skey(next))) continue;
      seen.add(skey(next));
      queue.push(next);
      distance.push(distance[head] + 1);
    }
  }
  return { queue, farthest: queue[farthest], distance: distance[farthest] };
}

function normalize(level) {
  const minX = Math.min(...level.tiles.map(p => p[0]));
  const minY = Math.min(...level.tiles.map(p => p[1]));
  const shift = p => [p[0] - minX, p[1] - minY];
  return {
    ...level,
    tiles: level.tiles.map(shift).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    start: { x: level.start.x - minX, y: level.start.y - minY, o: 0 },
    goal: shift(level.goal),
    ...(level.fragile ? { fragile: level.fragile.map(shift) } : {}),
    ...(level.switches ? { switches: level.switches.map(b => ({ ...b, at: shift(b.at) })) } : {}),
    ...(level.bridges ? { bridges: level.bridges.map(b => ({ ...b, at: shift(b.at) })) } : {}),
  };
}

function fingerprint(level) {
  const options = [];
  for (let t = 0; t < 8; t++) {
    const transform = ([x, y]) => {
      if (t & 1) x = -x;
      if (t & 2) y = -y;
      return t & 4 ? [y, x] : [x, y];
    };
    const points = level.tiles.map(transform);
    const mx = Math.min(...points.map(p => p[0]));
    const my = Math.min(...points.map(p => p[1]));
    const encode = p => { const q = transform(p); return `${q[0] - mx},${q[1] - my}`; };
    // Geometry alone must be distinct even if start, goal, or mechanics differ.
    options.push(points.map(([x, y]) => `${x - mx},${y - my}`).sort().join(';'));
  }
  return options.sort()[0];
}

function randomBoard() {
  const width = integer(5, 9);
  const height = integer(6, 10);
  const density = 0.64 + random() * 0.21;
  const tiles = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (random() < density) tiles.push([x, y]);
  if (!tiles.length) return null;
  const startTile = tiles[integer(0, tiles.length - 1)];
  const base = { tiles, start: { x: startTile[0], y: startTile[1], o: 0 }, goal: [-1, -1] };
  const first = component(base, base.start);
  if (first.queue.length < 22) return null;
  const second = component(base, first.farthest);
  if (second.distance < 7) return null;
  const used = new Set(second.queue.flatMap(s => occupied(s).map(key)));
  base.tiles = tiles.filter(p => used.has(key(p)));
  base.start = { x: first.farthest.x, y: first.farthest.y, o: 0 };
  base.goal = [second.farthest.x, second.farthest.y];
  return normalize(base);
}

function trace(level, path) {
  const states = [{ ...level.start, mask: 0 }];
  for (const direction of path) {
    const next = move(level, states.at(-1), direction);
    if (!next) throw new Error('Invalid trace');
    states.push(next);
  }
  return states;
}

function trimUnreachable(level) {
  const queue = [{ ...level.start, mask: 0 }];
  const seen = new Set([skey(queue[0])]);
  const used = new Set();
  for (let i = 0; i < queue.length; i++) {
    const state = queue[i];
    occupied(state).forEach(p => used.add(key(p)));
    // The game ends at the hole; tiles reachable only after winning are unused.
    if (isWin(level, state)) continue;
    for (const direction of DIRECTIONS) {
      const next = move(level, state, direction);
      if (!next || seen.has(skey(next))) continue;
      seen.add(skey(next));
      queue.push(next);
    }
  }
  return { ...level, tiles: level.tiles.filter(p => used.has(key(p))) };
}

function addFragile(level, count) {
  const path = solve(level);
  if (!path) return null;
  const states = trace(level, path);
  const standing = new Set(states.filter(s => s.o === 0).map(s => key([s.x, s.y])));
  const used = new Set(states.flatMap(s => occupied(s).map(key)));
  const special = new Set([...(level.switches || []).map(b => key(b.at)), ...(level.bridges || []).map(b => key(b.at))]);
  const choices = shuffled(level.tiles.filter(p => used.has(key(p)) && !standing.has(key(p)) && !special.has(key(p))));
  if (!choices.length) return null;
  // Prefer glass that would otherwise allow an upright shortcut or dead end.
  const reachable = component({ ...level, switches: [], bridges: [] }, level.start).queue;
  const canStand = new Set(reachable.filter(s => s.o === 0).map(s => key([s.x, s.y])));
  choices.sort((a, b) => Number(canStand.has(key(b))) - Number(canStand.has(key(a))));
  const fragile = choices.slice(0, Math.min(count, choices.length));
  return { ...level, fragile };
}

function addBridges(level, count) {
  const path = solve(level);
  if (!path) return null;
  const states = trace(level, path);
  const visits = new Map();
  for (let i = 0; i < states.length; i++) {
    for (const p of occupied(states[i])) {
      const k = key(p);
      const prev = visits.get(k) || { at: p, indices: [], entries: 0 };
      prev.indices.push(i);
      if (i === 0 || !occupied(states[i - 1]).some(q => same(q, p))) prev.entries++;
      visits.set(k, prev);
    }
  }
  const endpoints = new Set([key([level.start.x, level.start.y]), key(level.goal)]);
  const candidates = shuffled([...visits.values()].filter(v => !endpoints.has(key(v.at)) && v.indices[0] >= 4 && v.indices[0] < states.length - 1));
  const essential = [];
  for (const candidate of candidates) {
    const without = { ...level, tiles: level.tiles.filter(p => !same(p, candidate.at)) };
    if (solve(without) === null) essential.push(candidate);
  }
  if (essential.length < count) return null;
  const groups = [];
  if (count === 1) for (const bridge of essential) groups.push([bridge]);
  else for (let i = 0; i < essential.length; i++) for (let j = i + 1; j < essential.length; j++) {
    const pair = [essential[i], essential[j]].sort((a, b) => a.indices[0] - b.indices[0]);
    if (pair[1].indices[0] - pair[0].indices.at(-1) >= 3) groups.push(pair);
  }
  for (const group of shuffled(groups).slice(0, 30)) {
    const switches = [];
    let valid = true;
    for (let bit = 0; bit < group.length; bit++) {
      const lower = bit ? group[bit - 1].indices.at(-1) : 0;
      const upper = group[bit].indices[0];
      const buttons = shuffled([...visits.values()].filter(v => !endpoints.has(key(v.at)) && v.entries === 1 && v.indices[0] > lower && v.indices.at(-1) < upper && !group.some(b => same(b.at, v.at))));
      if (!buttons.length) { valid = false; break; }
      switches.push({ at: buttons[0].at, bit });
    }
    if (!valid) continue;
    const result = { ...level, switches, bridges: group.map((b, bit) => ({ at: b.at, bit })) };
    if (solve(result)) return result;
  }
  return null;
}

function fromPath(directions) {
  const full = { tiles: [], start: { x: 0, y: 0, o: 0 }, goal: [0, 0] };
  // A large temporary floor lets the path author define a silhouette.
  for (let y = -20; y <= 20; y++) for (let x = -20; x <= 20; x++) full.tiles.push([x, y]);
  let state = { ...full.start };
  const used = new Map([[key([0, 0]), [0, 0]]]);
  for (const direction of directions) {
    state = move(full, state, direction);
    if (!state) throw new Error('Author path left authoring floor');
    occupied(state).forEach(p => used.set(key(p), p));
  }
  if (state.o !== 0 || (state.x === 0 && state.y === 0)) throw new Error('Author path must finish upright elsewhere');
  return normalize({ tiles: [...used.values()], start: full.start, goal: [state.x, state.y] });
}

const short = { U: 'up', D: 'down', L: 'left', R: 'right' };
const authored = ['DDDD', 'RRDD', 'DDRRDD', 'RRDLLD', 'DRRURR', 'RRDDLLDD', 'DDRRURRDDD', 'RRDLLDDRRD'];
const levels = [];
const seen = new Set();
for (let i = 0; i < authored.length; i++) {
  const level = fromPath([...authored[i]].map(d => short[d]));
  const solution = solve(level);
  if (!solution || seen.has(fingerprint(level))) throw new Error(`Authored level ${i + 1} invalid`);
  levels.push({ id: i + 1, name: NAMES[0][i], chapter: 0, ...level, par: solution.length, solution });
  seen.add(fingerprint(level));
}

let attempts = 0;
while (levels.length < 120) {
  attempts++;
  const id = levels.length + 1;
  const chapter = Math.floor((id - 1) / 20);
  const position = (id - 1) % 20;
  if (attempts > 200000) throw new Error(`Search exhausted at ${id}`);
  let level = randomBoard();
  if (!level || seen.has(fingerprint(level))) continue;
  let solution = solve(level);
  // Moderate ramps with a little breathing room after every fifth puzzle.
  const minimum = [7 + Math.floor(position / 5), 11 + Math.floor(position / 4), 10 + Math.floor(position / 3), 12 + Math.floor(position / 3), 16 + Math.floor(position / 3), 19 + Math.floor(position / 2)][chapter];
  const maximum = [12 + Math.floor(position / 4), 18 + Math.floor(position / 3), 17 + Math.floor(position / 3), 20 + Math.floor(position / 3), 25 + Math.floor(position / 3), 28 + Math.floor(position / 3)][chapter];
  if (!solution || solution.length < minimum || solution.length > maximum) continue;
  if (chapter === 2) level = addFragile(level, 1 + Math.floor(position / 6));
  if (chapter === 3) level = addBridges(level, 1);
  if (chapter === 4 || chapter === 5) level = addBridges(level, 2);
  if (!level) continue;
  if (chapter === 5) level = addFragile(level, 2 + Math.floor(position / 7));
  if (!level) continue;
  solution = solve(level);
  if (!solution || solution.length < minimum || solution.length > maximum) continue;
  level = normalize(trimUnreachable(level));
  const signature = fingerprint(level);
  if (seen.has(signature)) continue;
  levels.push({ id, name: NAMES[chapter][position], chapter, ...level, par: solution.length, solution });
  seen.add(signature);
  if (id % 10 === 0) console.log(`Authored ${id}/120; ${attempts} candidate boards; par ${solution.length}`);
}

const target = new URL('../dist/levels.js', import.meta.url);
const source = fs.readFileSync(target, 'utf8');
const data = levels.map(level => JSON.stringify(level)).join(',\n');
fs.writeFileSync(target, source.replace(/\/\/ CAMPAIGN_DATA_START[\s\S]*?\/\/ CAMPAIGN_DATA_END/, `// CAMPAIGN_DATA_START\nexport const LEVELS = [\n${data}\n];\n// CAMPAIGN_DATA_END`));
console.log(JSON.stringify({ levels: levels.length, attempts, chapters: Array.from({ length: 6 }, (_, chapter) => { const group = levels.filter(l => l.chapter === chapter); return { chapter, min: Math.min(...group.map(l => l.par)), max: Math.max(...group.map(l => l.par)), average: +(group.reduce((n, l) => n + l.par, 0) / group.length).toFixed(1) }; }) }, null, 2));
