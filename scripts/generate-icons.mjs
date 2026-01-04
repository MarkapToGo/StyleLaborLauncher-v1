import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import sharp from "sharp";
import toIco from "to-ico";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const srcLogo = path.join(repoRoot, "public", "logo_8000x8000.png");
const SKIP_FULL_TAURI_ICON =
  process.argv.includes("--skip-tauri-icon") || process.env.SKIP_TAURI_ICON === "1";

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      // Avoid spawning through cmd.exe unless we truly need it; it can trigger
      // "Terminate batch job" prompts when a previous process was Ctrl+C'd.
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(" ")}`));
    });
  });
}

async function ensureFileExists(p) {
  try {
    await fs.access(p);
  } catch {
    throw new Error(`Missing source logo: ${p}`);
  }
}

async function pngBufferForSize(inputPath, size) {
  return sharp(inputPath)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function webpBufferForSize(inputPath, size) {
  return sharp(inputPath)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 92 })
    .toBuffer();
}

async function writeFile(outPath, bufferOrString) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, bufferOrString);
}

async function generateWebAssets() {
  const publicDir = path.join(repoRoot, "public");

  const pngTargets = [
    { size: 16, name: "favicon-16x16.png" },
    { size: 32, name: "favicon-32x32.png" },
    { size: 180, name: "apple-touch-icon.png" },
    { size: 192, name: "android-chrome-192x192.png" },
    { size: 512, name: "android-chrome-512x512.png" },
    { size: 150, name: "mstile-150x150.png" },
    { size: 256, name: "logo-256.png" },
    { size: 512, name: "logo-512.png" },
  ];

  await Promise.all(
    pngTargets.map(async ({ size, name }) => {
      const buf = await pngBufferForSize(srcLogo, size);
      await writeFile(path.join(publicDir, name), buf);
    }),
  );

  // Useful for UI / web distribution (smaller, modern)
  await Promise.all(
    [256, 512].map(async (size) => {
      const buf = await webpBufferForSize(srcLogo, size);
      await writeFile(path.join(publicDir, `logo-${size}.webp`), buf);
    }),
  );

  // Multi-size favicon.ico
  const icoPngs = await Promise.all([16, 32, 48].map((s) => pngBufferForSize(srcLogo, s)));
  const icoBuf = await toIco(icoPngs);
  await writeFile(path.join(publicDir, "favicon.ico"), icoBuf);

  const manifest = {
    name: "StyleLabor Launcher",
    short_name: "StyleLabor",
    description: "A custom Minecraft launcher for modpacks",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f19",
    theme_color: "#0b0f19",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };

  await writeFile(path.join(publicDir, "site.webmanifest"), JSON.stringify(manifest, null, 2) + "\n");
}

async function generateTauriIcons() {
  const tauriIconsDir = path.join(repoRoot, "src-tauri", "icons");

  // Always (re)generate the "core" icons quickly. This covers Windows/Linux dev icons even if
  // the full platform icon generation is interrupted.
  console.log("  - Writing core Tauri icons (png + ico)...");
  await fs.mkdir(tauriIconsDir, { recursive: true });

  const corePngs = [
    { size: 32, name: "32x32.png" },
    { size: 128, name: "128x128.png" },
    { size: 256, name: "128x128@2x.png" },
    { size: 512, name: "icon.png" },
  ];

  await Promise.all(
    corePngs.map(async ({ size, name }) => {
      const buf = await pngBufferForSize(srcLogo, size);
      await writeFile(path.join(tauriIconsDir, name), buf);
    }),
  );

  const icoPngs = await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => pngBufferForSize(srcLogo, s)));
  const icoBuf = await toIco(icoPngs);
  await writeFile(path.join(tauriIconsDir, "icon.ico"), icoBuf);

  // Full platform icon generation (Appx tiles + ICNS, etc). This can take longer.
  if (SKIP_FULL_TAURI_ICON) {
    console.log("  - Skipping full Tauri icon generation (Appx/ICNS).");
    return;
  }

  // 1. Generate core/Windows/Linux icons using the ORIGINAL (Full Bleed) logo
  // User said "Windows icon was great!", only macOS needs padding.
  console.log("  - Generating standard (full-bleed) icons for Windows/Linux...");
  const tauriCli = path.join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  await run(process.execPath, [tauriCli, "icon", "-o", "src-tauri/icons", srcLogo], { cwd: repoRoot });

  // 2. Generate padded icon ONLY for macOS (.icns)
  console.log("  - Creating padded source logo for macOS .icns...");
  const paddedLogoPath = path.join(repoRoot, "public", "logo_padded_temp.png");
  const tempMacIconsDir = path.join(repoRoot, "temp_mac_icons");

  // Get metadata
  const meta = await sharp(srcLogo).metadata();
  const w = meta.width;
  const h = meta.height;
  // Target content size (e.g. 98% of original)
  const contentScale = 0.98;
  const newW = Math.round(w * contentScale);
  const newH = Math.round(h * contentScale);
  const padX = Math.floor((w - newW) / 2);
  const padY = Math.floor((h - newH) / 2);

  await sharp(srcLogo)
    .resize(newW, newH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: padY,
      bottom: h - newH - padY,
      left: padX,
      right: w - newW - padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .toFile(paddedLogoPath);

  // Generate padded icons into a temp folder
  await fs.mkdir(tempMacIconsDir, { recursive: true });
  await run(process.execPath, [tauriCli, "icon", "-o", "temp_mac_icons", paddedLogoPath], { cwd: repoRoot });

  // Overwrite only the macOS .icns in the real folder
  console.log("  - Overwriting src-tauri/icons/icon.icns with padded version...");
  await fs.copyFile(
    path.join(tempMacIconsDir, "icon.icns"),
    path.join(repoRoot, "src-tauri", "icons", "icon.icns")
  );

  // Clean up
  await fs.unlink(paddedLogoPath);
  await fs.rm(tempMacIconsDir, { recursive: true, force: true });
}

async function main() {
  await ensureFileExists(srcLogo);

  console.log(`Using source logo: ${path.relative(repoRoot, srcLogo)}`);
  console.log("Generating web icon set...");
  await generateWebAssets();

  console.log("Generating Tauri icon set...");
  await generateTauriIcons();

  console.log("Done.");
}

await main();


