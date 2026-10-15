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
  const calls = [], handlers = new Set(), docHandlers = new Map(), windowHandlers = new Map();
  let now = 1000, account = 42;
  const win = { parent: {}, innerWidth: 390, innerHeight: 844, addEventListener(name, callback) { windowHandlers.set(name, callback); } };
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
      if (method === 'VKWebAppCheckBannerAd') return { result: true, banner_height: 48, banner_location: 'bottom', layout_type: 'overlay' };
      return { result: true };
    },
  };
  const platform = createVKPlatform({ env, loadBridge: options.loadBridge || (async () => bridge), now: () => now, saveDebounce: 120000, requestTimeout: options.requestTimeout ?? 1000, bannerPollInterval: options.bannerPollInterval ?? 1000 });
  return {
    platform, bridge, calls, values, env,
    advance(milliseconds) { now += milliseconds; },
    account(id) { account = id; },
    emit(type, data) { for (const handler of handlers) handler({ detail: { type, data } }); },
    resize(height, width = win.innerWidth) { win.innerWidth = width; win.innerHeight = height; windowHandlers.get('resize')?.(); },
    visibility(hidden) { env.document.hidden = hidden; docHandlers.get('visibilitychange')?.(); },
    count(method) { return calls.filter(call => call.method === method).length; },
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(predicate, message) {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await delay(2);
  }
}
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
  assert.equal(f.calls.find(call => call.method === 'VKWebAppShowBannerAd').params.layout_type, 'overlay');
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
  const f = fixture({ override: method => ['VKWebAppShowBannerAd', 'VKWebAppCheckBannerAd'].includes(method) ? { result: false } : undefined });
  assert.equal((await f.platform.init()).isVK, true);
  await tick();
  assert.equal(f.platform.bannerHeight, 0);
});

test('pending banner inventory does not hold account initialization or the cloud load', async () => {
  const banner = deferred();
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? banner.promise : undefined });
  assert.equal((await f.platform.init()).isVK, true);
  assert.equal(f.platform.bannerHeight, 0);
  assert.equal(await f.platform.loadSave(), null);
  assert.equal(f.platform.cloudReady, true);
  banner.resolve({ result: true, banner_height: 48, banner_location: 'bottom', layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
});

test('delayed SDK loading never creates an assumed advertising gap', async () => {
  const sdk = deferred();
  const f = fixture({ loadBridge: () => sdk.promise });
  const heights = [];
  f.platform.onBannerChange(height => heights.push(height));
  const loading = f.platform.init();
  assert.equal(f.platform.bannerHeight, 0);
  assert.equal(f.count('VKWebAppShowBannerAd'), 0);
  sdk.resolve(f.bridge);
  await loading; await tick();
  assert.deepEqual(heights, [0, 48]);
});

test('partial acknowledgements and malformed geometry retain only a previously measured height', async () => {
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? { result: true } : undefined });
  await f.platform.init(); await tick();
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppBannerAdUpdated', { banner_height: 58, layout_type: 'overlay' });
  assert.equal(f.platform.bannerHeight, 58);
  for (const data of [{}, { result: true }, { banner_height: 0 }, { banner_height: 'bad' }, { banner_height: -1 }, { banner_height: null }]) {
    f.emit('VKWebAppBannerAdUpdated', data);
    assert.equal(f.platform.bannerHeight, 58);
  }
  f.emit('VKWebAppBannerAdUpdated', { banner_height: 72 });
  assert.equal(f.platform.bannerHeight, 72, 'a height-only update preserves the overlay layout');
});

test('a partial show response can obtain actual geometry through CheckBannerAd', async () => {
  const f = fixture({ override: method => {
    if (method === 'VKWebAppShowBannerAd') return { result: true };
    if (method === 'VKWebAppCheckBannerAd') return { result: true, banner_height: 50, layout_type: 'overlay', banner_location: 'bottom' };
  } });
  await f.platform.init();
  await waitUntil(() => f.platform.bannerHeight === 50, 'CheckBannerAd must supply actual geometry');
  assert.equal(f.platform.bannerHeight, 50);
  assert.ok(f.count('VKWebAppCheckBannerAd') >= 1);
});

