export const DEFAULT_IGNORE_PATTERNS = new Set<string>([
  // Python
  '*.pyc',
  '*.pyo',
  '*.pyd',
  '__pycache__',
  '.pytest_cache',
  '.coverage',
  '.tox',
  '.nox',
  '.mypy_cache',
  '.ruff_cache',
  '.hypothesis',
  'poetry.lock',
  'Pipfile.lock',
  // JavaScript & Node
  'node_modules',
  'bower_components',
  'package-lock.json',
  'yarn.lock',
  '.npm',
  '.yarn',
  '.pnpm-store',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  // Java & Android
  '*.class',
  '*.jar',
  '*.war',
  '*.ear',
  '*.nar',
  '.gradle',
  'build',
  '.settings',
  '.classpath',
  '*.gradle',
  '.project',
  // C / C++ / Native
  '*.o',
  '*.obj',
  '*.dll',
  '*.dylib',
  '*.exe',
  '*.lib',
  '*.out',
  '*.a',
  '*.pdb',
  // Swift / Xcode
  '.build',
  '*.xcodeproj',
  '*.xcworkspace',
  'xcuserdata',
  '.swiftpm',
  // Ruby
  '*.gem',
  '.bundle',
  'vendor/bundle',
  'Gemfile.lock',
  // Rust
  'Cargo.lock',
  '**/*.rs.bk',
  'target',
  // Go / .NET
  'pkg',
  'obj',
  '*.suo',
  '*.user',
  '*.nupkg',
  'bin',
  // Version control
  '.git',
  '.svn',
  '.hg',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  // Images & Media
  '*.svg',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.ico',
  '*.pdf',
  '*.mov',
  '*.mp4',
  '*.mp3',
  '*.wav',
  '*.webp',
  '*.bmp',
  '*.avif',
  // Virtual envs
  'venv',
  '.venv',
  'env',
  '.env',
  'virtualenv',
  // IDEs
  '.idea',
  '.vscode',
  '.vs',
  '*.swp',
  '*.swo',
  '.DS_Store',
  'Thumbs.db',
  // Build directories
  'dist',
  'out',
  '*.egg-info',
  '*.egg',
  '*.whl',
  '*.so',
  // Docs & Cache
  '.next',
  '.nuxt',
  '.docusaurus',
  '.cache',
  '.turbo',
  'coverage',
  // Databases
  '*.db',
  '*.sqlite',
  '*.sqlite3',
  // Gitingest artifacts
  'digest.txt',
  '*.min.js',
  '*.min.css',
  '*.map',
]);

export function matchGlob(path: string, pattern: string): boolean {
  const cleanPath = path.replace(/^\/+|\/+$/g, '');
  const cleanPat = pattern.replace(/^\/+|\/+$/g, '');

  if (cleanPat === cleanPath) return true;

  // 转换 glob 语法至正则表达式
  const regexStr =
    '^' +
    cleanPat
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*')
      .replace(/\?/g, '[^/]') +
    '$';

  try {
    return new RegExp(regexStr, 'i').test(cleanPath);
  } catch {
    return false;
  }
}

export function shouldIncludeFile(
  filePath: string,
  fileSize?: number,
  maxSizeBytes: number = 100 * 1024,
  customInclude?: readonly string[],
  customExclude?: readonly string[],
): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const fileName = segments[segments.length - 1];

  // 1. 自定义 Include 优先级最高
  if (customInclude && customInclude.length > 0) {
    const included = customInclude.some(
      (pat) => matchGlob(normalized, pat) || matchGlob(fileName, pat),
    );
    if (!included) return false;
  }

  // 2. 自定义 Exclude 检查
  if (customExclude && customExclude.length > 0) {
    const excluded = customExclude.some(
      (pat) => matchGlob(normalized, pat) || matchGlob(fileName, pat),
    );
    if (excluded) return false;
  }

  // 3. 默认排除列表检查（精确匹配路径段及全局通配）
  for (const part of segments) {
    if (DEFAULT_IGNORE_PATTERNS.has(part)) return false;
  }

  for (const pat of DEFAULT_IGNORE_PATTERNS) {
    if (pat.includes('*') && (matchGlob(normalized, pat) || matchGlob(fileName, pat))) {
      return false;
    }
  }

  // 4. 文件体积截断检查
  if (fileSize !== undefined && fileSize > maxSizeBytes) {
    return false;
  }

  return true;
}
