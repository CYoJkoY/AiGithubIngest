<div align="center">

<img src="assets/readme/hero.svg" alt="AiGithubIngest — Local, Zero-Proxy GitHub Ingestion Engine for AI Conversations" width="100%">

# AiGithubIngest

**Local, Zero-Proxy GitHub Ingestion Engine for AI Conversations.**

Parse public and private GitHub repositories entirely inside your browser and seamlessly attach structured markdown context into your favorite AI chats upon pasting a link.

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-38bdf8?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Version-0.3.2-0284c7?style=flat-square" alt="Version 0.3.2">
  <img src="https://img.shields.io/badge/Runtime-Pure%20TypeScript%20%2F%20DOM-3178c6?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/Privacy-100%25%20In--Browser%20(Zero%20Servers)-059669?style=flat-square" alt="Zero-Server Privacy">
  <img src="https://img.shields.io/badge/License-MIT-9e8f7e?style=flat-square" alt="MIT License">
</p>

<p>
  <a href="#readme-overview">Overview</a> ·
  <a href="#readme-features">Key Features</a> ·
  <a href="#readme-mechanism">Mechanism & Architecture</a> ·
  <a href="#readme-supported-sites">Supported Platforms</a> ·
  <a href="#readme-quick-start">Quick Start</a> ·
  <a href="#readme-configuration">Configuration</a> ·
  <a href="#readme-versioning">Versioning</a> ·
  <a href="#readme-development">Development</a> ·
  <a href="#readme-support">Support</a> ·
  <a href="#readme-license">License</a>
</p>

</div>

---

<a name="readme-overview"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Overview

Modern AI web applications (such as ChatGPT, Claude, and Gemini) struggle to digest full code repositories without tedious manual downloading or relying on risky third-party cloud ingestion proxies.

**AiGithubIngest** solves this by running an end-to-end repository parser entirely inside your client browser:

```text
Copy GitHub Repo URL
         ↓
Paste directly into an AI Chat Prompt
         ↓
AiGithubIngest intercepts paste event (in-memory)
         ↓
Fetches zipball directly from GitHub REST API / Codeload
         ↓
Streams & decompresses archive via fflate in RAM
         ↓
Applies smart path filters & generates an ASCII tree
         ↓
Mounts a single .md file directly as a native prompt attachment
```

Everything executes inside your local browser runtime—no telemetry, no intermediate proxies, and zero leakage of proprietary code or Personal Access Tokens (PATs).

---

<a name="readme-features"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Key Features

- **100% Client-Side Parsing:** Repository zipballs are fetched and decompressed on the fly via `fflate` inside browser memory.
- **Universal File Attachment Injection:** Automatically scans for native `<input type="file">` controls, Clipboard events, or Drag-and-Drop state machines to attach the repository digest as an authentic markdown file—bypassing React 16+ controlled input traps.
- **Anti-Freeze Fallback Protection:** When direct file mounting is restricted by a host platform, it gracefully injects a lightweight ASCII directory tree and metadata header directly at the cursor, preventing browser hang caused by multi-megabyte raw text pasting.
- **Private Repository & PAT Support:** Supports user-configured GitHub Personal Access Tokens (PAT) stored safely in `chrome.storage.sync` to access private repositories and elevate API limits from 60 to 5,000 req/h.
- **Smart Filter & Heuristic Token Estimator:** Automatically excludes binaries, minified files, lockfiles, virtual environments, build artifacts, and oversized files (>100 KB default), and calculates token counts aligned with modern LLM tokenizers (GPT-4o / o200k_base).
- **Out-of-the-Box AI Site Policy:** Activates automatically on major AI platforms and allows custom domain whitelisting with one click from the popup interface.
- **Standalone Web UI Included:** Features a standalone web interface (`index.html`) for manual pasting, token entry, and one-click clipboard copying without requiring extension background scripts.

---

<a name="readme-mechanism"></a>

## <img src="assets/readme/icons/mechanism.svg" width="24" height="24" alt=""> Architecture & Mechanism

