// All prices and rewards live here so the shop, game and save validation agree.
export const LEVEL_COUNT = 200;
export const ECONOMY_VERSION = 1;
export const INITIAL_BOOSTS = 5;
export const REWARDED_BOOSTS = 3;
export const DAILY_REPLAY_LIMIT = 3;
export const DAILY_REPLAY_REWARD = 40;
export const RECEIPT_LIMIT = 128;

const catalog = entries => Object.freeze(entries.map(entry => Object.freeze(entry)));
export const SKINS = catalog([
  { id: 'classic', name: 'Классика', price: 0, rarity: 'Базовый' },
  { id: 'mint', name: 'Керамика', price: 240, rarity: 'Редкий' },
  { id: 'coral', name: 'Коралл', price: 420, rarity: 'Редкий' },
  { id: 'lilac', name: 'Мрамор', price: 650, rarity: 'Редкий' },
  { id: 'midnight', name: 'Галактика', price: 850, rarity: 'Эпический' },
  { id: 'honey', name: 'Орех', price: 1100, rarity: 'Эпический' },
  { id: 'glass', name: 'Хрусталь', price: 1500, rarity: 'Эпический' },
  { id: 'gold', name: 'Золото', price: 2000, rarity: 'Легендарный' },
  { id: 'glitter', name: 'Звёздная пыль', price: 2400, rarity: 'Легендарный' },
  { id: 'obsidian', name: 'Обсидиан', price: 2800, rarity: 'Легендарный' },
]);
export const THEMES = catalog([
  { id: 'dawn', name: 'Глубина', price: 0, top: '#718dc7', bottom: '#344a7c' },
  { id: 'dusk', name: 'Сумерки', price: 300, top: '#7b6ca5', bottom: '#3d365d' },
  { id: 'lagoon', name: 'Лагуна', price: 420, top: '#63aaa8', bottom: '#245964' },
  { id: 'rose', name: 'Рассвет', price: 580, top: '#c48d9e', bottom: '#754b71' },
  { id: 'night', name: 'Полночь', price: 760, top: '#354667', bottom: '#142339' },
  { id: 'sand', name: 'Песок', price: 980, top: '#d7b58e', bottom: '#8e6f62' },
  { id: 'aurora', name: 'Полярное сияние', price: 1250, top: '#0b5960', bottom: '#082b40' },
  { id: 'nebula', name: 'Туманность', price: 1550, top: '#292265', bottom: '#090d30' },
  { id: 'ember', name: 'Тёплый пепел', price: 1900, top: '#713d3a', bottom: '#302133' },
]);
export const BOOSTS = catalog([
  { id: 'hints', name: 'Подсказки', quantity: 5, price: 120 },
  { id: 'undos', name: 'Отмены', quantity: 5, price: 60 },
]);

const validCount = value => Number.isSafeInteger(value) && value >= 0;
const isBoost = kind => BOOSTS.some(item => item.id === kind);
const failure = reason => ({ ok: false, reason });
const stat = (save, key, value) => {
  save.economyStats ||= {};
  save.economyStats[key] = (validCount(save.economyStats[key]) ? save.economyStats[key] : 0) + value;
};

export function consumeBoost(save, kind, quantity = 1) {
  if (!isBoost(kind) || !validCount(quantity) || quantity === 0) return failure('invalid');
  if (!validCount(save[kind]) || save[kind] < quantity) return failure('empty');
  save[kind] -= quantity;
  return { ok: true, quantity, remaining: save[kind] };
}

export function purchaseBoost(save, kind) {
  const item = BOOSTS.find(item => item.id === kind);
  if (!item || !validCount(save.coins) || !validCount(save[kind])) return failure('invalid');
  if (save.coins < item.price) return failure('coins');
  if (save[kind] > 9999999 - item.quantity) return failure('limit');
  save.coins -= item.price;
  save[kind] += item.quantity;
  stat(save, 'spentBoosts', item.price);
  return { ok: true, cost: item.price, quantity: item.quantity, remaining: save[kind] };
}

