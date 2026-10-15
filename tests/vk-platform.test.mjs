import test from 'node:test';
import assert from 'node:assert/strict';
import { createVKPlatform, VK_APP_ID } from '../dist/vk-platform.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const values = options.values || new Map();
  const calls = [], handlers = new Set(), docHandlers = new Map();
  let now = 1000, account = 42;
  const win = { parent: {}, addEventListener() {} };
  const env = {
    window: win,
    location: { search: `?vk_app_id=${VK_APP_ID}&vk_platform=desktop_web&vk_user_id=999` },
    document: { hidden: false, addEventListener(name, callback) { docHandlers.set(name, callback); } },
  };
  const bridge = {
    subscribe(callback) { handlers.add(callback); },
    async supportsAsync(method) { return !(options.unsupported || []).includes(method); },
    async send(method, params) {
      calls.push({ method, params });
      if (options.override) {
        const response = options.override(method, params);
        if (response !== undefined) return response;
      }
      if (method === 'VKWebAppGetUserInfo') return { id: account };
      if (method === 'VKWebAppStorageGet') return { keys: params.keys.map(key => ({ key, value: values.get(key) || '' })) };
      if (method === 'VKWebAppStorageSet') { values.set(params.key, params.value); return { result: true }; }
      if (method === 'VKWebAppShowBannerAd') return { result: true, banner_height: 48, banner_location: 'bottom', layout_type: 'overlay' };
      return { result: true };
    },
  };
  const platform = createVKPlatform({ env, loadBridge: async () => bridge, now: () => now, saveDebounce: 120000, requestTimeout: 1000 });
  return {
    platform, bridge, calls, values, env,
    advance(milliseconds) { now += milliseconds; },
    account(id) { account = id; },
    emit(type, data) { for (const handler of handlers) handler({ detail: { type, data } }); },
    count(method) { return calls.filter(call => call.method === method).length; },
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const save = coins => JSON.stringify({ version: 1, results: {}, coins, unlocked: 1 });

test('ordinary browser and mismatched app do not load the SDK or reserve a banner', async () => {
  for (const [embedded, search] of [[false, ''], [false, `?vk_app_id=${VK_APP_ID}&vk_platform=desktop_web`], [true, '?vk_app_id=123&vk_platform=desktop_web']]) {
    const win = { addEventListener() {} };
    win.parent = embedded ? {} : win;
    let loads = 0;
    const platform = createVKPlatform({ env: { window: win, location: { search } }, loadBridge: async () => { loads++; } });
    assert.deepEqual(await platform.init(), { isVK: false, userId: null, bannerHeight: 0 });
    assert.equal(loads, 0);
    assert.equal(await platform.loadSave(), null);
    assert.equal(platform.queueSave(save(2)), false);
    assert.equal(await platform.afterRound('loss'), false);
  }
});

test('SDK identity overrides launch ID, and bottom banner stays requested across restore', async () => {
  const f = fixture();
  const heights = [];
  f.platform.onBannerChange(height => heights.push(height));
  const initialized = await f.platform.init();
  assert.equal(initialized.isVK, true);
  assert.equal(initialized.userId, 42);
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
  assert.equal(f.count('VKWebAppShowBannerAd'), 1);
  assert.equal(f.calls.find(call => call.method === 'VKWebAppShowBannerAd').params.can_close, false);
  f.emit('VKWebAppBannerAdUpdated', { result: true, banner_height: 64, layout_type: 'overlay' });
  assert.equal(f.platform.bannerHeight, 64);
  f.emit('VKWebAppBannerAdUpdated', { result: true, banner_height: 64, layout_type: 'resize' });
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppViewHide');
  f.emit('VKWebAppViewRestore');
  await tick(); await tick();
  assert.equal(f.count('VKWebAppShowBannerAd'), 2);
  assert.deepEqual(heights, [0, 48, 64, 0, 48]);
});

test('unavailable banner leaves no fictitious advertising placeholder', async () => {
  const f = fixture({ override: method => method === 'VKWebAppShowBannerAd' ? Promise.reject(new Error('No fill')) : undefined });
  assert.equal((await f.platform.init()).isVK, true);
  assert.equal(f.platform.bannerHeight, 0);
});

test('pending banner inventory does not hold account initialization or the cloud load', async () => {
  const banner = deferred();
  const f = fixture({ override: method => method === 'VKWebAppShowBannerAd' ? banner.promise : undefined });
  assert.equal((await f.platform.init()).isVK, true);
  assert.equal(f.platform.bannerHeight, 0);
  assert.equal(await f.platform.loadSave(), null);
  assert.equal(f.platform.cloudReady, true);
  banner.resolve({ result: true, banner_height: 48, banner_location: 'bottom', layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
});

test('initial cloud load gates writes, including a queued local snapshot during that read', async () => {
  const read = deferred();
  let hold = true;
  const f = fixture({ override: method => method === 'VKWebAppStorageGet' && hold ? read.promise : undefined });
  await f.platform.init();
  assert.equal(f.platform.queueSave(save(5)), false);
  const loading = f.platform.loadSave();
  await tick();
  assert.equal(f.platform.queueSave(save(7)), false);
  assert.equal(f.count('VKWebAppStorageSet'), 0);
  hold = false;
  read.resolve({ keys: [] });
  assert.equal(await loading, null);
  assert.equal(f.platform.cloudReady, true);
  assert.equal(await f.platform.flushSave(), false);
  assert.equal(f.platform.queueSave(save(9)), true);
  assert.equal(await f.platform.flushSave(), true);
  assert.equal(f.count('VKWebAppStorageSet'), 2);
  assert.ok([...f.values.keys()].every(key => key.startsWith('kubohod_v2_42_')));
});

test('large Unicode saves roundtrip through bounded ASCII chunks with a committed manifest', async () => {
  const f = fixture();
  await f.platform.loadSave();
  const text = JSON.stringify({ version: 1, notes: 'Сохранение ⭐ '.repeat(5000) });
  assert.equal(f.platform.queueSave(text), true);
  await f.platform.flushSave();
  const chunks = [...f.values.entries()].filter(([key]) => !key.endsWith('_head'));
  assert.ok(chunks.length > 8);
  assert.ok(chunks.every(([, value]) => Buffer.byteLength(value) <= 2800 && /^[A-Za-z0-9+/=]+$/.test(value)));
  const other = fixture({ values: f.values });
  assert.equal(await other.platform.loadSave(), text);
});

test('failed reads never become permission to overwrite a remote save', async () => {
  const f = fixture({ override: method => method === 'VKWebAppStorageGet' ? Promise.reject(new Error('offline')) : undefined });
  assert.equal(await f.platform.loadSave(), null);
  assert.equal(f.platform.cloudReady, false);
  assert.equal(f.platform.queueSave(save(1)), false);
  assert.equal(await f.platform.flushSave(), false);
  assert.equal(f.count('VKWebAppStorageSet'), 0);
});

test('damaged cloud chunks are rejected and cannot be replaced by an unmerged local save', async () => {
  const f = fixture();
  await f.platform.loadSave();
  f.platform.queueSave(save(50));
  await f.platform.flushSave();
  f.values.set('kubohod_v2_42_a_0', btoa('{"coins":9999}'));
  const other = fixture({ values: f.values });
  assert.equal(await other.platform.loadSave(), null);
  assert.equal(other.platform.cloudReady, false);
  assert.equal(other.platform.queueSave(save(2)), false);
  assert.equal(await other.platform.flushSave(), false);
});

test('an interrupted new bank preserves the previously committed save', async () => {
  const f = fixture();
  await f.platform.loadSave();
  f.platform.queueSave(save(50));
  await f.platform.flushSave();
  const originalHead = f.values.get('kubohod_v2_42_head');
  const broken = fixture({ values: f.values, override: (method, params) => method === 'VKWebAppStorageSet' && params.key.includes('_b_') ? { result: false } : undefined });
  assert.equal(await broken.platform.loadSave(), save(50));
  broken.platform.queueSave(save(80));
  assert.equal(await broken.platform.flushSave(), false);
  assert.equal(f.values.get('kubohod_v2_42_head'), originalHead);
  assert.equal(await fixture({ values: f.values }).platform.loadSave(), save(50));
});

test('writes serialize and retain the latest snapshot received while the first write is pending', async () => {
  const firstChunk = deferred();
  let held = false;
  const f = fixture({ override: (method, params) => {
    if (method === 'VKWebAppStorageSet' && !held) {
      held = true;
      return firstChunk.promise.then(() => { f.values.set(params.key, params.value); return { result: true }; });
    }
  } });
  await f.platform.loadSave();
  f.platform.queueSave(save(10));
  const writing = f.platform.flushSave();
  await tick();
  f.platform.queueSave(save(20));
  assert.equal(f.platform.flushSave(), writing);
  firstChunk.resolve();
  assert.equal(await writing, true);
  assert.equal(await fixture({ values: f.values }).platform.loadSave(), save(20));
});

test('undoing to the last committed state cancels a pending stale snapshot', async () => {
  const f = fixture();
  await f.platform.loadSave();
  f.platform.queueSave(save(10));
  await f.platform.flushSave();
  f.platform.queueSave(save(20));
  f.platform.queueSave(save(10));
  assert.equal(await f.platform.flushSave(), false);
  assert.equal(await fixture({ values: f.values }).platform.loadSave(), save(10));
});

test('interstitials require a completed round, three attempts, and a 90 second cooldown', async () => {
  const f = fixture();
  await f.platform.init();
  await f.platform.afterRound('loss');
  await f.platform.afterRound('win');
  await f.platform.afterRound('loss');
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
  f.advance(120000);
  // Advancing time and flushing saves never displays a fullscreen ad.
  await tick(); await f.platform.flushSave();
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
  await f.platform.afterRound('playing');
  assert.equal(f.count('VKWebAppCheckNativeAds'), 0);
  assert.equal(await f.platform.afterRound('win'), true);
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
  assert.equal(f.calls.find(call => call.method === 'VKWebAppShowNativeAds').params.ad_format, 'interstitial');
  await f.platform.afterRound('loss');
  await f.platform.afterRound('loss');
  await f.platform.afterRound('loss');
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
  f.advance(90000);
  assert.equal(await f.platform.afterRound('loss'), true);
  assert.equal(f.count('VKWebAppShowNativeAds'), 2);
});

test('advertising cancellation releases pause; concurrent round callbacks cannot stack ads', async () => {
  const showing = deferred();
  const f = fixture({ override: method => method === 'VKWebAppShowNativeAds' ? showing.promise : undefined });
  const events = [];
  f.platform.onPause(reason => events.push(`pause:${reason}`));
  f.platform.onResume(reason => events.push(`resume:${reason}`));
  await f.platform.init();
  f.advance(90000);
  await f.platform.afterRound('win'); await f.platform.afterRound('loss');
  const ad = f.platform.afterRound('loss');
  await tick();
  assert.equal(f.platform.isAdOpen, true);
  assert.equal(await f.platform.afterRound('win'), false);
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
  showing.reject(new Error('User cancelled'));
  assert.equal(await ad, false);
  assert.equal(f.platform.isAdOpen, false);
  assert.deepEqual(events, ['pause:ad', 'resume:ad']);
});

test('unavailable ads and a hidden VK client never start an interstitial', async () => {
  const f = fixture({ override: method => method === 'VKWebAppCheckNativeAds' ? { result: false } : undefined });
  await f.platform.init(); f.advance(90000);
  for (let attempt = 0; attempt < 5; attempt++) await f.platform.afterRound('loss');
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
  f.emit('VKWebAppViewHide');
  await f.platform.afterRound('win');
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
});

test('a client hidden while ad availability is pending never opens a late ad', async () => {
  const available = deferred();
  const f = fixture({ override: method => method === 'VKWebAppCheckNativeAds' ? available.promise : undefined });
  await f.platform.init(); f.advance(90000);
  await f.platform.afterRound('loss'); await f.platform.afterRound('win');
  const boundary = f.platform.afterRound('loss');
  await tick();
  f.emit('VKWebAppViewHide');
  available.resolve({ result: true });
  assert.equal(await boundary, false);
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
});

test('VK account change freezes cloud writes until a fresh app session', async () => {
  const f = fixture();
  const accounts = [];
  f.platform.onAccountChange(id => accounts.push(id));
  await f.platform.loadSave();
  f.platform.queueSave(save(5));
  f.account(100);
  f.emit('VKWebAppViewRestore');
  await tick(); await tick();
  assert.deepEqual(accounts, [100]);
  assert.equal(f.platform.cloudReady, false);
  assert.equal(f.platform.queueSave(save(7)), false);
  assert.equal(await f.platform.flushSave(), false);
  assert.equal(f.count('VKWebAppStorageSet'), 0);
});
