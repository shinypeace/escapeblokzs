import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSave, parseSave, exportSave } from '../dist/storage.js';
import { SKINS, THEMES, BOOSTS, consumeBoost, purchaseBoost, purchaseCosmetic, awardRewarded, recordCompletion, utcDay } from '../dist/economy.js';

const complete = (save, levelId, stars = 3, date = '2026-10-16T12:00:00Z') => recordCompletion(save, { levelId, stars, moves: 30, date });

test('new players receive five hints and five undos, and packs have clear fixed quantities', () => {
  const save = freshSave();
  assert.equal(save.coins, 150);
  assert.equal(save.hints, 5);
  assert.equal(save.undos, 5);
  assert.deepEqual(BOOSTS.map(({ id, quantity, price }) => [id, quantity, price]), [['hints', 5, 120], ['undos', 5, 60]]);
});

test('consuming inventory and buying packs is atomic and cannot overdraw coins or quantities', () => {
  const save = freshSave();
  assert.equal(consumeBoost(save, 'hints', 5).ok, true);
  const empty = structuredClone(save);
  for (const args of [['hints'], ['hints', -1], ['hints', 0], ['hints', 0.5], ['unknown']]) {
    assert.equal(consumeBoost(save, ...args).ok, false);
    assert.deepEqual(save, empty);
  }
  assert.deepEqual(purchaseBoost(save, 'hints'), { ok: true, cost: 120, quantity: 5, remaining: 5 });
  assert.equal(save.coins, 30);
  assert.equal(save.economyStats.spentBoosts, 120);
  const unaffordable = structuredClone(save);
  assert.equal(purchaseBoost(save, 'undos').reason, 'coins');
  assert.equal(purchaseBoost(save, 'missing').reason, 'invalid');
  assert.deepEqual(save, unaffordable);
  assert.equal(consumeBoost(save, 'undos', 2).remaining, 3);
});

test('cosmetic purchase grants the exact selected secret, charges once and does not equip implicitly', () => {
  const save = freshSave();
  save.coins = 2500;
  assert.equal(purchaseCosmetic(save, 'skins', 'gold').ok, true);
  assert.equal(save.coins, 500);
  assert.equal(save.skin, 'classic');
  assert.deepEqual(save.ownedSkins, ['classic', 'gold']);
  const bought = structuredClone(save);
  assert.equal(purchaseCosmetic(save, 'skins', 'gold').reason, 'owned');
  assert.equal(purchaseCosmetic(save, 'themes', 'ember').reason, 'coins');
  assert.equal(purchaseCosmetic(save, 'unknown', 'mint').reason, 'invalid');
  assert.equal(purchaseCosmetic(save, 'themes', 'missing').reason, 'invalid');
  assert.deepEqual(save, bought);
  assert.equal(purchaseCosmetic(save, 'themes', 'dusk').ok, true);
  assert.equal(save.coins, 200);
  assert.equal(save.economyStats.spentCosmetics, 2300);
});

test('rewarded completion grants three of one boost and a persisted receipt blocks duplicate callbacks', () => {
  let save = freshSave();
  save.hints = 0;
  save.undos = 0;
  assert.deepEqual(awardRewarded(save, 'hints', 'ad-123'), { ok: true, quantity: 3, remaining: 3 });
  assert.equal(save.undos, 0);
  save = parseSave(exportSave(save));
  const before = structuredClone(save);
  assert.equal(awardRewarded(save, 'hints', 'ad-123').reason, 'duplicate');
  assert.equal(awardRewarded(save, 'undos', 'ad-123').reason, 'duplicate');
  assert.deepEqual(save, before);
  assert.equal(awardRewarded(save, 'undos', 'ad-124').remaining, 3);
  assert.equal(save.economyStats.rewardedHints, 3);
  assert.equal(save.economyStats.rewardedUndos, 3);
  for (const id of ['', ' ', null, 'x'.repeat(161)]) assert.equal(awardRewarded(save, 'hints', id).reason, 'invalid');
});

test('first clears pay 30/35/40 and improved stars pay only the difference, with a separate bounded replay bonus', () => {
  const save = freshSave();
  assert.equal(complete(save, 1, 1).reward, 30);
  const upgrade = complete(save, 1, 3);
  assert.equal(upgrade.reward, 50);
  assert.equal(upgrade.dailyBonus, 40);
  assert.equal(upgrade.improved, 2);
  assert.equal(complete(save, 1, 3).reward, 0);
  assert.equal(complete(save, 1, 1).reward, 0);
  assert.equal(save.results[1].stars, 3);
  assert.equal(save.economyStats.earnedCampaign, 40);
  assert.equal(save.economyStats.earnedDaily, 40);
  assert.equal(complete(save, 2, 2).reward, 35);
  assert.equal(complete(save, 3, 3).reward, 40);
});

