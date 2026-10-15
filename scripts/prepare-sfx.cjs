/** Build universal mono PCM samples from Kenney's downloaded CC0 recordings.
 * Usage: node scripts/prepare-sfx.cjs [path-to-playwright-node-modules]
 * Source archives are local authoring inputs, never fetched by the game. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(path.join(process.argv[2] || 'C:/Users/pavel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', 'playwright'));
const sources = [
  ['roll-a', 'impact', 'impactWood_light_000.ogg'],
  ['roll-b', 'impact', 'impactWood_light_001.ogg'],
  ['roll-c', 'impact', 'impactWood_light_002.ogg'],
  ['tap-a', 'interface', 'click_003.ogg'],
  ['tap-b', 'interface', 'click_004.ogg'],
  ['switch', 'interface', 'switch_003.ogg'],
  ['undo', 'interface', 'back_002.ogg'],
  ['hint', 'interface', 'question_003.ogg'],
  ['start', 'interface', 'open_002.ogg'],
  ['fall', 'impact', 'impactWood_heavy_002.ogg'],
  ['glass', 'impact', 'impactGlass_medium_001.ogg'],
  ['portal', 'interface', 'drop_004.ogg'],
  ['win', 'jingles', 'Pizzicato jingles/jingles_PIZZI07.ogg'],
  ['coin', 'interface', 'glass_003.ogg'],
  ['reveal', 'jingles', 'Pizzicato jingles/jingles_PIZZI02.ogg'],
  ['reward', 'jingles', 'Pizzicato jingles/jingles_PIZZI06.ogg'],
  ['blocked', 'interface', 'error_001.ogg'],
];
const output = path.resolve('dist/assets/sfx');
const urls = { impact: 'https://kenney.nl/assets/impact-sounds', interface: 'https://kenney.nl/assets/interface-sounds', jingles: 'https://kenney.nl/assets/music-jingles' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function wave(samples, sampleRate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2));
  return bytes;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  const manifest = { creator: 'Kenney', license: 'CC0-1.0', sampleRate: 32000, channels: 1, format: 'PCM 16-bit WAV', processing: 'decode, mono downmix, trim silence, gentle 2ms/8ms fades, peak normalize -3dBFS, 32kHz resample', samples: [] };
  try {
    for (const [id, pack, original] of sources) {
      const input = fs.readFileSync(path.join('tmp/audio-source', pack, 'Audio', original));
      const decoded = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const ctx = new AudioContext({ sampleRate: 32000 });
        try {
          const buffer = await ctx.decodeAudioData(bytes.buffer);
          const mono = new Float32Array(buffer.length);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let i = 0; i < samples.length; i++) mono[i] += samples[i] / buffer.numberOfChannels;
          }
          return { samples: Array.from(mono), rate: buffer.sampleRate };
        } finally { await ctx.close(); }
      }, input.toString('base64'));
      let samples = decoded.samples;
      let first = samples.findIndex(value => Math.abs(value) > 0.0008);
      let last = samples.length - 1;
      while (last > first && Math.abs(samples[last]) < 0.0008) last--;
      first = Math.max(0, first - Math.round(decoded.rate * 0.004));
      last = Math.min(samples.length, last + Math.round(decoded.rate * 0.02));
      samples = samples.slice(first, last);
      const attack = Math.round(decoded.rate * 0.002), release = Math.round(decoded.rate * 0.008);
      samples = samples.map((value, i) => value * Math.min(1, i / attack, (samples.length - 1 - i) / release));
      const peak = samples.reduce((n, value) => Math.max(n, Math.abs(value)), 0);
      const normalization = peak > 0 ? 0.707 / peak : 1;
      samples = samples.map(value => value * normalization);
      const wav = wave(samples, decoded.rate);
      fs.writeFileSync(path.join(output, `${id}.wav`), wav);
      manifest.samples.push({ id, file: `${id}.wav`, pack, original, sourceUrl: urls[pack], sourceSha256: hash(input), sha256: hash(wav), bytes: wav.length, seconds: +(samples.length / decoded.rate).toFixed(4), peakDbfs: -3.01 });
    }
    for (const pack of Object.keys(urls)) fs.copyFileSync(path.join('tmp/audio-source', pack, 'License.txt'), path.join(output, `LICENSE-${pack}.txt`));
    fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.table(manifest.samples.map(({ id, seconds, bytes }) => ({ id, seconds, bytes })));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
