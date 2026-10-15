import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshSave, loadSave, saveSave, exportSave, importSave, parseSave, chooseSave, setSaveScope } from '../dist/storage.js';

const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
  });
  setSaveScope();
});

afterEach(() => {
  setSaveScope();
  if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
  else delete globalThis.localStorage;
});

function snapshot(overrides = {}) { return { ...freshSave(), ...overrides }; }

test('guest and distinct VK accounts keep independent primary saves and backups', () => {
  saveSave(snapshot({ coins: 200, updatedAt: 1000, revision: 2 }));
  saveSave(snapshot({ coins: 225, updatedAt: 1100, revision: 3 }));
  setSaveScope(42);
  assert.equal(loadSave().coins, 150);
  saveSave(snapshot({ coins: 400, updatedAt: 2000, revision: 7 }));
  saveSave(snapshot({ coins: 450, updatedAt: 2100, revision: 8 }));
  setSaveScope(84);
  assert.equal(loadSave().coins, 150);
  saveSave(snapshot({ coins: 800, updatedAt: 3000, revision: 10 }));
  setSaveScope(42);
  assert.equal(loadSave().coins, 450);
  assert.equal(loadSave().revision, 8);
  setSaveScope();
  assert.equal(loadSave().coins, 225);
  assert.equal(loadSave().updatedAt, 1100);
  assert.equal(JSON.parse(values.get('walkblock.save.v1.backup')).coins, 200);
  assert.equal(JSON.parse(values.get('walkblock.save.v1.vk_42.backup')).coins, 400);
  assert.equal(JSON.parse(values.get('walkblock.save.v1.vk_84')).coins, 800);
});

test('scope switching clears memory so unavailable browser storage cannot leak another account', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } },
  });
  setSaveScope(42);
  saveSave(snapshot({ coins: 900, updatedAt: 4000, revision: 12 }));
  assert.equal(loadSave().coins, 900);
  setSaveScope(84);
  assert.equal(loadSave().coins, 150);
  assert.equal(loadSave().revision, 0);
  setSaveScope();
  assert.equal(loadSave().coins, 150);
});

test('cloud parsing preserves recency metadata and never changes local storage', () => {
  saveSave(snapshot({ coins: 200, updatedAt: 1700000000000, revision: 10 }));
  const before = [...values.entries()];
  const remote = parseSave(JSON.stringify(snapshot({ coins: 400, updatedAt: 1800000000000, revision: 20 })));
  assert.equal(remote.coins, 400);
  assert.equal(remote.updatedAt, 1800000000000);
  assert.equal(remote.revision, 20);
  assert.deepEqual([...values.entries()], before);
  assert.equal(loadSave().coins, 200);
  const roundtrip = parseSave(exportSave(saveSave(remote)));
  assert.equal(roundtrip.updatedAt, remote.updatedAt);
  assert.equal(roundtrip.revision, remote.revision);
});

test('legacy saves remain readable and start with neutral recency metadata', () => {
  const legacy = snapshot({ coins: 300 });
  delete legacy.updatedAt;
  delete legacy.revision;
  const state = parseSave(JSON.stringify(legacy));
  assert.equal(state.coins, 300);
  assert.equal(state.updatedAt, 0);
  assert.equal(state.revision, 0);
});

test('cloud selection prioritizes the latest timestamp over a higher revision on another device', () => {
  const local = snapshot({ coins: 200, updatedAt: 2000, revision: 90 });
  const remote = snapshot({ coins: 400, updatedAt: 3000, revision: 2 });
  assert.equal(chooseSave(local, remote).coins, 400);
  assert.equal(chooseSave(remote, local).coins, 400);
  assert.equal(values.size, 0);
});

test('equal timestamps select the higher revision and exact ties restore the cloud snapshot', () => {
  const local = snapshot({ coins: 200, updatedAt: 2000, revision: 5 });
  const newer = snapshot({ coins: 400, updatedAt: 2000, revision: 6 });
  assert.equal(chooseSave(local, newer).coins, 400);
  assert.equal(chooseSave(newer, local).coins, 400);
  assert.equal(chooseSave(local, snapshot({ coins: 800, updatedAt: 2000, revision: 5 })).coins, 800);
});

test('a legacy cloud snapshot survives an exact neutral metadata tie with fresh local progress', () => {
  const legacy = snapshot({ coins: 700, unlocked: 30, ownedSkins: ['classic', 'mint'], skin: 'mint' });
  delete legacy.updatedAt;
  delete legacy.revision;
  const restored = chooseSave(freshSave(), parseSave(JSON.stringify(legacy)));
  assert.equal(restored.coins, 700);
  assert.equal(restored.unlocked, 30);
  assert.equal(restored.skin, 'mint');
});

