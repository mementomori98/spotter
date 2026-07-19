// Generates PWA icons from an inline SVG. Run: pnpm --filter @spots/app icons
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static/icons');
mkdirSync(outDir, { recursive: true });

// Simple mushroom + pin glyph on green.
const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#2e7d32"/>
  <g transform="translate(256 ${pad ? 268 : 260}) scale(${pad ? 0.72 : 0.88})">
    <!-- stem -->
    <path d="M -52 30 Q -46 130 -34 150 Q 0 172 34 150 Q 46 130 52 30 Z" fill="#f3e9d6"/>
    <!-- cap -->
    <path d="M -150 34 Q -150 -150 0 -150 Q 150 -150 150 34 Q 60 62 0 62 Q -60 62 -150 34 Z" fill="#c62828"/>
    <circle cx="-72" cy="-52" r="26" fill="#ffffff" opacity="0.92"/>
    <circle cx="34" cy="-92" r="20" fill="#ffffff" opacity="0.92"/>
    <circle cx="82" cy="-22" r="16" fill="#ffffff" opacity="0.92"/>
  </g>
</svg>`;

for (const [file, size, pad] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true]
]) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(path.join(outDir, file));
  console.log('wrote', file);
}
