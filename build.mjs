import * as esbuild from "esbuild";
import {
  copyFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

const outDir = resolve("dist");

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

try {
  // 1. 版本一致性守护检查与自动补正
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  const manifestPath = resolve("manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.version !== pkg.version) {
    console.log(
      `[Version Guard] 同步 manifest.json 版本 (${manifest.version} -> ${pkg.version})`,
    );
    manifest.version = pkg.version;
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
  }

  // 2. 编译打包 TypeScript 入口为原生独立 bundle
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

  // 3. 静态资源复制映射
  const staticAssets = [
    { from: "manifest.json", to: "dist/manifest.json" },
    { from: "index.html", to: "dist/index.html" },
    { from: "src/popup/popup.html", to: "dist/popup.html" },
    { from: "src/popup/popup.css", to: "dist/popup.css" },
    { from: "src/ui/toast.css", to: "dist/toast.css" },
  ];

  // 检查可选图标文件
  const optionalIcon = "src/assets/icon.svg";
  if (existsSync(resolve(optionalIcon))) {
    staticAssets.push({ from: optionalIcon, to: "dist/assets/icon.svg" });
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

  console.log("✅ 构建成功：产物已生成至 dist/ 目录");
} catch (caughtException) {
  console.error("❌ 构建失败:", caughtException);
  process.exit(1);
}