test('save selection returns a normalized copy without mutating either device snapshot', () => {
  const local = snapshot({ coins: 200, updatedAt: 1000 });
  const remote = snapshot({ coins: -50, updatedAt: 3000, ownedSkins: ['classic', 'missing'], skin: 'missing' });
  const selected = chooseSave(local, remote);
  assert.notEqual(selected, remote);
  assert.equal(selected.coins, 0);
  assert.deepEqual(selected.ownedSkins, ['classic']);
  selected.settings.sound = false;
  assert.equal(remote.settings.sound, true);
  assert.equal(remote.coins, -50);
  assert.equal(local.coins, 200);
});

test('recency metadata is normalized without accepting non-finite or string counters', () => {
  assert.deepEqual(
    (({ updatedAt, revision }) => ({ updatedAt, revision }))(saveSave(snapshot({ updatedAt: Infinity, revision: '22' }))),
    { updatedAt: 0, revision: 0 },
  );
  const state = parseSave(JSON.stringify(snapshot({ updatedAt: 2500.8, revision: 8.9 })));
  assert.equal(state.updatedAt, 2500);
  assert.equal(state.revision, 8);
  const negative = parseSave(JSON.stringify(snapshot({ updatedAt: -5, revision: -9 })));
  assert.equal(negative.updatedAt, 0);
  assert.equal(negative.revision, 0);
});

test('unknown game versions and unrelated JSON objects are rejected rather than normalized to defaults', () => {
  for (const text of [
    JSON.stringify({ ...snapshot(), version: 2 }),
    JSON.stringify({ result: true }),
    JSON.stringify({ ...snapshot(), coins: '100' }),
    JSON.stringify({ ...snapshot(), unlocked: null }),
    JSON.stringify({ ...snapshot(), results: [] }),
    'null', '[]', '{}', '', 'not json',
  ]) assert.throws(() => parseSave(text));
  assert.equal(values.size, 0);
});

test('unsafe JSON keys are rejected at every nesting depth', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const text = `{"version":1,"coins":150,"unlocked":1,"results":{},"nested":{"${key}":{"polluted":true}}}`;
    assert.throws(() => parseSave(text));
  }
  assert.equal({}.polluted, undefined);
  assert.equal(values.size, 0);
});

test('oversized or non-string input cannot become a game save', () => {
  for (const value of [undefined, null, {}, 100, ' '.repeat(1024 * 1024 + 1)]) assert.throws(() => parseSave(value));
  assert.equal(values.size, 0);
});

test('a corrupted account save recovers from its own backup and never from guest progress', () => {
  saveSave(snapshot({ coins: 9999, updatedAt: 1000, revision: 50 }));
  setSaveScope(42);
  saveSave(snapshot({ coins: 300, updatedAt: 2000, revision: 5 }));
  saveSave(snapshot({ coins: 400, updatedAt: 2500, revision: 6 }));
  values.set('walkblock.save.v1.vk_42', '{broken');
  setSaveScope(42);
  const recovered = loadSave();
  assert.equal(recovered.coins, 300);
  assert.equal(recovered.updatedAt, 2000);
  assert.equal(recovered.revision, 5);
  assert.equal(JSON.parse(values.get('walkblock.save.v1.vk_42')).coins, 300);
  setSaveScope(84);
  assert.equal(loadSave().coins, 150);
});

test('import rejects invalid data without destroying healthy progress or its metadata', () => {
  const local = snapshot({ coins: 450, updatedAt: 5000, revision: 7 });
  saveSave(local);
  assert.throws(() => importSave(JSON.stringify({ ...local, version: 99 })));
  assert.equal(loadSave().coins, 450);
  assert.equal(loadSave().updatedAt, 5000);
  assert.equal(loadSave().revision, 7);
});

test('valid completed levels determine unlocks and unsupported purchases are not introduced by a cloud save', () => {
  const state = parseSave(JSON.stringify(snapshot({
    coins: -20, unlocked: 1,
    ownedSkins: ['classic', 'mint', 'mint', 'unlisted'], skin: 'unlisted',
    ownedThemes: ['dawn', 'night', 'unlisted'], theme: 'night',
    results: {
      1: { completed: true, stars: 3, moves: 8, bestMoves: 8 },
      200: { completed: true, stars: 5, moves: 50, bestMoves: 45 },
      201: { completed: true, stars: 3, moves: 1 },
      2: { completed: false, stars: 3, moves: 1 },
    },
  })));
  assert.equal(state.coins, 0);
  assert.equal(state.unlocked, 200);
  assert.deepEqual(Object.keys(state.results), ['1', '200']);
  assert.equal(state.results[200].stars, 3);
  assert.deepEqual(state.ownedSkins, ['classic', 'mint']);
  assert.equal(state.skin, 'classic');
  assert.equal(state.theme, 'night');
});

