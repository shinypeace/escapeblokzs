// Locally hosted CC0 samples; the soundtrack starts only after a gesture.
let settings = { sound: true, music: false, haptics: true, reducedMotion: false };
let context;
let effectsGain;
let preloadPending;
let effectsEpoch = 0;
const buffers = new Map();
const loading = new Map();
const voices = [];
const fallbackPools = new Map();
const variants = new Map();
const MAX_VOICES = 8;
export const SFX_SAMPLES = Object.freeze(['roll-a', 'roll-b', 'roll-c', 'tap-a', 'tap-b', 'switch', 'undo', 'hint', 'start', 'fall', 'glass', 'portal', 'win', 'coin', 'reveal', 'reward', 'blocked']);
const EVENTS = {
  move: { samples: ['roll-a', 'roll-b', 'roll-c'], volume: .55 },
  tap: { samples: ['tap-a', 'tap-b'], volume: .28 },
  switch: { samples: ['switch'], volume: .35 },
  undo: { samples: ['undo'], volume: .42 },
  hint: { samples: ['hint'], volume: .36 },
  start: { samples: ['start'], volume: .38 },
  fail: { samples: ['fall'], volume: .48 },
  glass: { samples: ['glass'], volume: .34 },
  portal: { samples: ['portal'], volume: .35 },
  win: { samples: ['win'], volume: .48, melody: true },
  coin: { samples: ['coin'], volume: .42 },
  reveal: { samples: ['reveal'], volume: .44, melody: true },
  reward: { samples: ['reward'], volume: .44, melody: true },
  blocked: { samples: ['blocked'], volume: .3 },
};
const ALIASES = { step: 'move', complete: 'win', success: 'win', error: 'blocked', bump: 'blocked', fall: 'fail', buy: 'coin', purchase: 'coin', back: 'undo', pause: 'tap', equip: 'tap' };
const sampleURL = id => new URL(`./assets/sfx/${id}.wav`, import.meta.url).href;
let unlocked = false;
let musicWanted = false;
let musicPlayer;
let musicRequest = 0;
let musicPending = null;
const hidden = () => typeof document !== 'undefined' && document.hidden;

function getContext() {
  if (context) return context;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    context = new AudioContextClass();
    effectsGain = context.createGain();
    effectsGain.gain.value = settings.sound ? 0.7 : 0;
    if (typeof context.createDynamicsCompressor === 'function') {
      // A conservative final limiter controls rare overlaps of long rewards.
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 3;
      limiter.ratio.value = 20;
      limiter.attack.value = .002;
      limiter.release.value = .12;
      effectsGain.connect(limiter);
      limiter.connect(context.destination);
    } else effectsGain.connect(context.destination);
    return context;
  } catch {
    return null;
  }
}

