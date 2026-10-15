// VK Mini Apps adapter. The pinned official SDK is loaded only inside VK.
// Never put application secrets or access tokens in this client-side module.
const STORAGE_CHUNK = 2800;
const MAX_SAVE_BYTES = 512 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_SAVE_BYTES * 4 / 3 / STORAGE_CHUNK) + 1;
const AD_INTERVAL = 90_000;
export const VK_APP_ID = 54824611;

function validJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch { return false; }
}

function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

function encode(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_SAVE_BYTES) throw new Error('VK save is too large');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { text: btoa(binary), bytes: bytes.length };
}

function decode(text) {
  const binary = atob(text);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

function vkCandidate(env, appId) {
  const win = env.window;
  if (!win) return false;
  const native = Boolean(win.AndroidBridge || win.webkit?.messageHandlers?.VKWebAppInit || win.ReactNativeWebView?.postMessage);
  const params = new URLSearchParams(env.location?.search || '');
  const launch = params.get('vk_app_id') === String(appId) && Boolean(params.get('vk_platform'));
  return launch && (native || win.parent !== win);
}

/** Dependency injection keeps platform behavior verifiable without a VK account. */
export function createVKPlatform(options = {}) {
  const env = options.env || globalThis;
  const clock = options.now || Date.now;
  const later = options.setTimeout || globalThis.setTimeout;
  const cancel = options.clearTimeout || globalThis.clearTimeout;
  const requestTimeout = options.requestTimeout ?? 7000;
  const loadBridge = options.loadBridge || (() => import('./vendor/vk-bridge-3.0.2.js').then(module => module.default));
  const listeners = { pause: new Set(), resume: new Set(), banner: new Set(), account: new Set() };
  const pauses = new Set();
  let bridge, initialization, cloudLoading, saveTimer, writeTask, bannerTask;
  let isVK = false, userId = null, bannerHeight = 0, isAdOpen = false;
  let cloudReady = false, storageSupported = false, accountChanged = false;
  let committedSlot = 'b', pendingSave = null, lastSaved = null;
  let completedRounds = 0, lastAdAt = clock(), adBoundary = false;

  function notify(kind, value) {
    for (const callback of listeners[kind]) {
      try { callback(value); } catch { /* A UI callback must not break the SDK. */ }
    }
  }
  function subscribe(kind, callback) {
    listeners[kind].add(callback);
    if (kind === 'banner') callback(bannerHeight);
    return () => listeners[kind].delete(callback);
  }
  function pause(reason) {
    const wasPaused = pauses.size > 0;
    pauses.add(reason);
    if (!wasPaused) notify('pause', reason);
  }
  function resume(reason) {
    const wasPaused = pauses.size > 0;
    pauses.delete(reason);
    if (wasPaused && !pauses.size) notify('resume', reason);
  }
  function bounded(promise, milliseconds = requestTimeout) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = later(() => reject(new Error('VK request timed out')), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => cancel(timer));
  }
  function send(method, parameters = {}) {
    return bounded(Promise.resolve().then(() => bridge.send(method, parameters)));
  }
  async function supports(method) {
    try { return typeof bridge.supportsAsync === 'function' && Boolean(await bounded(bridge.supportsAsync(method))); }
    catch { return false; }
  }
  function updateBanner(data = {}, hidden = false) {
    // Overlay banners cover the webview. Resize banners already reduce its size.
    const height = !hidden && data.result !== false && data.layout_type !== 'resize' && data.banner_location !== 'top'
      ? Math.max(0, Math.min(240, Number(data.banner_height) || 0)) : 0;
    if (height !== bannerHeight) { bannerHeight = height; notify('banner', height); }
  }
  function ensureBanner() {
    if (!isVK || bannerTask) return bannerTask || Promise.resolve(false);
    bannerTask = (async () => {
      if (!await supports('VKWebAppShowBannerAd')) return false;
      try {
        const data = await send('VKWebAppShowBannerAd', {
          banner_location: 'bottom', banner_align: 'center', layout_type: 'overlay',
          height_type: 'compact', orientation: 'horizontal', can_close: false,
        });
        updateBanner(data);
        return data.result === true;
      } catch { updateBanner({}, true); return false; }
    })().finally(() => { bannerTask = null; });
    return bannerTask;
  }
  async function verifyAccount() {
    if (!isVK || accountChanged) return false;
    try {
      const user = await send('VKWebAppGetUserInfo');
      if (!Number.isSafeInteger(user.id) || user.id <= 0) return false;
      if (user.id !== userId) {
        accountChanged = true;
        cloudReady = false;
        pendingSave = null;
        cancel(saveTimer);
        notify('account', user.id);
        return false;
      }
      return true;
    } catch { return false; }
  }
  async function restored() {
    await verifyAccount();
    void ensureBanner();
    resume('client');
  }
  function bridgeEvent(event) {
    const { type, data = {} } = event?.detail || {};
    if (type === 'VKWebAppViewHide') { pause('client'); void flushSave(); }
    if (type === 'VKWebAppViewRestore') void restored();
    if (type === 'VKWebAppBannerAdUpdated' || type === 'VKWebAppShowBannerAdResult') updateBanner(data);
    if (type === 'VKWebAppBannerAdClosedByUser' || type === 'VKWebAppHideBannerAdResult') updateBanner({}, true);
  }
  function status() { return { isVK, userId, bannerHeight }; }

  function init() {
    if (initialization) return initialization;
    initialization = (async () => {
      env.document?.addEventListener?.('visibilitychange', () => {
        if (env.document.hidden) { pause('document'); void flushSave(); }
        else resume('document');
      });
      env.window?.addEventListener?.('pagehide', () => { void flushSave(); });
      if (!vkCandidate(env, options.appId ?? VK_APP_ID)) return status();
      try {
        bridge = await loadBridge();
        bridge.subscribe(bridgeEvent);
        const initialized = await send('VKWebAppInit');
        if (initialized?.result === false) return status();
        // Launch parameters are hints, never an account identity or authentication.
        const user = await send('VKWebAppGetUserInfo');
        if (!Number.isSafeInteger(user?.id) || user.id <= 0) return status();
        userId = user.id;
        isVK = true;
        lastAdAt = clock();
        storageSupported = (await supports('VKWebAppStorageGet')) && (await supports('VKWebAppStorageSet'));
        // Native swipe-back would otherwise steal horizontal puzzle gestures.
        if (await supports('VKWebAppDisableSwipeBack')) void send('VKWebAppDisableSwipeBack').catch(() => {});
        // Banner availability must not hold the menu or account save behind an ad request.
        // The UI receives its actual inset through onBannerChange when the client responds.
        void ensureBanner();
      } catch { /* A normal web launch or unavailable VK must remain playable. */ }
      return status();
    })();
    return initialization;
  }

  function key(suffix) { return `kubohod_v2_${userId}_${suffix}`; }
  async function getValues(keys) {
    const response = await send('VKWebAppStorageGet', { keys });
    if (!Array.isArray(response?.keys)) throw new Error('Invalid VK storage response');
    const values = new Map();
    for (const item of response.keys) {
      if (typeof item?.key === 'string' && typeof item.value === 'string') values.set(item.key, item.value);
    }
    return values;
  }
  async function setValue(storageKey, value) {
    const response = await send('VKWebAppStorageSet', { key: storageKey, value });
    if (response?.result !== true) throw new Error('VK storage write failed');
  }
  function loadSave() {
    if (cloudLoading) return cloudLoading;
    cloudLoading = (async () => {
      await init();
      if (!isVK || !storageSupported || accountChanged) return null;
      try {
        const values = await getValues([key('head')]);
        const head = values.get(key('head'));
        if (!head) { cloudReady = true; return null; }
        const manifest = JSON.parse(head);
        if (manifest?.v !== 1 || !['a', 'b'].includes(manifest.slot) || !Number.isInteger(manifest.count)
          || manifest.count < 1 || manifest.count > MAX_CHUNKS || !Number.isInteger(manifest.bytes)
          || manifest.bytes < 2 || manifest.bytes > MAX_SAVE_BYTES || typeof manifest.hash !== 'string') {
          throw new Error('Invalid VK save manifest');
        }
        let encoded = '';
        for (let offset = 0; offset < manifest.count; offset += 32) {
          const keys = Array.from({ length: Math.min(32, manifest.count - offset) }, (_, index) => key(`${manifest.slot}_${offset + index}`));
          const chunks = await getValues(keys);
          for (const chunkKey of keys) {
            const chunk = chunks.get(chunkKey);
            if (!chunk || chunk.length > STORAGE_CHUNK) throw new Error('Incomplete VK save');
            encoded += chunk;
          }
        }
        const text = decode(encoded);
        if (!validJSON(text) || new TextEncoder().encode(text).length !== manifest.bytes || checksum(text) !== manifest.hash) {
          throw new Error('Damaged VK save');
        }
        committedSlot = manifest.slot;
        lastSaved = text;
        cloudReady = true;
        return text;
      } catch {
        // Reading failure is not an empty save. Do not overwrite unread cloud data.
        cloudReady = false;
        return null;
      }
    })().finally(() => { cloudLoading = null; });
    return cloudLoading;
  }
  function queueSave(text) {
    // The caller must load and merge first. Premature local snapshots are discarded.
    if (!cloudReady || !isVK || accountChanged || !validJSON(text)) return false;
    if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES) return false;
    if (text === lastSaved && !writeTask) {
      pendingSave = null;
      cancel(saveTimer);
      return false;
    }
    pendingSave = text;
    cancel(saveTimer);
    saveTimer = later(() => { void flushSave(); }, options.saveDebounce ?? 1200);
    return true;
  }
  function flushSave() {
    cancel(saveTimer);
    if (writeTask) return writeTask;
    if (!isVK || !cloudReady || accountChanged || !pendingSave) return Promise.resolve(false);
    writeTask = (async () => {
      let wrote = false;
      while (pendingSave && cloudReady && !accountChanged) {
        if (!await verifyAccount()) return wrote;
        const text = pendingSave;
        pendingSave = null;
        if (text === lastSaved) continue;
        try {
          const encoded = encode(text);
          const slot = committedSlot === 'a' ? 'b' : 'a';
          const count = Math.ceil(encoded.text.length / STORAGE_CHUNK);
          for (let index = 0; index < count; index++) {
            if (accountChanged) return wrote;
            await setValue(key(`${slot}_${index}`), encoded.text.slice(index * STORAGE_CHUNK, (index + 1) * STORAGE_CHUNK));
          }
          // Publish only after every chunk succeeds; an interrupted write keeps the previous bank valid.
          if (accountChanged) return wrote;
          await setValue(key('head'), JSON.stringify({ v: 1, slot, count, bytes: encoded.bytes, hash: checksum(text) }));
          committedSlot = slot;
          lastSaved = text;
          wrote = true;
        } catch {
          if (!pendingSave) pendingSave = text;
          return wrote; // Retry on the next save/lifecycle flush, never a tight loop.
        }
      }
      return wrote;
    })().finally(() => { writeTask = null; });
    return writeTask;
  }

  async function afterRound(outcome) {
    if (!['win', 'loss'].includes(outcome) || !isVK || adBoundary || accountChanged) return false;
    completedRounds++;
    if (completedRounds < 3 || clock() - lastAdAt < AD_INTERVAL || pauses.size) return false;
    adBoundary = true;
    try {
      if (!await supports('VKWebAppCheckNativeAds') || !await supports('VKWebAppShowNativeAds')) return false;
      const available = await send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' });
      if (available?.result !== true || pauses.size || accountChanged) return false;
      // This is the only fullscreen ad call site. Caller awaits it at a completed round boundary.
      isAdOpen = true;
      lastAdAt = clock();
      completedRounds = 0;
      pause('ad');
      void flushSave();
      // SDK resolves on close/cancel. Keeping this lock until it settles prevents play under an ad.
      const result = await bridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' });
      return result?.result === true;
    } catch { return false; }
    finally {
      if (isAdOpen) {
        isAdOpen = false;
        resume('ad');
        void ensureBanner();
      }
      adBoundary = false;
    }
  }

  return {
    init, loadSave, queueSave, flushSave, afterRound,
    get isVK() { return isVK; },
    get userId() { return userId; },
    get isAdOpen() { return isAdOpen; },
    get cloudReady() { return cloudReady; },
    get bannerHeight() { return bannerHeight; },
    onPause: callback => subscribe('pause', callback),
    onResume: callback => subscribe('resume', callback),
    onBannerChange: callback => subscribe('banner', callback),
    onAccountChange: callback => subscribe('account', callback),
  };
}

export const platform = createVKPlatform();