test('legacy version-one saves receive the five-plus-five welcome inventory only once without changing purchases or coins', () => {
  const legacy = snapshot({ coins: 432, unlocked: 120, ownedSkins: ['classic', 'mint', 'honey'], skin: 'honey', ownedThemes: ['dawn', 'sand'], theme: 'sand' });
  for (const key of ['economyVersion', 'hints', 'undos', 'rewardReceipts', 'dailyReplay', 'economyStats']) delete legacy[key];
  values.set('walkblock.save.v1', JSON.stringify(legacy));
  let migrated = loadSave();
  assert.equal(migrated.version, 1);
  assert.equal(migrated.economyVersion, 1);
  assert.equal(migrated.coins, 432);
  assert.equal(migrated.hints, 5);
  assert.equal(migrated.undos, 5);
  assert.deepEqual(migrated.ownedSkins, legacy.ownedSkins);
  assert.equal(migrated.theme, 'sand');
  migrated.hints = 0;
  migrated.undos = 0;
  saveSave(migrated);
  setSaveScope();
  migrated = loadSave();
  assert.equal(migrated.hints, 0);
  assert.equal(migrated.undos, 0);
  assert.equal(parseSave(exportSave(migrated)).hints, 0);
  assert.equal(chooseSave(freshSave(), { ...migrated, updatedAt: 100 }).undos, 0);
});

test('new cosmetics, inventory, rewarded receipts and daily allowance survive account-scoped cloud roundtrips', () => {
  setSaveScope(42);
  const state = saveSave(snapshot({
    ownedSkins: ['classic', 'glass', 'gold', 'glitter', 'obsidian'], skin: 'glitter',
    ownedThemes: ['dawn', 'aurora', 'nebula', 'ember'], theme: 'ember',
    hints: 8, undos: 0,
    rewardReceipts: ['vk-reward-1', 'vk-reward-2'],
    dailyReplay: { day: '2026-10-16', levelIds: [1, 18] },
    economyStats: { spentBoosts: 120, spentCosmetics: 2000, earnedCampaign: 80, earnedDaily: 80, rewardedHints: 3, rewardedUndos: 0 },
    active: { levelId: 200, state: { x: 1, y: 2, o: 1, mask: 3 }, history: [], moves: 0 },
  }));
  assert.deepEqual(parseSave(exportSave(state)), state);
  setSaveScope(84);
  assert.equal(loadSave().hints, 5);
  assert.deepEqual(loadSave().rewardReceipts, []);
  setSaveScope(42);
  assert.deepEqual(loadSave(), state);
});

test('malformed economy values cannot refill an economy-aware save or create unlimited daily rewards', () => {
  const state = parseSave(JSON.stringify(snapshot({
    hints: -20, undos: '5',
    rewardReceipts: ['valid', 'valid', '', 5, 'x'.repeat(161)],
    dailyReplay: { day: '2026-10-16', levelIds: [1, 1, 200, 201, -1, 18, 19, '2'] },
    economyStats: { spentBoosts: -1, earnedDaily: '500', rewardedHints: 4.9, bad: 100 },
  })));
  assert.equal(state.hints, 0);
  assert.equal(state.undos, 0);
  assert.deepEqual(state.rewardReceipts, ['valid']);
  assert.deepEqual(state.dailyReplay, { day: '2026-10-16', levelIds: [1, 200, 18] });
  assert.equal(state.economyStats.spentBoosts, 0);
  assert.equal(state.economyStats.earnedDaily, 0);
  assert.equal(state.economyStats.rewardedHints, 4);
  assert.equal(state.economyStats.bad, undefined);
  const noCounters = snapshot();
  delete noCounters.hints;
  delete noCounters.undos;
  assert.equal(parseSave(JSON.stringify(noCounters)).hints, 0);
  assert.equal(parseSave(JSON.stringify(noCounters)).undos, 0);
  for (const day of ['2026-02-30', 'not-a-date', '2026-1-1']) {
    assert.deepEqual(parseSave(JSON.stringify(snapshot({ dailyReplay: { day, levelIds: [1, 2, 3] } }))).dailyReplay, { day: '', levelIds: [] });
  }
});
