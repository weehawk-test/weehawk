import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

const svgPath = path.join(repoRoot, "apps", "web", "public", "weehawk-logo.svg");
const assetsDir = path.join(desktopRoot, "assets");
const logoPngPath = path.join(assetsDir, "logo.png");
const pngPath = path.join(assetsDir, "icon.png");
const icoPath = path.join(assetsDir, "icon.ico");
const icoTmpDir = path.join(assetsDir, ".ico-sources");

function renderSquarePngFromSvg(svg, targetSize) {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: targetSize,
    },
  });

  const rendered = resvg.render().asPng();
  const src = PNG.sync.read(rendered);
  const size = Math.max(src.width, src.height, targetSize);
  const dest = new PNG({ width: size, height: size });
  const offsetX = Math.floor((size - src.width) / 2);
  const offsetY = Math.floor((size - src.height) / 2);
  PNG.bitblt(src, dest, 0, 0, src.width, src.height, offsetX, offsetY);
  return PNG.sync.write(dest);
}

function applyRoundedCorners(pngBuffer, radiusRatio = 0.12) {
  const image = PNG.sync.read(pngBuffer);
  const { width, height } = image;
  const radius = Math.max(4, Math.floor(Math.min(width, height) * radiusRatio));

  function insideRoundedRect(x, y) {
    // Early accept for inner rectangle areas.
    if (x >= radius && x < width - radius) return true;
    if (y >= radius && y < height - radius) return true;

    // Check the nearest corner circle.
    const cx = x < radius ? radius - 1 : width - radius;
    const cy = y < radius ? radius - 1 : height - radius;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!insideRoundedRect(x, y)) {
        const idx = (width * y + x) << 2;
        image.data[idx + 3] = 0;
      }
    }
  }

  return PNG.sync.write(image);
}

function makeSquarePng(pngBuffer, minSize = 1024) {
  const src = PNG.sync.read(pngBuffer);
  const size = Math.max(src.width, src.height, minSize);
  const dest = new PNG({ width: size, height: size });
  const offsetX = Math.floor((size - src.width) / 2);
  const offsetY = Math.floor((size - src.height) / 2);
  PNG.bitblt(src, dest, 0, 0, src.width, src.height, offsetX, offsetY);
  return applyRoundedCorners(PNG.sync.write(dest));
}

async function main() {
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.rm(icoTmpDir, { recursive: true, force: true });
  await fs.mkdir(icoTmpDir, { recursive: true });

  let iconPngData;
  try {
    const logoPng = await fs.readFile(logoPngPath);
    iconPngData = makeSquarePng(logoPng, 1024);
  } catch {
    const svg = await fs.readFile(svgPath, "utf8");
    iconPngData = applyRoundedCorners(renderSquarePngFromSvg(svg, 1024));

    // Build a multi-size .ico for Windows shortcuts/taskbar fidelity (SVG fallback).
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    const icoSources = [];
    for (const size of icoSizes) {
      const sourcePath = path.join(icoTmpDir, `icon-${size}.png`);
      const data = applyRoundedCorners(renderSquarePngFromSvg(svg, size));
      await fs.writeFile(sourcePath, data);
      icoSources.push(sourcePath);
    }
    const icoData = await pngToIco(icoSources);
    await fs.writeFile(icoPath, icoData);
  }

  await fs.writeFile(pngPath, iconPngData);
  // Always rewrite .ico from final icon.png (logo.png if provided).
  const icoData = await pngToIco(pngPath);
  await fs.writeFile(icoPath, icoData);
  await fs.rm(icoTmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