test('chapter bonus triggers exactly once after twenty distinct clears and level 200 remains replayable', () => {
  const save = freshSave();
  for (let id = 1; id <= 19; id++) assert.equal(complete(save, id).chapterBonus, 0);
  assert.equal(complete(save, 20).chapterBonus, 100);
  assert.equal(save.unlocked, 21);
  assert.equal(complete(save, 20).chapterBonus, 0);
  complete(save, 200);
  assert.equal(save.unlocked, 200);
  assert.equal(save.results[200].completed, true);
  const before = structuredClone(save);
  for (const levelId of [0, -1, 201, 1.1, '20']) assert.equal(complete(save, levelId).ok, false);
  assert.deepEqual(save, before);
});

test('daily replay is capped to three different completed levels, persists, and cannot reset by rolling the date backwards', () => {
  let save = freshSave();
  for (let id = 1; id <= 5; id++) complete(save, id);
  assert.equal(save.economyStats.earnedDaily, 0);
  assert.equal(complete(save, 1).dailyBonus, 40);
  assert.equal(complete(save, 1).dailyBonus, 0);
  assert.equal(complete(save, 2).dailyBonus, 40);
  save = parseSave(exportSave(save));
  assert.equal(complete(save, 3).dailyBonus, 40);
  assert.equal(complete(save, 4).dailyBonus, 0);
  assert.equal(complete(save, 4, 3, '2026-10-15T12:00:00Z').dailyBonus, 0);
  assert.equal(complete(save, 4, 3, '2026-10-16T23:59:59Z').dailyBonus, 0);
  assert.equal(complete(save, 1, 3, '2026-10-17T00:00:00Z').dailyBonus, 40);
  assert.equal(save.economyStats.earnedDaily, 160);
  assert.equal(utcDay('2026-10-17T02:59:59+03:00'), '2026-10-16');
  assert.equal(utcDay('invalid'), null);
});

test('200 optimal first clears earn 9150 total including the start and cannot buy the whole cosmetic collection', () => {
  const save = freshSave();
  let chapters = 0;
  for (let id = 1; id <= 200; id++) chapters += complete(save, id).chapterBonus;
  assert.equal(chapters, 1000);
  assert.equal(save.coins, 9150);
  assert.equal(save.economyStats.earnedCampaign, 9000);
  assert.equal(save.unlocked, 200);
  assert.equal(Object.keys(save.results).length, 200);
  assert.equal([...SKINS, ...THEMES].reduce((sum, item) => sum + item.price, 0), 19700);
  assert.ok(save.coins < 19700 / 2);
});

test('casual, balanced and expert campaign budgets sustain boosts and a deliberate cosmetic collection', () => {
  const scenarios = [
    { name: 'casual', twoStars: 120, threeStars: 0, hints: 60, undos: 120, income: 7750, boosts: 2700, balance: 5050 },
    { name: 'balanced', twoStars: 140, threeStars: 60, hints: 40, undos: 100, income: 8450, boosts: 1980, balance: 6470 },
    { name: 'expert', twoStars: 0, threeStars: 200, hints: 10, undos: 30, income: 9150, boosts: 420, balance: 8730 },
  ];
  for (const scenario of scenarios) {
    const save = freshSave();
    const used = { hints: 0, undos: 0 };
    for (let id = 1; id <= 200; id++) {
      complete(save, id, id <= scenario.threeStars ? 3 : id <= scenario.threeStars + scenario.twoStars ? 2 : 1);
      // Buy along the actual journey, rather than assuming the final balance is available at level one.
      for (const kind of ['hints', 'undos']) {
        const target = Math.floor(id * scenario[kind] / 200);
        while (used[kind] < target) {
          if (!save[kind]) assert.equal(purchaseBoost(save, kind).ok, true, `${scenario.name}, level ${id}`);
          assert.equal(consumeBoost(save, kind).ok, true);
          used[kind]++;
        }
      }
    }
    assert.equal(save.coins + save.economyStats.spentBoosts, scenario.income, scenario.name);
    assert.equal(save.economyStats.spentBoosts, scenario.boosts, scenario.name);
    assert.equal(save.coins, scenario.balance, scenario.name);
    assert.ok(purchaseCosmetic(save, 'skins', 'glass').ok, scenario.name);
    assert.ok(purchaseCosmetic(save, 'skins', 'gold').ok, scenario.name);
    assert.ok(purchaseCosmetic(save, 'themes', 'aurora').ok, scenario.name);
    assert.ok(save.coins >= 0, scenario.name);
  }
});
