import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const outDir = resolve("dist");

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

try {
  // 1. 编译打包 TypeScript 入口为原生独立 bundle
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

  // 2. 静态资源复制映射（包含 Manifest、UI 样式、Popup 模板与 SVG 图标）
  const staticAssets = [
    { from: "manifest.json", to: "dist/manifest.json" },
    { from: "src/popup/popup.html", to: "dist/popup.html" },
    { from: "src/popup/popup.css", to: "dist/popup.css" },
    { from: "src/ui/toast.css", to: "dist/toast.css" },
    { from: "src/assets/icon.svg", to: "dist/assets/icon.svg" },
  ];

  for (const assetEntry of staticAssets) {
    const sourcePath = resolve(assetEntry.from);
    const targetPath = resolve(assetEntry.to);

    // 防御式守卫：校验源资产是否存在，缺失时快速中断抛错
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
