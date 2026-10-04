import * as esbuild from "esbuild";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

const outDir = resolve("dist");

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

try {
  // ---------------------------------------------------------------------------
  // 1. 版本一致性守护检查与自动补正（以 manifest.json 为权威单一真相源）
  //
  // 单通道发布约定：
  //   - manifest.version : 稳定版本，格式必须为 X.Y.Z（Chrome 强制）
  //   - manifest.version_name : 已停用，必须移除
  //   - package.json : 永远只跟随 manifest.version
  // ---------------------------------------------------------------------------
  const manifestPath = resolve("manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkgPath = resolve("package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

  const stableVersion = String(manifest.version || "").trim();

  if (!/^\d+\.\d+\.\d+$/.test(stableVersion)) {
    throw new Error(
      `[Version Guard] manifest.version 必须符合 X.Y.Z 格式，当前为: ${stableVersion}`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(manifest, "version_name")) {
    throw new Error(
      "[Version Guard] 已禁用开发版发布模式，manifest.json 不应再包含 version_name。",
    );
  }

  if (pkg.version !== stableVersion) {
    console.log(
      `[Version Guard] 同步 package.json 版本 (${pkg.version} -> ${stableVersion})`,
    );
    pkg.version = stableVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  }

  // ---------------------------------------------------------------------------
  // 2. 编译打包 TypeScript 入口为原生独立 bundle
  // ---------------------------------------------------------------------------
  await esbuild.build({
    entryPoints: {
      background: resolve("src/background/index.ts"),
      content: resolve("src/content/index.ts"),
      popup: resolve("src/popup/popup.ts"),
    },
    bundle: true,
    outdir: outDir,
    format: "esm",
    target: ["chrome110"],
    platform: "browser",
    sourcemap: false,
    minify: false,
  });

  // ---------------------------------------------------------------------------
  // 3. 静态资源复制映射
  // ---------------------------------------------------------------------------
  const staticAssets = [
    { from: "manifest.json", to: "dist/manifest.json" },
    { from: "index.html", to: "dist/index.html" },
    { from: "style.css", to: "dist/style.css" },
    { from: "src/popup/popup.html", to: "dist/popup.html" },
    { from: "src/popup/popup.css", to: "dist/popup.css" },
    // Wabi-Press token authority — loaded by the popup and the standalone page.
    { from: "src/ui/wabi-press.css", to: "dist/wabi-press.css" },
    { from: "src/ui/toast.css", to: "dist/toast.css" },
    { from: "src/pseudo/pseudo-file.css", to: "dist/pseudo-file.css" },
  ];

  // ---------------------------------------------------------------------------
  // 4. 扫描并复制 src/assets/ 下的所有静态图像与图标
  // ---------------------------------------------------------------------------
  const assetsDir = resolve("src/assets");
  if (existsSync(assetsDir)) {
    const assetFiles = readdirSync(assetsDir);
    for (const file of assetFiles) {
      staticAssets.push({
        from: `src/assets/${file}`,
        to: `dist/assets/${file}`,
      });
    }
  }

  const localesDir = resolve("_locales");
  if (existsSync(localesDir)) {
    const localeFolders = readdirSync(localesDir);
    for (const locale of localeFolders) {
      staticAssets.push({
        from: `_locales/${locale}/messages.json`,
        to: `dist/_locales/${locale}/messages.json`,
      });
    }
  }

  for (const assetEntry of staticAssets) {
    const sourcePath = resolve(assetEntry.from);
    const targetPath = resolve(assetEntry.to);

    if (!existsSync(sourcePath)) {
      throw new Error(`[Build Guard] 静态资源未找到: ${assetEntry.from}`);
    }

    const targetDir = dirname(targetPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    copyFileSync(sourcePath, targetPath);
  }

  console.log(`✅ 构建成功：产物已生成至 dist/ 目录 (version: ${stableVersion})`);
} catch (caughtException) {
  console.error("❌ 构建失败:", caughtException);
  process.exit(1);
}
