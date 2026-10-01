/**
 * Draws the app's icon, a barbell in the app's accent colour, and writes it into public/ in the
 * sizes phones ask for: `npm run icons -w @gymlog/client` after changing it here.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

/** The accent and ground colours of the light theme (src/ui/styles.css). */
const ACCENT = "#1f5fbf";
const GROUND = "#f3f4f1";

/**
 * The barbell, drawn inside the middle 60% of the square: the part a maskable icon keeps
 * whatever shape the phone cuts it to.
 */
const barbell = `
  <g fill="${GROUND}">
    <rect x="108" y="242" width="296" height="28" rx="10" />
    <rect x="140" y="170" width="44" height="172" rx="12" />
    <rect x="328" y="170" width="44" height="172" rx="12" />
    <rect x="108" y="204" width="24" height="104" rx="10" />
    <rect x="380" y="204" width="24" height="104" rx="10" />
  </g>`;

/** The barbell on the accent colour, with the square's corners rounded by `corner` units. */
const square = (corner: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${corner}" fill="${ACCENT}" />${barbell}
</svg>
`;
/** With rounded corners, for browsers that show the icon as it is. */
const icon = square(112);
/** Filling the whole square, for Android to cut to its own shape and for the iPhone to round. */
const fullSquare = square(0);

const publicDir = new URL("./public/", import.meta.url);
writeFileSync(new URL("icon.svg", publicDir), icon);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (svg: string, size: number, file: string) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html, body { margin: 0; background: transparent; } svg { display: block; width: ${size}px; height: ${size}px; }</style>${svg}`,
    );
    writeFileSync(new URL(file, publicDir), await page.screenshot({ omitBackground: true }));
  };
  await render(icon, 192, "icon-192.png");
  await render(icon, 512, "icon-512.png");
  await render(fullSquare, 512, "icon-maskable-512.png");
  await render(fullSquare, 180, "apple-touch-icon.png");
} finally {
  await browser.close();
}