test('a partial SDK event never invalidates complete geometry from a pending show', async () => {
  const showing = deferred();
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? showing.promise : undefined });
  await f.platform.init(); await tick();
  f.emit('VKWebAppBannerAdUpdated', { result: true });
  f.emit('VKWebAppShowBannerAdResult', { result: true });
  assert.equal(f.platform.bannerHeight, 0);
  showing.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
});

test('partial overlay and bottom acknowledgements without a height do not supersede a complete show reply', async () => {
  const showing = deferred();
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? showing.promise : undefined });
  await f.platform.init(); await tick();
  f.emit('VKWebAppBannerAdUpdated', { result: true, layout_type: 'overlay', banner_location: 'bottom' });
  f.emit('VKWebAppShowBannerAdResult', { result: true, layout_type: 'overlay', banner_location: 'bottom' });
  assert.equal(f.platform.bannerHeight, 0);
  showing.resolve({ result: true, banner_height: 56, layout_type: 'overlay', banner_location: 'bottom' });
  await tick();
  assert.equal(f.platform.bannerHeight, 56);
});

test('a request-tagged SDK show result cannot overwrite newer geometry or resurrect a closed banner', async () => {
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'] });
  await f.platform.init(); await tick();
  assert.equal(f.platform.bannerHeight, 48);
  f.emit('VKWebAppBannerAdUpdated', { result: true, banner_height: 64, layout_type: 'overlay', banner_location: 'bottom' });
  const oldResult = { result: true, request_id: 'older-sdk-request', banner_height: 48, layout_type: 'overlay', banner_location: 'bottom' };
  f.emit('VKWebAppShowBannerAdResult', oldResult);
  assert.equal(f.platform.bannerHeight, 64, 'request-tagged replies belong to the guarded show promise');
  f.emit('VKWebAppBannerAdClosedByUser', {});
  f.emit('VKWebAppShowBannerAdResult', oldResult);
  assert.equal(f.platform.bannerHeight, 0, 'an old SDK response must not restore a closed banner');
});

test('actual updated geometry is not overwritten by an older pending show response', async () => {
  const showing = deferred();
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? showing.promise : undefined });
  await f.platform.init(); await tick();
  f.emit('VKWebAppBannerAdUpdated', { result: true, banner_height: 60, layout_type: 'overlay' });
  showing.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 60, 'a stale promise cannot overwrite a newer SDK update');
});

test('an initial show rejection and explicit no-ad check leave no advertising gap', async () => {
  const f = fixture({ override: method => {
    if (method === 'VKWebAppShowBannerAd') return Promise.reject(new Error('No fill'));
    if (method === 'VKWebAppCheckBannerAd') return { result: false };
  } });
  await f.platform.init(); await tick(); await tick();
  assert.equal(f.platform.bannerHeight, 0);
});

test('a no-ad check before a pending show does not invalidate its later actual geometry', async () => {
  const showing = deferred();
  const f = fixture({ override: method => {
    if (method === 'VKWebAppShowBannerAd') return showing.promise;
    if (method === 'VKWebAppCheckBannerAd') return { result: false };
  } });
  await f.platform.init();
  await waitUntil(() => f.count('VKWebAppCheckBannerAd') >= 1, 'initial banner status must be checked');
  await tick();
  assert.equal(f.platform.bannerHeight, 0);
  showing.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
});

test('a timed-out show releases its lease so a restore can retry; an old result stays stale', async () => {
  const first = deferred();
  let shows = 0;
  const f = fixture({ requestTimeout: 10, unsupported: ['VKWebAppCheckBannerAd'], override: method => {
    if (method === 'VKWebAppShowBannerAd') return ++shows === 1 ? first.promise : { result: true, banner_height: 64, layout_type: 'overlay' };
  } });
  await f.platform.init(); await tick();
  await delay(25);
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppViewRestore');
  await waitUntil(() => f.count('VKWebAppShowBannerAd') === 2, 'restore must retry a timed-out banner request');
  await tick();
  assert.equal(f.platform.bannerHeight, 64);
  first.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 64);
});

