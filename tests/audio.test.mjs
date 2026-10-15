import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t, { webAudio = true, play } = {}) {
  const keys = ['Audio', 'AudioContext', 'webkitAudioContext', 'document'];
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const players = [], contexts = [];
  const doc = new EventTarget();
  doc.hidden = false;
  class MockAudio {
    constructor() {
      players.push(this);
      this.paused = true;
      this.currentTime = 0;
      this.playCount = 0;
      this.pauseCount = 0;
    }
    play() {
      this.playCount += 1;
      const result = play?.(this);
      if (result !== undefined) return result;
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.pauseCount += 1; this.paused = true; }
  }
  class MockContext {
    constructor() {
      contexts.push(this);
      this.state = 'suspended';
      this.currentTime = 0;
      this.gains = [];
      this.oscillators = [];
      this.destination = {};
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    createGain() {
      const gain = { gain: {
        value: 0,
        setTargetAtTime(value) { this.value = value; },
        setValueAtTime() {}, exponentialRampToValueAtTime() {},
      }, connect() {}, disconnect() {} };
      this.gains.push(gain);
      return gain;
    }
    createOscillator() {
      const oscillator = { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} };
      this.oscillators.push(oscillator);
      return oscillator;
    }
  }
  for (const [key, value] of Object.entries({ Audio: MockAudio, AudioContext: webAudio ? MockContext : undefined, webkitAudioContext: undefined, document: doc })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { audio } = await import(`../dist/audio.js?audio-test=${++moduleId}`);
  return {
    audio, players, contexts,
    visibility(hidden) { doc.hidden = hidden; doc.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('music stays lazy and disabled until both its setting and a gesture permit it', async t => {
  const { audio, players } = await fixture(t);
  audio.startMusic();
  audio.setSettings({ music: true });
  assert.equal(players.length, 0, 'no download or autoplay before a gesture');
  await audio.unlock();
  const player = players[0];
  assert.equal(players.length, 1);
  assert.match(player.src, /\/assets\/music\.mp3$/);
  assert.equal(player.preload, 'none');
  assert.equal(player.loop, true);
  assert.equal(player.volume, 0.25);
  assert.equal(player.playCount, 1);
  assert.equal(player.paused, false);
});

test('repeated settings and gestures share one soundtrack while effects remain independent', async t => {
  const { audio, players, contexts } = await fixture(t);
  await audio.unlock();
  audio.startMusic();
  assert.equal(players.length, 0, 'music is disabled by default');
  audio.setSettings({ music: true, sound: false });
  await audio.unlock();
  audio.startMusic();
  audio.setSettings({ music: true, sound: false });
  await audio.unlock();
  assert.equal(players.length, 1);
  assert.equal(players[0].playCount, 1);
  audio.play('move');
  assert.equal(contexts[0].oscillators.length, 0);
  audio.setSettings({ music: false, sound: true });
  assert.equal(players[0].paused, true);
  audio.play('move');
  assert.equal(contexts[0].oscillators.length, 2, 'Web Audio effects still work without music');
});

test('music pauses during backgrounding and VK-style ad muting and resumes from the same position', async t => {
  const { audio, players, visibility, contexts } = await fixture(t);
  audio.startMusic();
  audio.setSettings({ music: true });
  await audio.unlock();
  const player = players[0];
  player.currentTime = 42;
  visibility(true);
  assert.equal(player.paused, true);
  assert.equal(contexts[0].state, 'suspended');
  visibility(false);
  await Promise.resolve();
  assert.equal(player.paused, false);
  assert.equal(player.currentTime, 42);
  audio.setSettings({ sound: false, music: false });
  assert.equal(player.paused, true);
  audio.setSettings({ sound: true, music: true });
  await Promise.resolve();
  assert.equal(player.paused, false);
  assert.equal(player.currentTime, 42);
  assert.equal(players.length, 1);
  audio.stopMusic();
  assert.equal(player.paused, true);
  await audio.unlock();
  assert.equal(player.paused, true, 'a gesture does not override stopMusic');
});

test('the MP3 works when Web Audio is unavailable', async t => {
  const { audio, players, visibility } = await fixture(t, { webAudio: false });
  audio.setSettings({ music: true });
  audio.startMusic();
  assert.equal(await audio.unlock(), true);
  assert.equal(players[0].paused, false);
  audio.play('win');
  visibility(true);
  assert.equal(players[0].paused, true);
  visibility(false);
  await Promise.resolve();
  assert.equal(players[0].paused, false);
});

test('blocked playback is caught and retried on a later gesture without duplicate requests', async t => {
  const first = deferred();
  let attempt = 0;
  const { audio, players } = await fixture(t, { play() { if (++attempt === 1) return first.promise; } });
  audio.setSettings({ music: true });
  audio.startMusic();
  await audio.unlock();
  await audio.unlock();
  assert.equal(players[0].playCount, 1, 'one pending request');
  first.reject(new Error('Autoplay blocked'));
  await Promise.resolve();
  assert.equal(players[0].playCount, 1, 'no autoplay retry loop');
  await audio.unlock();
  assert.equal(players[0].playCount, 2);
  assert.equal(players[0].paused, false);
});

test('an old interrupted request cannot interfere with a later successful resume', async t => {
  const first = deferred();
  let attempt = 0;
  const { audio, players } = await fixture(t, { play() { if (++attempt === 1) return first.promise; } });
  audio.setSettings({ music: true });
  audio.startMusic();
  await audio.unlock();
  audio.setSettings({ music: false });
  audio.setSettings({ music: true });
  await Promise.resolve();
  assert.equal(players[0].paused, false);
  first.reject(new Error('Interrupted by pause'));
  await Promise.resolve();
  await audio.unlock();
  assert.equal(players.length, 1);
  assert.equal(players[0].playCount, 2);
  assert.equal(players[0].paused, false);
});
