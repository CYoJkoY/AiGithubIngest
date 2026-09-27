module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import", "sonarjs"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:sonarjs/recommended",
  ],
  rules: {
    "max-lines": [
      "warn",
      { max: 300, skipBlankLines: true, skipComments: true },
    ],
    "max-lines-per-function": [
      "warn",
      { max: 50, skipBlankLines: true, skipComments: true },
    ],
    complexity: ["warn", 10],
    "max-depth": ["warn", 3],
    "max-params": ["warn", 4],
    "max-statements": ["warn", 30],
    "max-nested-callbacks": ["warn", 3],
    "import/no-cycle": "error",
    "no-empty": ["error", { allowEmptyCatch: false }],
    "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "import/extensions": [
      "error",
      "ignorePackages",
      { ts: "never", js: "never" },
    ],
  },
  settings: {
    "import/resolver": {
      typescript: {},
    },
  },
  ignorePatterns: ["dist/", "node_modules/", "*.config.*", "build.mjs"],
};
