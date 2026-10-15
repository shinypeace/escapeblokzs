"""Export generated original backgrounds; preserve source provenance."""
from pathlib import Path
from PIL import Image, ImageOps
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(r'C:\Users\pavel\.codex\generated_images\01a141b3-bc37-7f02-89dc-422d73a58ff8')
ASSETS = ROOT / 'dist' / 'assets'
FILES = {
    'aurora': ('exec-c2838250-12f2-4cbd-83c1-ca2b92c61517.png', '#0b5960', '#082b40'),
    'nebula': ('exec-52e78728-08a2-4c02-8c45-c92d19428246.png', '#292265', '#090d30'),
    'ember': ('exec-89ac2c7d-3c9a-4cce-80c9-73012799fbd8.png', '#713d3a', '#302133'),
}
prompts = {
    'aurora': 'Portrait premium minimalist puzzle-game backdrop: teal aurora borealis ribbons at edges, quiet deep teal center, smooth cinematic color, no objects, no text.',
    'nebula': 'Portrait premium minimalist puzzle-game backdrop: deep indigo, violet and cobalt nebular wisps at edges, sparse distant stars, quiet center, no objects, no text.',
    'ember': 'Portrait premium minimalist puzzle-game backdrop: warm smoked burgundy, amber mist at corners, muted terracotta-plum center, subtle sparks, no flames, objects or text.',
}
manifest = {'generator': 'OpenAI built-in image_gen', 'date': '2026-10-16', 'processing': 'Lanczos resize only, 768x1152 WebP quality 86', 'assets': {}}
for name, (filename, top, bottom) in FILES.items():
    source = SOURCE / filename
    image = Image.open(source).convert('RGB')
    image = ImageOps.fit(image, (768,1152), method=Image.Resampling.LANCZOS)
    output = ASSETS / f'{name}.webp'
    image.save(output, 'WEBP', quality=86, method=6)
    manifest['assets'][name] = {'file': output.name, 'prompt': prompts[name], 'size': image.size, 'bytes': output.stat().st_size, 'top':top, 'bottom':bottom}
textures = {
    'lilac': ('exec-3db7a0f2-6162-4fe0-9e81-fbabeec7e4cd.png', 'White marble with broad lavender-gray mineral veins, natural polished stone, seamless orthographic albedo, no directional lighting, objects or text.'),
    'midnight': ('exec-2906cae1-a1be-4b1d-a307-42a201821750.png', 'Rich deep-indigo galaxy with violet and electric-blue nebula and bright tiny stars, clearly legible at small game-block size, edge-to-edge albedo texture, no planets, objects or text.'),
    'honey': ('exec-c261336e-a83a-43c2-b8d9-dc8ea445a91a.png', 'Natural walnut wood grain, chestnut and golden-brown long flowing growth rings and dark pores, subtle knot, vertical grain, even-lit orthographic albedo texture, no objects or text.'),
}
for name, (filename, prompt) in textures.items():
    output = ASSETS / f'{name}.png'
    ImageOps.fit(Image.open(SOURCE / filename).convert('RGB'), (256,256), method=Image.Resampling.LANCZOS).save(output, optimize=True)
    manifest['assets'][name] = {'file':output.name, 'prompt':prompt, 'size':[256,256], 'bytes':output.stat().st_size, 'processing':'Lanczos resize only'}
output = ASSETS / 'ui' / 'mystery.webp'
ImageOps.contain(Image.open(SOURCE / 'exec-d16a6dec-34fb-426a-85a1-602152c0d53b.png').convert('RGBA'), (400,360), method=Image.Resampling.LANCZOS).save(output, 'WEBP', quality=91, alpha_quality=100, method=6)
manifest['assets']['mystery'] = {'file':'ui/mystery.webp','prompt':'Isolated midnight-cobalt ceramic secret treasure capsule with gold band and clasp, premium isometric 3D product render, transparent background, no text or revealed item.', 'size':Image.open(output).size,'bytes':output.stat().st_size}
(ASSETS / 'cosmetic-provenance.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

# The user requested replacing only the local advertising banner. Keep the
# previous copy and generated master so the change remains reversible.
promo = ROOT / 'preview-materials'
old = promo / 'banner-1120x630.png'
archive = promo / 'originals' / 'banner-before-no-count-1120x630.png'
if not archive.exists(): shutil.copy2(old, archive)
source = SOURCE / 'exec-4165de63-7345-410c-9355-8ef1afa329c5.png'
master = promo / 'originals' / 'banner-no-count-original.png'
shutil.copy2(source, master)
ImageOps.fit(Image.open(master).convert('RGB'), (1120,630), method=Image.Resampling.LANCZOS).save(old, optimize=True)
provenance = json.loads((promo / 'provenance.json').read_text(encoding='utf-8'))
provenance['assets']['banner'].update({'original':'originals/banner-no-count-original.png','updated':'2026-10-16','sourceSize':Image.open(master).size,'edit':'Removed level-count copy, retained only the game title using built-in image_gen'})
(promo / 'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
prompt_file = promo / 'prompts.json'
prompt_data = json.loads(prompt_file.read_text(encoding='utf-8'))
prompt_data['bannerEdit20261016'] = "Use case: precise-object-edit. Remove only the lines '120 уровней' and 'для твоей логики'. Keep exact title КУБОХОД, blue background, yellow 1x1x2 cuboid, white ceramic platform, goal hole, geometry, composition and lighting unchanged. Reconstruct continuous blue background. No new text or watermark."
prompt_file.write_text(json.dumps(prompt_data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest,ensure_ascii=False,indent=2))