test('a late show result can still apply real geometry if no newer request or close exists', async () => {
  const showing = deferred();
  const f = fixture({ requestTimeout: 10, unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? showing.promise : undefined });
  await f.platform.init(); await tick();
  await delay(25);
  assert.equal(f.platform.bannerHeight, 0);
  showing.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 48);
});

test('refresh errors, failed hide results, and partial events retain known banner geometry', async () => {
  let fail = false;
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => {
    if (method === 'VKWebAppShowBannerAd' && fail) return Promise.reject(new Error('network'));
  } });
  await f.platform.init(); await tick();
  fail = true;
  f.emit('VKWebAppViewRestore'); await tick(); await tick();
  f.emit('VKWebAppHideBannerAdResult', { result: false });
  f.emit('VKWebAppShowBannerAdFailed', {});
  assert.equal(f.platform.bannerHeight, 48);
  f.emit('VKWebAppHideBannerAdResult', { result: true });
  assert.equal(f.platform.bannerHeight, 0);
});

test('SDK resize is native; overlay uses exactly the reported height without guessed viewport or safe area additions', async () => {
  const f = fixture({ unsupported: ['VKWebAppCheckBannerAd'], override: method => method === 'VKWebAppShowBannerAd' ? { result: true, banner_height: 50, layout_type: 'resize' } : undefined });
  await f.platform.init(); await tick();
  f.emit('VKWebAppUpdateConfig', { insets: { top: 20, bottom: 34, left: 0, right: 0 } });
  assert.equal(f.platform.bannerHeight, 0);
  f.resize(794);
  assert.equal(f.platform.bannerHeight, 0);
  f.resize(760);
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppBannerAdUpdated', { result: true });
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppUpdateInsets', { insets: { bottom: 40 } });
  assert.equal(f.platform.bannerHeight, 0);
  f.emit('VKWebAppBannerAdUpdated', { result: true, layout_type: 'overlay' });
  assert.equal(f.platform.bannerHeight, 50);
  f.resize(844);
  assert.equal(f.platform.bannerHeight, 50, 'ordinary viewport changes do not guess a different overlay height');
  f.emit('VKWebAppBannerAdClosedByUser', {});
  assert.equal(f.platform.bannerHeight, 0);
});

test('unsupported clients and failed initialization never create an advertising gap', async () => {
  const f = fixture({ unsupported: ['VKWebAppShowBannerAd', 'VKWebAppCheckBannerAd'] });
  await f.platform.init(); await tick();
  assert.equal(f.platform.bannerHeight, 0);
  assert.equal(f.count('VKWebAppShowBannerAd'), 0);
  const bad = fixture({ override: method => method === 'VKWebAppInit' ? { result: false } : undefined });
  assert.equal((await bad.platform.init()).isVK, false);
  assert.equal(bad.platform.bannerHeight, 0);
});

test('a stale availability check cannot resurrect a closed banner', async () => {
  const check = deferred();
  const f = fixture({ bannerPollInterval: 20, override: method => {
    if (method === 'VKWebAppShowBannerAd') return { result: true };
    if (method === 'VKWebAppCheckBannerAd') return check.promise;
  } });
  await f.platform.init();
  await waitUntil(() => f.count('VKWebAppCheckBannerAd') === 1, 'a check must be pending before the close event');
  f.emit('VKWebAppBannerAdClosedByUser', {});
  check.resolve({ result: true, banner_height: 48, layout_type: 'overlay' });
  await tick();
  assert.equal(f.platform.bannerHeight, 0);
});

