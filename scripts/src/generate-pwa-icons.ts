import sharp from "sharp";
import path from "path";

const outDir = path.resolve(process.cwd(), "artifacts/localmodel-studio/public");

const svg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f1a"/>
      <stop offset="100%" stop-color="#1a1530"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="60%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- soft glow blob -->
  <circle cx="180" cy="180" r="120" fill="#8b5cf6" opacity="0.35" filter="url(#glow)"/>
  <circle cx="360" cy="340" r="140" fill="#22d3ee" opacity="0.30" filter="url(#glow)"/>
  <!-- chip / node motif -->
  <g stroke="url(#accent)" stroke-width="14" fill="none" stroke-linecap="round">
    <rect x="156" y="156" width="200" height="200" rx="32"/>
    <line x1="100" y1="206" x2="156" y2="206"/>
    <line x1="100" y1="256" x2="156" y2="256"/>
    <line x1="100" y1="306" x2="156" y2="306"/>
    <line x1="356" y1="206" x2="412" y2="206"/>
    <line x1="356" y1="256" x2="412" y2="256"/>
    <line x1="356" y1="306" x2="412" y2="306"/>
    <line x1="206" y1="100" x2="206" y2="156"/>
    <line x1="256" y1="100" x2="256" y2="156"/>
    <line x1="306" y1="100" x2="306" y2="156"/>
    <line x1="206" y1="356" x2="206" y2="412"/>
    <line x1="256" y1="356" x2="256" y2="412"/>
    <line x1="306" y1="356" x2="306" y2="412"/>
  </g>
  <!-- inner dot grid suggesting tokens -->
  <g fill="url(#accent)">
    <circle cx="206" cy="220" r="10"/>
    <circle cx="256" cy="220" r="10"/>
    <circle cx="306" cy="220" r="10"/>
    <circle cx="206" cy="256" r="10"/>
    <circle cx="256" cy="256" r="14"/>
    <circle cx="306" cy="256" r="10"/>
    <circle cx="206" cy="292" r="10"/>
    <circle cx="256" cy="292" r="10"/>
    <circle cx="306" cy="292" r="10"/>
  </g>
</svg>`;

async function main() {
  const sizes = [192, 512];
  for (const s of sizes) {
    const buf = Buffer.from(svg(s));
    await sharp(buf).resize(s, s).png().toFile(path.join(outDir, `pwa-${s}.png`));
    console.log(`wrote pwa-${s}.png`);
  }
  // Apple touch icon
  await sharp(Buffer.from(svg(180))).resize(180, 180).png().toFile(path.join(outDir, "apple-touch-icon.png"));
  console.log("wrote apple-touch-icon.png");
  // Maskable icon (padded)
  const maskableSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0b0f1a"/>
        <stop offset="100%" stop-color="#1a1530"/>
      </linearGradient>
      <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#8b5cf6"/>
        <stop offset="60%" stop-color="#22d3ee"/>
        <stop offset="100%" stop-color="#10b981"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)"/>
    <g transform="translate(96 96) scale(0.625)" stroke="url(#accent)" stroke-width="22" fill="none" stroke-linecap="round">
      <rect x="156" y="156" width="200" height="200" rx="40"/>
    </g>
    <g transform="translate(96 96) scale(0.625)" fill="url(#accent)">
      <circle cx="206" cy="220" r="14"/>
      <circle cx="256" cy="220" r="14"/>
      <circle cx="306" cy="220" r="14"/>
      <circle cx="206" cy="256" r="14"/>
      <circle cx="256" cy="256" r="20"/>
      <circle cx="306" cy="256" r="14"/>
      <circle cx="206" cy="292" r="14"/>
      <circle cx="256" cy="292" r="14"/>
      <circle cx="306" cy="292" r="14"/>
    </g>
  </svg>`;
  await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile(path.join(outDir, "pwa-512-maskable.png"));
  console.log("wrote pwa-512-maskable.png");
  // favicon.svg
  const fs = await import("fs/promises");
  await fs.writeFile(path.join(outDir, "favicon.svg"), svg(512).trim());
  console.log("wrote favicon.svg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