async function loadSample(id) {
  if (buffers.has(id)) return buffers.get(id);
  if (loading.has(id)) return loading.get(id);
  const ctx = getContext();
  if (!ctx || typeof globalThis.fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') return null;
  const pending = (async () => {
    try {
      const response = await fetch(sampleURL(id));
      if (!response.ok) return null;
      const decoded = await ctx.decodeAudioData(await response.arrayBuffer());
      buffers.set(id, decoded);
      return decoded;
    } catch { return null; }
    finally { loading.delete(id); }
  })();
  loading.set(id, pending);
  return pending;
}

function preload() {
  if (preloadPending) return preloadPending;
  // Suspended contexts can decode ahead of the first interaction. No music
  // download or sound playback happens here.
  preloadPending = Promise.all(SFX_SAMPLES.map(loadSample)).then(results => {
    preloadPending = null;
    return results.filter(Boolean).length;
  });
  return preloadPending;
}

function release(voice) {
  const index = voices.indexOf(voice);
  if (index >= 0) voices.splice(index, 1);
  voice.source?.disconnect();
  voice.gain?.disconnect();
}

function stopVoice(voice) {
  try { voice.source?.stop(); } catch {}
  if (voice.player) { voice.player.pause(); voice.player.currentTime = 0; }
  release(voice);
}

function makeRoom(melody) {
  if (melody) for (const voice of [...voices]) if (voice.melody) stopVoice(voice);
  while (voices.length >= MAX_VOICES) stopVoice(voices[0]);
}

function playBuffer(buffer, event) {
  if (!context || context.state !== 'running') return;
  makeRoom(event.melody);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = event.volume;
  source.connect(gain);
  gain.connect(effectsGain);
  const voice = { source, gain, melody: !!event.melody };
  voices.push(voice);
  source.onended = () => release(voice);
  source.start();
}

function playFallback(id, event) {
  if (typeof globalThis.Audio !== 'function') return;
  const pool = fallbackPools.get(id) || [];
  let player = pool.find(item => item.paused || item.ended);
  if (!player && pool.length < 2) {
    try {
      player = new globalThis.Audio(sampleURL(id));
      player.src = sampleURL(id);
      player.preload = 'auto';
      pool.push(player);
      fallbackPools.set(id, pool);
    } catch { return; }
  }
  if (!player) player = pool[0];
  for (const previous of [...voices]) if (previous.player === player) stopVoice(previous);
  makeRoom(event.melody);
  player.currentTime = 0;
  player.volume = event.volume * .7;
  const voice = { player, melody: !!event.melody };
  voices.push(voice);
  player.onended = () => release(voice);
  try { Promise.resolve(player.play()).catch(() => release(voice)); } catch { release(voice); }
}

function pauseMusic() {
  if (!musicPlayer || (musicPlayer.paused && musicPending === null)) return;
  musicRequest += 1;
  musicPending = null;
  // Preserve currentTime for settings, backgrounding and VK ad interruptions.
  musicPlayer.pause();
}

function syncMusic() {
  if (!musicWanted || !settings.music || !unlocked || hidden()) {
    pauseMusic();
    return;
  }
  if (!musicPlayer) {
    if (typeof globalThis.Audio !== 'function') return;
    try {
      musicPlayer = new globalThis.Audio();
      musicPlayer.preload = 'none';
      musicPlayer.loop = true;
      musicPlayer.volume = 0.25;
      musicPlayer.src = new URL('./assets/music.mp3', import.meta.url).href;
    } catch {
      musicPlayer = null;
      return;
    }
  }
  if (!musicPlayer.paused || musicPending !== null) return;
  const request = ++musicRequest;
  musicPending = request;
  try {
    Promise.resolve(musicPlayer.play()).then(() => {
      if (request !== musicRequest) return;
      musicPending = null;
      if (!musicWanted || !settings.music || hidden()) pauseMusic();
    }, () => {
      // Autoplay policies and interrupted play requests are retried at the next
      // user gesture or settings change, never in a background retry loop.
      if (request === musicRequest) musicPending = null;
    });
  } catch {
    if (request === musicRequest) musicPending = null;
  }
}

async function unlock() {
  unlocked = true;
  // Call play within the gesture, before awaiting the Web Audio resume promise.
  syncMusic();
  const ctx = getContext();
  void preload();
  if (!ctx) return typeof globalThis.Audio === 'function';
  try {
    if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

function play(name = 'tap') {
  if (!settings.sound || hidden() || !unlocked) return;
  const eventName = ALIASES[name] || name;
  const event = EVENTS[eventName] || EVENTS.tap;
  const index = variants.get(eventName) || 0;
  variants.set(eventName, (index + 1) % event.samples.length);
  const id = event.samples[index % event.samples.length];
  if (!getContext()) { playFallback(id, event); return; }
  if (buffers.has(id)) { playBuffer(buffers.get(id), event); return; }
  const requested = Date.now();
  const epoch = effectsEpoch;
  void loadSample(id).then(buffer => {
    // Never replay a stale roll after a slow network load or an ad boundary.
    if (epoch !== effectsEpoch || Date.now() - requested > 250 || !settings.sound || hidden() || !unlocked) return;
    if (buffer) playBuffer(buffer, event);
    else playFallback(id, event);
  });
}

function setSettings(value = {}) {
  for (const key of Object.keys(settings)) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  if (context && effectsGain) {
    effectsGain.gain.setTargetAtTime(settings.sound ? 0.7 : 0, context.currentTime, 0.015);
  }
  if (!settings.sound) { effectsEpoch++; for (const voice of [...voices]) stopVoice(voice); }
  syncMusic();
  return { ...settings };
}

function startMusic() {
  musicWanted = true;
  syncMusic();
}

function stopMusic() {
  musicWanted = false;
  pauseMusic();
}

function vibrate(pattern = 8) {
  if (!settings.haptics || hidden() || typeof navigator === 'undefined' || !navigator.vibrate) return false;
  const clean = Array.isArray(pattern)
    ? pattern.slice(0, 8).map(value => Math.max(0, Math.min(120, Number(value) || 0)))
    : Math.max(0, Math.min(120, Number(pattern) || 0));
  try { return navigator.vibrate(clean); } catch { return false; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    syncMusic();
    if (hidden()) {
      effectsEpoch++;
      for (const voice of [...voices]) stopVoice(voice);
      if (context?.state === 'running') {
        context.suspend().then(() => {
          // A very quick return can happen before the suspend promise resolves.
          if (!hidden() && unlocked) context.resume().catch(() => {});
        }).catch(() => {});
      }
    } else if (unlocked && context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().catch(() => {});
    }
  });
}

export const audio = { setSettings, preload, unlock, play, startMusic, stopMusic, vibrate };
