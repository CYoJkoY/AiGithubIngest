const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  "vendor",
  ".venv",
  "__pycache__",
  ".turbo",
  "coverage",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  ".DS_Store",
]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "svg",
  "webp",
  "bmp",
  "avif",
  "mp4",
  "webm",
  "mp3",
  "wav",
  "ogg",
  "zip",
  "tar",
  "gz",
  "7z",
  "rar",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "iso",
  "wasm",
  "pyc",
  "class",
]);

export function shouldIncludeFile(
  path: string,
  size?: number,
  maxSizeBytes: number = 100 * 1024,
): boolean {
  const segments = path.split("/");

  for (const seg of segments.slice(0, -1)) {
    if (IGNORED_DIRECTORIES.has(seg)) return false;
  }

  const fileName = segments[segments.length - 1];
  if (IGNORED_FILES.has(fileName)) return false;

  const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
  if (extMatch && BINARY_EXTENSIONS.has(extMatch[1].toLowerCase())) {
    return false;
  }

  if (size !== undefined && size > maxSizeBytes) {
    return false;
  }

  return true;
}