export function purchaseCosmetic(save, category, id) {
  const items = category === 'skins' ? SKINS : category === 'themes' ? THEMES : null;
  const key = category === 'skins' ? 'ownedSkins' : 'ownedThemes';
  const item = items?.find(item => item.id === id);
  if (!item || !Array.isArray(save[key]) || !validCount(save.coins)) return failure('invalid');
  if (save[key].includes(id)) return failure('owned');
  if (save.coins < item.price) return failure('coins');
  save.coins -= item.price;
  save[key].push(id);
  stat(save, 'spentCosmetics', item.price);
  return { ok: true, cost: item.price, item };
}

// Call only after VK confirms a completed rewarded video. Requests/errors/cancel do not earn inventory.
export function awardRewarded(save, kind, receiptId) {
  if (!isBoost(kind) || !validCount(save[kind]) || typeof receiptId !== 'string'
      || !receiptId.trim() || receiptId.length > 160) return failure('invalid');
  const receipts = Array.isArray(save.rewardReceipts) ? save.rewardReceipts : [];
  if (receipts.includes(receiptId)) return failure('duplicate');
  if (save[kind] > 9999999 - REWARDED_BOOSTS) return failure('limit');
  save[kind] += REWARDED_BOOSTS;
  save.rewardReceipts = [...receipts, receiptId].slice(-RECEIPT_LIMIT);
  stat(save, kind === 'hints' ? 'rewardedHints' : 'rewardedUndos', REWARDED_BOOSTS);
  return { ok: true, quantity: REWARDED_BOOSTS, remaining: save[kind] };
}

export function utcDay(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function freshEconomy() {
  return {
    economyVersion: ECONOMY_VERSION,
    hints: INITIAL_BOOSTS,
    undos: INITIAL_BOOSTS,
    rewardReceipts: [],
    dailyReplay: { day: '', levelIds: [] },
    economyStats: { spentBoosts: 0, spentCosmetics: 0, earnedCampaign: 0, earnedDaily: 0, rewardedHints: 0, rewardedUndos: 0 },
  };
}

export function recordCompletion(save, { levelId, stars, moves, date = Date.now() } = {}) {
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > LEVEL_COUNT || ![1, 2, 3].includes(stars)
      || !Number.isInteger(moves) || moves < 1 || moves > 99999 || !save.results
      || typeof save.results !== 'object' || !validCount(save.coins)) return failure('invalid');
  const previous = save.results[levelId];
  const firstClear = !previous?.completed;
  const improved = Math.max(0, stars - (previous?.stars || 0));
  const first = Math.floor((levelId - 1) / 20) * 20 + 1;
  const chapterFinished = () => Array.from({ length: 20 }, (_, index) => first + index)
    .every(id => save.results[id]?.completed === true);
  const previouslyFinished = chapterFinished();
  const campaignReward = firstClear ? 30 + (stars - 1) * 5 : improved * 5;
  save.results[levelId] = {
    stars: Math.max(stars, previous?.stars || 0),
    moves,
    bestMoves: Math.min(moves, previous?.bestMoves ?? Infinity),
    completed: true,
  };
  const chapterBonus = !previouslyFinished && chapterFinished() ? 100 : 0;
  const day = utcDay(date);
  let dailyBonus = 0;
  const daily = save.dailyReplay || { day: '', levelIds: [] };
  // A clock rollback cannot repeatedly reset the daily allowance.
  if (day && day > daily.day) save.dailyReplay = { day, levelIds: [] };
  else if (!save.dailyReplay) save.dailyReplay = daily;
  if (!firstClear && day && day === save.dailyReplay.day
      && save.dailyReplay.levelIds.length < DAILY_REPLAY_LIMIT && !save.dailyReplay.levelIds.includes(levelId)) {
    save.dailyReplay.levelIds.push(levelId);
    dailyBonus = DAILY_REPLAY_REWARD;
  }
  const reward = campaignReward + chapterBonus + dailyBonus;
  save.coins += reward;
  save.unlocked = Math.max(save.unlocked || 1, Math.min(LEVEL_COUNT, levelId + 1));
  save.active = null;
  stat(save, 'earnedCampaign', campaignReward + chapterBonus);
  stat(save, 'earnedDaily', dailyBonus);
  return { ok: true, reward, firstClear, improved, chapterBonus, dailyBonus, stars };
}
