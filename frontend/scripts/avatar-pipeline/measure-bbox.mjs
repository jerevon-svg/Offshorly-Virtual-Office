import sharp from 'sharp';
import path from 'node:path';

async function bboxOf(file) {
  const img = sharp(file).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const ALPHA_THRESH = 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const a = data[idx + 3];
      if (a > ALPHA_THRESH) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) return { file: path.basename(file), empty: true, width, height };
  return {
    file: path.basename(file),
    width, height,
    bboxHeight: maxY - minY + 1,
    bboxWidth: maxX - minX + 1,
    top: minY, bottom: maxY,
    fillPct: ((maxY - minY + 1) / height * 100).toFixed(1),
  };
}

const files = process.argv.slice(2);
for (const f of files) {
  const r = await bboxOf(f);
  console.log(JSON.stringify(r));
}
