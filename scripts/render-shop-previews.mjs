/** Render shop thumbnails using exactly the in-game block mesh and textures. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = process.env.CODEX_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_NODE_MODULES, 'package.json'))
  : createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const base = process.env.PREVIEW_BASE_URL || 'http://127.0.0.1:4173';
const out = path.join(root, 'dist/assets/ui');
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, channel:process.env.PREVIEW_BROWSER_CHANNEL || 'chrome'});
try {
  const page = await browser.newPage();
  await page.goto(base);
  const previews = await page.evaluate(async () => {
    const { Renderer } = await import('./renderer.js');
    const skins = ['classic','mint','coral','lilac','midnight','honey'];
    const textures = {};
    await Promise.all(skins.filter(id=>id!=='classic').map(async id=>{
      const image = new Image();
      image.src = `./assets/${id}.png`;
      await image.decode();
      textures[id] = image;
    }));
    const result = {};
    for (const skin of skins) {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 720;
      const ctx = canvas.getContext('2d', {alpha:true});
      ctx.scale(2,2);
      // Contact shadow belongs to the item, with no pedestal or baked backdrop.
      ctx.save();ctx.translate(200,321);ctx.scale(1,.24);ctx.shadowColor='rgba(12,26,51,.28)';ctx.shadowBlur=22;
      ctx.fillStyle='rgba(12,26,51,.18)';ctx.beginPath();ctx.ellipse(0,0,67,35,0,0,Math.PI*2);ctx.fill();ctx.restore();
      const renderer = Object.create(Renderer.prototype);
      renderer.canvas = canvas;renderer.ctx = ctx;renderer.skin=skin;renderer.textures=textures;
      renderer.camera = {scale:96,x:179.36,y:178.48};
      renderer.drawBlock({x:0,y:0,o:0});
      result[skin] = canvas.toDataURL('image/png').split(',')[1];
    }
    return result;
  });
  for (const [id, png] of Object.entries(previews)) {
    const rendered = sharp(Buffer.from(png,'base64')).resize(400,360,{kernel:'lanczos3'});
    await rendered.clone().png().toFile(path.join(out, `skin-${id}.png`));
    await rendered.clone().webp({quality:92,alphaQuality:100,effort:6}).toFile(path.join(out, `skin-${id}.webp`));
  }
  console.log(`Rendered ${Object.keys(previews).length} shop thumbnails into ${out}`);
} finally { await browser.close(); }
