import { LEVEL_COUNT, SKINS as SKIN_CATALOG, THEMES as THEME_CATALOG, RECEIPT_LIMIT, freshEconomy, utcDay } from './economy.js';

// Local progress stays usable even when storage is full, disabled or damaged.
let KEY = 'walkblock.save.v1';
let BACKUP_KEY = `${KEY}.backup`;
const MAX_TEXT_LENGTH = 1024 * 1024;
const SKINS = new Set(SKIN_CATALOG.map(item => item.id));
const THEMES = new Set(THEME_CATALOG.map(item => item.id));
const SETTING_KEYS = ['sound', 'music', 'haptics', 'reducedMotion'];
let memorySave = null;

export function freshSave() {
  return {
    version: 1,
    updatedAt: 0,
    revision: 0,
    coins: 150,
    ...freshEconomy(),
    unlocked: 1,
    results: {},
    ownedSkins: ['classic'],
    ownedThemes: ['dawn'],
    skin: 'classic',
    theme: 'dawn',
    settings: { sound: true, music: false, haptics: true, reducedMotion: false },
    hintsUsed: 0,
    active: null,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value, fallback, min, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.floor(value)))
    : fallback;
}

function ownedList(value, valid, base) {
  return [base, ...new Set(Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item !== base && valid.has(item))
    : [])];
}

function blockState(value) {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y)
      || Math.abs(value.x) > 100 || Math.abs(value.y) > 100) return null;
  if (![0, 1, 2].includes(value.o)) return null;
  return {
    x: value.x,
    y: value.y,
    o: value.o,
    mask: integer(value.mask, 0, 0, 4294967295),
  };
}

function activeGame(value) {
  if (!isRecord(value) || !Number.isInteger(value.levelId) || value.levelId < 1 || value.levelId > LEVEL_COUNT) return null;
  const position = blockState(value.state);
  if (!position) return null;
  return {
    levelId: value.levelId,
    state: position,
    history: Array.isArray(value.history) ? value.history.slice(-5000).map(blockState).filter(Boolean) : [],
    moves: integer(value.moves, 0, 0, 99999),
  };
}

function normalize(value) {
  const state = freshSave();
  if (!isRecord(value)) return state;
  state.updatedAt = integer(value.updatedAt, 0, 0, 9999999999999);
  state.revision = integer(value.revision, 0, 0, 999999999);
  state.coins = integer(value.coins, state.coins, 0, 9999999);
  state.unlocked = integer(value.unlocked, 1, 1, LEVEL_COUNT);
  state.hintsUsed = integer(value.hintsUsed, 0, 0, 9999999);
  // Legacy version-1 progress receives the welcome inventory once. A depleted
  // economy-aware save keeps zero; missing/damaged counters never refill it.
  if (value.economyVersion !== undefined) {
    state.hints = integer(value.hints, 0, 0, 9999999);
    state.undos = integer(value.undos, 0, 0, 9999999);
  }
  state.rewardReceipts = [...new Set(Array.isArray(value.rewardReceipts)
    ? value.rewardReceipts.filter(id => typeof id === 'string' && id.trim() && id.length <= 160)
    : [])].slice(-RECEIPT_LIMIT);
  if (isRecord(value.dailyReplay)) {
    const day = value.dailyReplay.day;
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && utcDay(`${day}T00:00:00.000Z`) === day) {
      state.dailyReplay = { day, levelIds: [...new Set(Array.isArray(value.dailyReplay.levelIds)
        ? value.dailyReplay.levelIds.filter(id => Number.isInteger(id) && id >= 1 && id <= LEVEL_COUNT) : [])].slice(0, 3) };
    }
  }
  if (isRecord(value.economyStats)) {
    for (const key of Object.keys(state.economyStats)) state.economyStats[key] = integer(value.economyStats[key], 0, 0, 999999999);
  }
  state.active = activeGame(value.active);
  state.ownedSkins = ownedList(value.ownedSkins, SKINS, 'classic');
  state.ownedThemes = ownedList(value.ownedThemes, THEMES, 'dawn');
  if (state.ownedSkins.includes(value.skin)) state.skin = value.skin;
  if (state.ownedThemes.includes(value.theme)) state.theme = value.theme;
  if (isRecord(value.settings)) {
    for (const key of SETTING_KEYS) {
      if (typeof value.settings[key] === 'boolean') state.settings[key] = value.settings[key];
    }
  }
  if (isRecord(value.results)) {
    for (const [key, result] of Object.entries(value.results)) {
      if (!/^[1-9]\d{0,2}$/.test(key) || Number(key) > LEVEL_COUNT || !isRecord(result) || result.completed !== true) continue;
      const moves = integer(result.moves, 0, 0, 99999);
      state.results[key] = {
        stars: integer(result.stars, 1, 1, 3),
        moves,
        bestMoves: integer(result.bestMoves, moves, 0, 99999),
        completed: true,
      };
      state.unlocked = Math.min(LEVEL_COUNT, Math.max(state.unlocked, Number(key) + 1));
    }
  }
  return state;
}

function parse(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH || !text.trim()) {
    throw new Error('Файл сохранения пустой или слишком большой.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('Unsafe save key');
      }
      return value;
    });
  } catch {
    throw new Error('Не удалось прочитать сохранение. Выберите JSON-файл прогресса игры.');
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.results)
      || !Number.isFinite(parsed.coins) || !Number.isFinite(parsed.unlocked)) {
    throw new Error('Этот файл не является сохранением игры или имеет другую версию.');
  }
  return normalize(parsed);
}

export function loadSave() {
  for (const key of [KEY, BACKUP_KEY]) {
    try {
      const text = globalThis.localStorage?.getItem(key);
      if (text) {
        const state = parse(text);
        memorySave = state;
        if (key === BACKUP_KEY) {
          try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* In-memory fallback. */ }
        }
        return normalize(state);
      }
    } catch { /* Try the previous valid save. */ }
  }
  return normalize(memorySave || freshSave());
}

export function saveSave(value) {
  const state = normalize(value);
  memorySave = state;
  try {
    const previous = globalThis.localStorage?.getItem(KEY);
    if (previous) {
      try {
        parse(previous);
        globalThis.localStorage?.setItem(BACKUP_KEY, previous);
      } catch { /* Never overwrite a healthy backup with corrupt data. */ }
    }
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state));
  } catch { /* Private browsing and exhausted quota must not interrupt play. */ }
  return normalize(state);
}

export function exportSave(state) {
  return JSON.stringify(normalize(state), null, 2);
}

export function importSave(text) {
  return saveSave(parse(text));
}

export function parseSave(text) { return parse(text); }

export function chooseSave(local, remote) {
  const a = normalize(local), b = normalize(remote);
  return b.updatedAt > a.updatedAt || (b.updatedAt === a.updatedAt && b.revision >= a.revision) ? b : a;
}

export function setSaveScope(userId = null) {
  KEY = userId && /^\d+$/.test(String(userId)) ? `walkblock.save.v1.vk_${userId}` : 'walkblock.save.v1';
  BACKUP_KEY = `${KEY}.backup`;
  memorySave = null;
}