AiGithubIngest follows a strictly bounded, low-overhead WebExtension architecture:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                       Browser Runtime Execution                         │
│                                                                         │
│  [ Web Page Context ]                                                   │
│    └─ src/content/index.ts                                              │
│         ├─ Paste event listener & URL regex extraction                  │
│         └─ src/dom/universal-editor.ts                                  │
│              ├─ Strategy 1: Native input[type="file"] property setter   │
│              ├─ Strategy 2: Simulated ClipboardEvent('paste')           │
│              ├─ Strategy 3: Multi-zone Drag & Drop simulation           │
│              └─ Strategy 4: Lightweight cursor insertion fallback       │
│                                  ▲                                      │
│                                  │ chrome.runtime.sendMessage           │
│                                  ▼                                      │
│  [ Background Service Worker ]                                          │
│    └─ src/background/index.ts                                           │
│         └─ src/core/ingest.ts                                           │
│              ├─ gitHub-engine.ts  → REST API / codeload zipball fetch   │
│              ├─ fflate            → In-memory decompression             │
│              ├─ file-filter.ts    → Glob ignore rules & binary filter   │
│              ├─ tree-builder.ts   → Priority-sorted ASCII tree builder  │
│              └─ token-estimator.ts→ Sub-word heuristic token counter    │
│                                                                         │
│  [ Extension Action Popup ]                                             │
│    └─ src/popup/popup.ts                                                │
│         ├─ Domain policy evaluation & whitelist toggling                │
│         └─ GitHub PAT storage & language preference sync                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tri-Level Universal Mounting Strategy

To guarantee compatibility across diverse web app frameworks, the DOM driver applies three cascaded attachment strategies:

