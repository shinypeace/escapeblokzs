import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

let moduleId = 0;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t, { webAudio = true, play, fetch: fetchOverride } = {}) {
  const keys = ['Audio', 'AudioContext', 'webkitAudioContext', 'document', 'fetch'];
  const descriptors = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const players = [], contexts = [], requests = [];
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
      this.sources = [];
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
    async decodeAudioData(bytes) { return { duration: .25, bytes }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      this.sources.push(source);
      return source;
    }
  }
  const fetch = async url => {
    requests.push(url);
    return fetchOverride ? fetchOverride(url) : { ok: true, async arrayBuffer() { return new ArrayBuffer(8); } };
  };
  for (const [key, value] of Object.entries({ Audio: MockAudio, AudioContext: webAudio ? MockContext : undefined, webkitAudioContext: undefined, document: doc, fetch })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { audio } = await import(`../dist/audio.js?audio-test=${++moduleId}`);
  return {
    audio, players, contexts, requests,
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
  assert.equal(contexts[0].sources.length, 0);
  audio.setSettings({ music: false, sound: true });
  assert.equal(players[0].paused, true);
  await audio.preload();
  audio.play('move');
  assert.equal(contexts[0].sources.length, 1, 'sample effects still work without music');
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

test('all sample buffers preload once while suspended without downloading music or autoplaying', async t => {
  const { audio, requests, contexts, players } = await fixture(t);
  const first = audio.preload();
  assert.equal(audio.preload(), first, 'concurrent callers share one load');
  assert.equal(await first, 17);
  assert.equal(await audio.preload(), 17);
  assert.equal(requests.length, 17, 'already decoded samples are reused');
  assert.equal(new Set(requests).size, 17);
  assert.ok(requests.every(url => /\/assets\/sfx\/[^/]+\.wav$/.test(url)));
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(players.length, 0);
});

test('sample variations do not repeat consecutively and bursts stay within eight effect voices', async t => {
  const { audio, contexts } = await fixture(t);
  await audio.preload();
  await audio.unlock();
  const ctx = contexts[0];
  for (let i = 0; i < 18; i++) audio.play('move');
  assert.equal(ctx.sources.length, 18);
  assert.notEqual(ctx.sources[0].buffer, ctx.sources[1].buffer);
  assert.notEqual(ctx.sources[1].buffer, ctx.sources[2].buffer);
  assert.equal(ctx.sources[0].buffer, ctx.sources[3].buffer);
  assert.equal(ctx.sources.filter(source => !source.stopped).length, 8);
  audio.play('win');
  const firstMelody = ctx.sources.at(-1);
  audio.play('reward');
  assert.equal(firstMelody.stopped, true, 'a reward replaces the previous melody');
  assert.equal(ctx.sources.filter(source => !source.stopped).length, 8);
});

test('muting for ads or backgrounding stops every active effect and prevents a late decoded effect', async t => {
  const { audio, contexts, visibility } = await fixture(t);
  await audio.preload();
  await audio.unlock();
  for (const name of ['tap', 'move', 'hint', 'coin', 'glass']) audio.play(name);
  const ctx = contexts[0];
  assert.equal(ctx.sources.length, 5);
  audio.setSettings({ sound: false });
  assert.ok(ctx.sources.every(source => source.stopped));
  audio.play('win');
  assert.equal(ctx.sources.length, 5);
  audio.setSettings({ sound: true });
  audio.play('portal');
  visibility(true);
  assert.equal(ctx.sources.at(-1).stopped, true);
  audio.play('switch');
  assert.equal(ctx.sources.length, 6);
});

test('a pending sample cannot resume across an advertisement mute boundary', async t => {
  const pending = deferred();
  const { audio, contexts } = await fixture(t, { fetch: () => pending.promise });
  await audio.unlock();
  audio.play('move');
  audio.setSettings({ sound: false });
  audio.setSettings({ sound: true });
  pending.resolve({ ok: true, async arrayBuffer() { return new ArrayBuffer(8); } });
  await audio.preload();
  await Promise.resolve();
  assert.equal(contexts[0].sources.length, 0, 'the old roll stays cancelled even after sound resumes');
  audio.play('move');
  assert.equal(contexts[0].sources.length, 1);
});

test('sample fallback works without Web Audio and respects sound and background muting', async t => {
  const { audio, players, visibility } = await fixture(t, { webAudio: false });
  await audio.unlock();
  audio.play('tap');
  assert.equal(players.length, 1);
  assert.match(players[0].src, /\/assets\/sfx\/tap-a\.wav$/);
  assert.equal(players[0].paused, false);
  audio.setSettings({ sound: false });
  assert.equal(players[0].paused, true);
  audio.play('move');
  assert.equal(players.length, 1);
  audio.setSettings({ sound: true });
  audio.play('hint');
  assert.equal(players.length, 2);
  visibility(true);
  assert.equal(players[1].paused, true);
});

test('every shipped effect is a licensed, distinct mono WAV with clean headroom and matching provenance', () => {
  const base = new URL('../dist/assets/sfx/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', base), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.samples.length, 17);
  const hashes = new Set();
  for (const sample of manifest.samples) {
    const wav = fs.readFileSync(new URL(sample.file, base));
    assert.equal(createHash('sha256').update(wav).digest('hex'), sample.sha256, sample.id);
    assert.ok(!hashes.has(sample.sha256), `${sample.id}: distinct recorded sample`);
    hashes.add(sample.sha256);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM');
    assert.equal(wav.readUInt16LE(22), 1, 'mono');
    assert.equal(wav.readUInt32LE(24), 32000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
    assert.ok(peak > 100 && peak <= 23167, `${sample.id}: audible, at least 3dB headroom`);
    assert.equal(wav.readInt16LE(44), 0, `${sample.id}: click-free start`);
    assert.equal(wav.readInt16LE(wav.length - 2), 0, `${sample.id}: click-free end`);
    assert.match(fs.readFileSync(new URL(`LICENSE-${sample.pack}.txt`, base), 'utf8'), /CC0/);
  }
});