test('visible status checks track real banner height and no-ad state while never requesting another show', async () => {
  const showing = deferred();
  let checked = { result: false };
  const f = fixture({ bannerPollInterval: 20, override: method => {
    if (method === 'VKWebAppShowBannerAd') return showing.promise;
    if (method === 'VKWebAppCheckBannerAd') return checked;
  } });
  await f.platform.init(); await tick();
  assert.equal(f.platform.bannerHeight, 0);
  checked = { result: true, banner_height: 64, layout_type: 'overlay', banner_location: 'bottom' };
  await waitUntil(() => f.platform.bannerHeight === 64, 'visible status checks must catch real geometry before Show resolves');
  assert.equal(f.count('VKWebAppShowBannerAd'), 1);
  checked = { result: false };
  await waitUntil(() => f.platform.bannerHeight === 0, 'a no-ad check must remove the previous advertising gap');
  f.visibility(true);
  await tick();
  const hiddenCount = f.count('VKWebAppCheckBannerAd');
  await delay(65);
  assert.equal(f.count('VKWebAppCheckBannerAd'), hiddenCount, 'background clients do not keep checking ad status');
  assert.equal(f.count('VKWebAppShowBannerAd'), 1, 'status polling never calls ShowBannerAd');
  showing.resolve({ result: false });
  await tick();
});

