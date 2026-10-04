# Third-Party Notices

AiGithubIngest ships the following third-party material. Corresponding license
texts are reproduced or referenced below.

---

## Wabi-Press · 侘寂刊本 — design system (vendored CSS)

- **Source:** <https://github.com/CYoJkoY/AzSkills> → `design-system/wabi-press.css`
- **Vendored at:** `src/ui/wabi-press.css`
- **License:** MIT
- **Copyright:** © 2026 CYoJkoY

The Wabi-Press token set is the visual language for every extension-owned
surface in this repository (popup, standalone page, injected toast, pseudo-file
dock). The vendored file keeps the upstream content byte-faithful above the
`AiGithubIngest Extensions` divider so it stays diffable against its source;
additions below that divider are this project's own work.

### MIT License

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

---

## Runtime dependency

- **fflate** — MIT — <https://github.com/101arrowz/fflate>

Used to stream-decompress repository zipballs entirely in browser memory.