1. **Direct `HTMLInputElement` Prototype Injection:** Bypasses framework property shadowing (such as React's internal fiber state) to set the `files` property and fire native `input` / `change` events.
2. **Synthetic Clipboard Dispatch:** Dispatches a structured `ClipboardEvent` carrying a generated `File` object in `clipboardData`.
3. **Multi-Target Drag & Drop Simulation:** Emits `dragenter`, `dragover`, and `drop` events with synthetic `DataTransfer` payloads across outer form and dropzone boundaries.

---

<a name="readme-supported-sites"></a>

## <img src="assets/readme/icons/sites.svg" width="24" height="24" alt=""> Supported Platforms

Built-in support is active by default on leading AI chat platforms:

| Platform              | Domain                           | Default Status                |
| :-------------------- | :------------------------------- | :---------------------------- |
| **ChatGPT**           | `chatgpt.com`, `chat.openai.com` | Built-in (Always Active)      |
| **Claude**            | `claude.ai`                      | Built-in (Always Active)      |
| **Google Gemini**     | `gemini.google.com`              | Built-in (Always Active)      |
| **DeepSeek**          | `chat.deepseek.com`              | Built-in (Always Active)      |
| **Poe**               | `poe.com`                        | Built-in (Always Active)      |
| **Perplexity**        | `perplexity.ai`                  | Built-in (Always Active)      |
| **Kimi**              | `kimi.moonshot.cn`               | Built-in (Always Active)      |
| **ChatGLM**           | `chatglm.cn`                     | Built-in (Always Active)      |
| **Tongyi Qianwen**    | `tongyi.aliyun.com`              | Built-in (Always Active)      |
| **Microsoft Copilot** | `copilot.microsoft.com`          | Built-in (Always Active)      |
| **Custom AI Sites**   | _Any domain_                     | Whitelist via Extension Popup |

---

<a name="readme-quick-start"></a>

## <img src="assets/readme/icons/download.svg" width="24" height="24" alt=""> Quick Start

### Option A: Install Release Archive (Recommended)

1. Download the latest `ai-github-ingest-extension.zip` from [Releases](https://github.com/CYoJkoY/AiGithubIngest/releases).
2. Unpack the `.zip` archive to a persistent local folder.
3. Open Chrome or any Chromium browser (Edge, Brave) and navigate to `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the unzipped directory.

### Option B: Build from Source

Ensure you have **Node.js >= 22** and **pnpm** installed:

```bash
# Clone the repository
git clone [https://github.com/CYoJkoY/AiGithubIngest.git](https://github.com/CYoJkoY/AiGithubIngest.git)
cd AiGithubIngest

# Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# Typecheck and build bundle into dist/
pnpm run build
```

Then load the resulting `dist/` directory as an unpacked extension in your browser.

---

<a name="readme-configuration"></a>

## <img src="assets/readme/icons/config.svg" width="24" height="24" alt=""> Configuration

Click the extension icon in your browser toolbar to open the settings popup:

- **Site Policy:** Inspects current tab status. Toggle any domain into the custom whitelist.
- **GitHub Token:** Enter a Personal Access Token (classic with `repo` scope or fine-grained read token). This allows accessing private repositories and raises API rate limits to 5,000 requests/hour.
- **Language:** Switch between English and Simplified Chinese (`zh-CN`).

---

<a name="readme-versioning"></a>

## <img src="assets/readme/icons/engineering.svg" width="24" height="24" alt=""> Versioning Strategy

AiGithubIngest follows a dual-channel release model:

| Channel         | `manifest.version` | `manifest.version_name` | Git Tag       | GitHub Release |
| :-------------- | :----------------- | :---------------------- | :------------ | :------------- |
| **Stable**      | `X.Y.Z`            | omitted or `X.Y.Z`      | `vX.Y.Z`      | Published      |
| **Development** | `X.Y.Z`            | `X.Y.Z.devN`            | `vX.Y.Z.devN` | Pre-release    |

Key rules:

- `manifest.version` must always be a Chrome-valid `X.Y.Z` string. Chrome rejects `dev` suffixes here.
- `manifest.version_name` is the human-readable channel marker. Development builds keep the same base `X.Y.Z` but append `.devN`.
- `package.json.version` always tracks `manifest.version` only, never `version_name`. The `sync-manifest-version.yml` workflow enforces this on every `main` push.
- Development tags (`vX.Y.Z.devN`) publish as **Pre-release**. They are excluded from GitHub's `latest` pointer and from any future auto-update check.
- Stable tags (`vX.Y.Z`) publish as regular releases.

### Publishing a development build

1. Edit `manifest.json`:

   ```json
   {
     "version": "0.5.0",
     "version_name": "0.5.0.dev01"
   }
   ```

2. Commit to `main`. The sync workflow aligns `package.json` automatically.
3. Tag and push:

   ```bash
   git tag v0.5.0.dev01
   git push origin v0.5.0.dev01
   ```

4. The release workflow validates the tag against `version_name`, builds ZIP/CRX with the `.devN` suffix, and publishes a Pre-release.

### Publishing a stable build

1. Edit `manifest.json` and remove `version_name` (or set it to the same `X.Y.Z`):

   ```json
   {
     "version": "0.5.0"
   }
   ```

2. Ensure `package.json` is also `0.5.0`.
3. Tag and push:

   ```bash
   git tag v0.5.0
   git push origin v0.5.0
   ```

4. The release workflow publishes a normal release.

### Notes

- If you need to install a dev build and a stable build side by side, use a separate CRX signing key for the dev channel so the extension IDs differ. Otherwise they overwrite each other.
- Never paste a `version_name` value into any field Chrome treats as strict semver.

---

<a name="readme-development"></a>

## <img src="assets/readme/icons/engineering.svg" width="24" height="24" alt=""> Development & Quality Gates

AiGithubIngest follows strict contract verification and zero-runtime-waste engineering standards:

```bash
# Typecheck TypeScript codebase with strict settings
pnpm run typecheck

# Run standalone bundle build
node build.mjs
```

### CI / CD Workflows

- **`ci.yml`**: Enforces strict semantic manifest version checks, validates `version_name` prefix rules, executes `tsc --noEmit`, builds distribution artifacts, and validates worktree cleanliness.
- **`release.yml`**: Verifies that git tags match `manifest.json` versions (`version` for stable, `version_name` for development), verifies critical artifact files (`background.js`, `content.js`, `popup.html`, etc.), and packages both signed CRX3 and ZIP distributions. Development tags are published as Pre-releases.
- **`sync-manifest-version.yml`**: Automatically syncs `package.json` to the authoritative `manifest.version` single source of truth upon main-branch updates.

---

<a name="readme-support"></a>

## <img src="assets/readme/icons/heart.svg" width="24" height="24" alt=""> Support & Sponsorship

Maintaining browser extension compatibility across rapidly evolving AI web applications, rate-limit defenses, and memory-safe streaming decompression requires continuous testing and maintenance.

<div align="center">

<a href="https://cyojkoy.github.io/Payment/">
  <img src="assets/readme/support-cta.svg" alt="Support AiGithubIngest development" width="420">
</a>

<br>

**Direct sponsorship link:** [https://cyojkoy.github.io/Payment/](https://cyojkoy.github.io/Payment/)

<sub>Sponsorship funds ongoing maintenance, cross-browser compatibility hardening, and dependency audits.</sub>

</div>

---

<a name="readme-license"></a>

## <img src="assets/readme/icons/license.svg" width="24" height="24" alt=""> License

This project is open-source and released under the [MIT License](LICENSE).