test('status checks never overlap while the SDK response is pending', async () => {
  const checking = deferred();
  const f = fixture({ bannerPollInterval: 20, requestTimeout: 200, override: method => method === 'VKWebAppCheckBannerAd' ? checking.promise : undefined });
  await f.platform.init();
  await waitUntil(() => f.count('VKWebAppCheckBannerAd') === 1, 'status checking must start');
  await delay(65);
  assert.equal(f.count('VKWebAppCheckBannerAd'), 1);
  checking.resolve({ result: true, banner_height: 64, layout_type: 'overlay' });
  await waitUntil(() => f.platform.bannerHeight === 64, 'resolved status geometry must apply');
  f.visibility(true);
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

test('rewarded video is explicit, uses reward format, and returns a unique receipt only after SDK completion', async () => {
  const showing = deferred();
  let held = true;
  const f = fixture({ override: (method, params) => method === 'VKWebAppShowNativeAds' && params.ad_format === 'reward' && held ? showing.promise : undefined });
  const events = [];
  f.platform.onPause(reason => events.push(`pause:${reason}`));
  f.platform.onResume(reason => events.push(`resume:${reason}`));
  await f.platform.init();
  await tick();
  assert.equal(f.count('VKWebAppCheckNativeAds'), 0);
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
  const pending = f.platform.rewarded('hints');
  await tick();
  assert.equal(f.platform.isAdOpen, true);
  assert.deepEqual(events, ['pause:reward']);
  assert.deepEqual(f.calls.find(call => call.method === 'VKWebAppCheckNativeAds').params, { ad_format: 'reward' });
  assert.deepEqual(f.calls.find(call => call.method === 'VKWebAppShowNativeAds').params, { ad_format: 'reward' });
  showing.resolve({ result: true });
  const reward = await pending;
  assert.equal(reward.ok, true);
  assert.match(reward.receiptId, /^reward:42:hints:/);
  assert.ok(reward.receiptId.length <= 160);
  assert.equal(f.platform.isAdOpen, false);
  assert.deepEqual(events, ['pause:reward', 'resume:reward']);
  held = false;
  const second = await f.platform.rewarded('undos');
  assert.equal(second.ok, true);
  assert.match(second.receiptId, /^reward:42:undos:/);
  assert.notEqual(second.receiptId, reward.receiptId);
});

test('ordinary browsers, unsupported methods and empty rewarded inventory return no advertising reward', async () => {
  const outside = createVKPlatform({ env: {} });
  assert.deepEqual(await outside.rewarded('hints'), { ok: false, reason: 'unavailable' });
  for (const unsupported of [['VKWebAppCheckNativeAds'], ['VKWebAppShowNativeAds']]) {
    const f = fixture({ unsupported });
    await f.platform.init();
    assert.deepEqual(await f.platform.rewarded('hints'), { ok: false, reason: 'unavailable' });
    assert.equal(f.count('VKWebAppShowNativeAds'), 0);
    assert.equal(f.platform.isAdOpen, false);
  }
  const empty = fixture({ override: method => method === 'VKWebAppCheckNativeAds' ? { result: false } : undefined });
  await empty.platform.init();
  assert.deepEqual(await empty.platform.rewarded('undos'), { ok: false, reason: 'unavailable' });
  assert.equal(empty.count('VKWebAppShowNativeAds'), 0);
  assert.deepEqual(await empty.platform.rewarded('unknown'), { ok: false, reason: 'unavailable' });
});

test('cancelled, rejected and malformed rewarded results never return an inventory receipt and always release the ad pause', async () => {
  const cases = [
    { response: { result: false }, reason: 'cancelled' },
    { response: {}, reason: 'cancelled' },
    { error: { error_data: { error_reason: 'User denied' } }, reason: 'cancelled' },
    { error: new Error('Native video failed'), reason: 'unavailable' },
  ];
  for (const entry of cases) {
    const f = fixture({ override: method => {
      if (method !== 'VKWebAppShowNativeAds') return;
      if (entry.error) throw entry.error;
      return entry.response;
    } });
    const events = [];
    f.platform.onPause(reason => events.push(`pause:${reason}`));
    f.platform.onResume(reason => events.push(`resume:${reason}`));
    await f.platform.init();
    const result = await f.platform.rewarded('hints');
    assert.deepEqual(result, { ok: false, reason: entry.reason });
    assert.equal('receiptId' in result, false);
    assert.equal(f.platform.isAdOpen, false);
    assert.deepEqual(events, ['pause:reward', 'resume:reward']);
  }
});

test('pending rewarded availability owns the shared boundary and double taps cannot stack rewarded or interstitial ads', async () => {
  const available = deferred();
  const f = fixture({ override: (method, params) => method === 'VKWebAppCheckNativeAds' && params.ad_format === 'reward' ? available.promise : undefined });
  await f.platform.init();
  f.advance(90000);
  await f.platform.afterRound('win');
  await f.platform.afterRound('loss');
  const reward = f.platform.rewarded('undos');
  await tick();
  assert.deepEqual(await f.platform.rewarded('hints'), { ok: false, reason: 'busy' });
  assert.equal(await f.platform.afterRound('loss'), false);
  assert.equal(f.count('VKWebAppCheckNativeAds'), 1);
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
  available.resolve({ result: true });
  assert.equal((await reward).ok, true);
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
});

test('a rewarded native video keeps the pause beyond ordinary request timeouts and rejects parallel calls', async () => {
  const showing = deferred();
  const f = fixture({ requestTimeout: 10, override: method => method === 'VKWebAppShowNativeAds' ? showing.promise : undefined });
  await f.platform.init();
  const reward = f.platform.rewarded('hints');
  await tick();
  await delay(25);
  assert.equal(f.platform.isAdOpen, true);
  assert.deepEqual(await f.platform.rewarded('undos'), { ok: false, reason: 'busy' });
  assert.equal(await f.platform.afterRound('win'), false);
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
  showing.resolve({ result: true });
  assert.equal((await reward).ok, true);
  assert.equal(f.platform.isAdOpen, false);
});

test('an interstitial availability request excludes rewarded video until its boundary finishes', async () => {
  const available = deferred();
  const f = fixture({ override: (method, params) => method === 'VKWebAppCheckNativeAds' && params.ad_format === 'interstitial' ? available.promise : undefined });
  await f.platform.init();
  f.advance(90000);
  await f.platform.afterRound('loss');
  await f.platform.afterRound('win');
  const boundary = f.platform.afterRound('loss');
  await tick();
  assert.deepEqual(await f.platform.rewarded('hints'), { ok: false, reason: 'busy' });
  available.resolve({ result: true });
  assert.equal(await boundary, true);
  assert.equal((await f.platform.rewarded('hints')).ok, true);
  assert.deepEqual(f.calls.filter(call => call.method === 'VKWebAppShowNativeAds').map(call => call.params.ad_format), ['interstitial', 'reward']);
});

test('rewarded video restarts the interstitial cooldown, including when the video is cancelled', async () => {
  for (const result of [true, false]) {
    const f = fixture({ override: (method, params) => method === 'VKWebAppShowNativeAds' && params.ad_format === 'reward' ? { result } : undefined });
    await f.platform.init();
    f.advance(90000);
    await f.platform.afterRound('win');
    await f.platform.afterRound('loss');
    await f.platform.rewarded('hints');
    f.advance(89999);
    for (let attempt = 0; attempt < 3; attempt++) await f.platform.afterRound('loss');
    assert.equal(f.calls.filter(call => call.method === 'VKWebAppShowNativeAds' && call.params.ad_format === 'interstitial').length, 0);
    f.advance(1);
    assert.equal(await f.platform.afterRound('win'), true);
  }
});

test('a hidden client or a client hidden during availability never opens a rewarded video', async () => {
  const available = deferred();
  const f = fixture({ override: method => method === 'VKWebAppCheckNativeAds' ? available.promise : undefined });
  await f.platform.init();
  f.visibility(true);
  assert.deepEqual(await f.platform.rewarded('hints'), { ok: false, reason: 'busy' });
  f.visibility(false);
  const pending = f.platform.rewarded('hints');
  await tick();
  f.emit('VKWebAppViewHide');
  available.resolve({ result: true });
  assert.deepEqual(await pending, { ok: false, reason: 'busy' });
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
});

test('rewarded success verifies the SDK account again and refuses to award a different account', async () => {
  const showing = deferred();
  const f = fixture({ override: method => method === 'VKWebAppShowNativeAds' ? showing.promise : undefined });
  await f.platform.loadSave();
  const accounts = [];
  f.platform.onAccountChange(id => accounts.push(id));
  const pending = f.platform.rewarded('hints');
  await tick();
  f.account(100);
  showing.resolve({ result: true });
  assert.deepEqual(await pending, { ok: false, reason: 'account' });
  assert.deepEqual(accounts, [100]);
  assert.equal(f.platform.cloudReady, false);
  assert.equal(f.platform.isAdOpen, false);
  assert.deepEqual(await f.platform.rewarded('undos'), { ok: false, reason: 'account' });
  assert.equal(f.count('VKWebAppShowNativeAds'), 1);
});

test('account mismatch before rewarded availability prevents the video from opening', async () => {
  const f = fixture();
  await f.platform.init();
  f.account(100);
  assert.deepEqual(await f.platform.rewarded('undos'), { ok: false, reason: 'account' });
  assert.equal(f.count('VKWebAppCheckNativeAds'), 0);
  assert.equal(f.count('VKWebAppShowNativeAds'), 0);
});

test('rewarded video suspends banner polling while open and resumes the existing banner flow on close', async () => {
  const showing = deferred();
  const f = fixture({ bannerPollInterval: 15, override: method => method === 'VKWebAppShowNativeAds' ? showing.promise : undefined });
  await f.platform.init();
  await waitUntil(() => f.count('VKWebAppCheckBannerAd') >= 1, 'initial banner state was not checked');
  const pending = f.platform.rewarded('hints');
  await tick();
  const checks = f.count('VKWebAppCheckBannerAd');
  const bannerShows = f.count('VKWebAppShowBannerAd');
  await delay(45);
  assert.equal(f.count('VKWebAppCheckBannerAd'), checks);
  assert.equal(f.platform.bannerHeight, 48);
  showing.resolve({ result: true });
  assert.equal((await pending).ok, true);
  await waitUntil(() => f.count('VKWebAppCheckBannerAd') > checks, 'banner polling did not resume after reward');
  assert.equal(f.count('VKWebAppShowBannerAd'), bannerShows + 1);
  assert.equal(f.platform.bannerHeight, 48);
});
