// All cues are generated locally: no downloads, tracking or audio autoplay.
let settings = { sound: true, music: false, haptics: true, reducedMotion: false };
let context;
let effectsGain;
let musicGain;
let unlocked = false;
let musicWanted = false;
let musicTimer;
let musicStep = 0;
let musicVoices = [];
const hidden = () => typeof document !== 'undefined' && document.hidden;

function getContext() {
  if (context) return context;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    context = new AudioContextClass();
    effectsGain = context.createGain();
    effectsGain.gain.value = settings.sound ? 0.25 : 0;
    effectsGain.connect(context.destination);
    musicGain = context.createGain();
    musicGain.gain.value = 0.085;
    musicGain.connect(context.destination);
    return context;
  } catch {
    return null;
  }
}

function tone(frequency, offset = 0, duration = 0.12, type = 'sine', volume = 0.4, slideTo = null, isMusic = false) {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime + Math.max(0, offset);
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(Math.max(volume, 0.001), start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(isMusic ? musicGain : effectsGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
  const voice = { oscillator, envelope };
  if (isMusic) musicVoices.push(voice);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
    if (isMusic) musicVoices = musicVoices.filter(item => item !== voice);
  };
}

function stopAmbient() {
  if (musicTimer) globalThis.clearInterval(musicTimer);
  musicTimer = null;
  for (const { oscillator } of musicVoices) {
    try { oscillator.stop(); } catch { /* Already ended. */ }
  }
  musicVoices = [];
}

function ambientTick() {
  if (!context || context.state !== 'running' || hidden()) return;
  // A slow, restrained pentatonic sequence leaves room for game feedback.
  const notes = [261.63, 329.63, 392, 493.88, 440, 392, 329.63, 293.66];
  const note = notes[musicStep % notes.length];
  tone(note, 0, 1.8, 'sine', 0.18, null, true);
  if (musicStep % 4 === 0) tone(note / 2, 0, 2.7, 'sine', 0.2, null, true);
  musicStep += 1;
}

function syncAmbient() {
  if (!musicWanted || !settings.music || !unlocked || hidden() || !context || context.state !== 'running') {
    stopAmbient();
    return;
  }
  if (musicTimer) return;
  ambientTick();
  musicTimer = globalThis.setInterval(ambientTick, 1350);
}

async function unlock() {
  const ctx = getContext();
  if (!ctx) return false;
  unlocked = true;
  try {
    if (ctx.state !== 'running' && ctx.state !== 'closed') await ctx.resume();
    syncAmbient();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

function play(name = 'tap') {
  if (!settings.sound || hidden() || !unlocked || !context || context.state !== 'running') return;
  switch (name) {
    case 'move':
    case 'step':
      tone(220, 0, 0.07, 'sine', 0.23, 320);
      tone(440, 0.025, 0.08, 'sine', 0.09);
      break;
    case 'win':
    case 'complete':
    case 'success':
      [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => tone(note, index * 0.09, 0.45, 'sine', 0.34));
      tone(261.63, 0, 0.7, 'triangle', 0.18);
      break;
    case 'fail':
    case 'error':
    case 'blocked':
    case 'bump':
      tone(150, 0, 0.13, 'triangle', 0.27, 90);
      break;
    case 'coin':
    case 'buy':
    case 'purchase':
      tone(880, 0, 0.16, 'sine', 0.25);
      tone(1318.51, 0.075, 0.24, 'sine', 0.25);
      break;
    case 'hint':
      [523.25, 783.99, 659.25].forEach((note, index) => tone(note, index * 0.075, 0.25, 'sine', 0.22));
      break;
    case 'undo':
    case 'back':
      tone(540, 0, 0.09, 'sine', 0.21, 350);
      break;
    case 'portal':
    case 'switch':
      tone(280, 0, 0.24, 'sine', 0.24, 840);
      tone(420, 0.05, 0.23, 'sine', 0.13, 1260);
      break;
    case 'start':
      tone(392, 0, 0.2, 'sine', 0.23);
      tone(587.33, 0.08, 0.27, 'sine', 0.23);
      break;
    default:
      tone(620, 0, 0.065, 'sine', 0.17, 780);
  }
}

function setSettings(value = {}) {
  for (const key of Object.keys(settings)) {
    if (typeof value[key] === 'boolean') settings[key] = value[key];
  }
  if (context && effectsGain) {
    effectsGain.gain.setTargetAtTime(settings.sound ? 0.25 : 0, context.currentTime, 0.015);
  }
  syncAmbient();
  return { ...settings };
}

function startMusic() {
  musicWanted = true;
  syncAmbient();
}

function stopMusic() {
  musicWanted = false;
  stopAmbient();
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
    if (hidden()) {
      stopAmbient();
      if (context?.state === 'running') {
        context.suspend().then(() => {
          // A very quick return can happen before the suspend promise resolves.
          if (!hidden() && unlocked) context.resume().then(syncAmbient).catch(() => {});
        }).catch(() => {});
      }
    } else if (unlocked && context && context.state !== 'running' && context.state !== 'closed') {
      context.resume().then(syncAmbient).catch(() => {});
    } else {
      syncAmbient();
    }
  });
}

export const audio = { setSettings, unlock, play, startMusic, stopMusic, vibrate };
