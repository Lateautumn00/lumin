# Lumin

An offline-first Windows desktop toolbox. Single window with a sidebar; every tool is an independent, pluggable package. No self-hosted backend — your data stays on your machine.

## Features

| Tool            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculator      | Expression evaluation (mathjs) with history; base conversion (2/8/10/16 + bitwise ops); 17 unit-conversion categories (no FX rates); money math (mortgage, salary tax, percentages)                                                                                                                                                                                                                                                                                                                         |
| Document output | "To PDF": batch-convert `.doc/.docx/.xls/.xlsx/.ppt/.pptx` to PDF, saved next to the source, auto `(1)` suffix on conflicts; "Print": Office / PDF / images via the system print dialog                                                                                                                                                                                                                                                                                                                     |
| Exam splitter   | OCR question slicing (images/PDF → per-question export); PDF split/crop as a pre-step, other PDF ops live in the PDF toolkit                                                                                                                                                                                                                                                                                                                                                                                |
| Image toolbox   | Compress / convert / resize / rotate / crop / adjust (grayscale/invert/binary threshold) / GIF from frames / watermark / dewatermark / stitching — JPG, PNG, WebP, AVIF, BMP, TIFF; **OCR** (offline PP-OCR, single or batch, editable per-image, copy or merge-export TXT); **QR code** (text/URL/WiFi/vCard to PNG/SVG, decode single or batch ≤50 images)                                                                                                                                                |
| Text toolbox    | JSON format/minify/validate, Base64/URL/Hex/Unicode encode-decode, regex test & replace preview, batch text processing & word count, Morse code, CSV ↔ JSON, Chinese → Pinyin, URL encode/decode, SQL format/minify, **text editor** (encoding detect/save, line numbers, 5 MiB guard) and **text diff** (line-by-line, ignore whitespace/case, side-by-side/unified)                                                                                                                                       |
| Markdown tool   | Markdown preview & HTML export, JSON→TypeScript types or JSON Schema, YAML format/convert                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Color toolbox   | HEX/RGB/HSL conversion, full-screen eyedropper (outside the app window)/picker and color scales, image palette extraction (dominant colors & ratios), harmony palettes, color-vision-deficiency simulation (8 types), WCAG contrast (AA/AAA) checks                                                                                                                                                                                                                                                         |
| Time toolbox    | Timestamp ↔ date conversion, 8 common time zones, duration math, Cron parsing with next 5 runs, date calculator (interval / workdays / date add-subtract)                                                                                                                                                                                                                                                                                                                                                   |
| Calendar        | Solar/lunar month grid with solar terms & festivals, statutory holidays with make-up workdays, Chinese almanac (do/avoid, duty star, clash), solar & lunar anniversaries with countdown                                                                                                                                                                                                                                                                                                                     |
| PDF toolkit     | Merge, split, delete, rotate, reorder pages, edit metadata, add watermarks and page numbers, text extraction, image extraction, compression, and PDF ↔ images conversion — output beside the source                                                                                                                                                                                                                                                                                                         |
| File scanner    | Seven tabs: batch MD5/SHA-1/SHA-256/SHA-512 hashing with paste-to-verify, duplicate finder (two-stage SHA-256, keep oldest, trash the rest), folder compare (size/mtime/optional content, read-only), batch renamer (six stacked rules, live preview, conflict check, single-step undo), file cleaner (tree export, empty-folder/temp-file trash, batch mtime/atime), disk usage analysis (size-sorted drill-down) and ZIP archive (pack/extract with zip-slip guard, no overwrite, GBK filename decoding)  |
| Dev toolbox     | Port usage lookup with process kill, cURL to fetch/axios/python, JWT decoding (no signature check), local static server bound to 127.0.0.1, base conversion & bitwise ops (AND/OR/XOR/NOT)                                                                                                                                                                                                                                                                                                                  |
| Misc toolbox    | Subnet/IP calculator (IPv4 /0–/32, IPv6 /0–/128), on-screen ruler (screenshot drag-to-measure in px/cm/inch), stopwatch, countdown and Pomodoro timer, Chinese info (masking / ID card validation / amount in Chinese characters), system info (CPU/memory/disks/network/OS), password generator (strong random/EFF passphrase/UUID/random) and clipboard history (text & images recorded while the page is open, local persistence)                                                                        |
| Media converter | Convert video/audio formats (8 video containers: MP4/MKV/WebM/MOV/AVI/FLV/TS/M4V; 7 audio: MP3/M4A/WAV/FLAC/OGG/AAC/Opus), remux without re-encoding, H.265, resolution/FPS/bitrate, strip audio, trim clips, extract audio, compress — reuses the bundled ffmpeg, fully offline; **video download** (Bilibili/Douyin/YouTube presets, online, local parsing only; respect platform terms and copyright); **local player** (mp4/webm/ogv/ogg natively, speed and fullscreen, no transcoding or file copies) |
| File preview    | Preview text / Markdown / HTML / JSON / CSV / PDF / images / Office locally (Office via LibreOffice → PDF); PDF rendered page by page, Markdown/HTML in a sandboxed frame                                                                                                                                                                                                                                                                                                                                   |
| Mind map        | Tree map editing (drag to re-parent/reorder, collapse, themeable styles), Markdown/OPML/JSON import & export, PNG/SVG export, local .json open/save with draft recovery                                                                                                                                                                                                                                                                                                                                     |
| Theme           | Follow system / light / dark, applied app-wide via design tokens with no per-tool overrides                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Requirements

- Windows 10 / 11 (x64)
- No .NET, Python or other runtime required
- Office to PDF needs LibreOffice: download the portable build inside the tool (~359 MB) or point to an existing `soffice.exe`

## Download & install

Get the latest build from [GitHub Releases](https://github.com/OWNER/lumin/releases) or [Gitee Releases](https://gitee.com/Lateautumn00/lumin/releases) (identical artifacts and SHA256):

- `Lumin-<version>-win-x64-setup.exe` — NSIS installer (choose directory, desktop/start-menu shortcuts)
- `Lumin-<version>-win-x64-portable.exe` — portable single executable

### SmartScreen on first run

Builds are not code-signed yet, so SmartScreen may show "Windows protected your PC":

1. Click **More info**
2. Click **Run anyway**

Only use installers from the official Releases page, and verify the SHA256 checksum listed in the release notes:

```powershell
Get-FileHash .\Lumin-0.1.0-win-x64-setup.exe -Algorithm SHA256
```

## Privacy

- No backend. Nothing leaves the machine except the optional video downloader
- Video engine (yt-dlp/FFmpeg) and OCR models ship with the app
- Cookies are stored with OS-level encryption (Electron safeStorage), never in plain text
- Logs stay in the local user data directory (openable from Settings) and are never uploaded

## Updates

- "Check for updates" on the About page: check → download → "Install and restart"
- Update feed is the repo `updates/` directory (generic provider, pinned to the Gitee feed); `allowDowngrade=false`, roll back by publishing a new version
- Dual-source releases: both GitHub and Gitee Releases ship the installer plus `latest.yml`, and versions must match; switching the primary source is a single edit to `publish.url` in `electron-builder.yml`

## Development

```bash
pnpm install                  # Node 24 + pnpm 12 (corepack)
pnpm dev                      # dev mode with hot reload
pnpm build                    # full build
pnpm typecheck                # type check (incl. vue-tsc / e2e)
pnpm lint                     # ESLint
pnpm test                     # Vitest unit tests
pnpm coverage                 # coverage gates (repo ≥60%, core pure modules ≥80%)
pnpm test:e2e                 # build then drive real Electron via Playwright
pnpm dist                     # package NSIS + portable into apps/desktop/release
pnpm gate                     # lint → typecheck → test → audit → boundary
node scripts/fetch-binaries.mjs  # fetch OCR models / video engine (pinned URL + SHA256, not committed)
pnpm update:serve             # local update feed at http://127.0.0.1:8787
```

Architecture and engineering rules: `AGENTS.md` and `docs/opencode/plan.md`. Per-tool field-level specs live in `docs/spec/`, smoke records in `docs/smoke/`.

## Third-party components

Released under the [MIT license](LICENSE). Bundled or on-demand components keep their own licenses:

| Component                    | Purpose                | License                                  |
| ---------------------------- | ---------------------- | ---------------------------------------- |
| Electron / Vue / Naive UI    | Desktop shell & UI     | MIT                                      |
| LibreOffice (on demand)      | Office to PDF          | MPL-2.0                                  |
| yt-dlp                       | Video download         | Unlicense                                |
| FFmpeg                       | Image/video processing | LGPL-2.1+ / GPL-2.0 (depending on build) |
| pdf.js / pdf-lib             | PDF parsing/generation | Apache-2.0 / MIT                         |
| PP-OCR models + ONNX Runtime | Offline OCR            | Apache-2.0 / MIT                         |
| mathjs                       | Expression evaluation  | Apache-2.0                               |
| CodeMirror 6 / iconv-lite    | Text editor            | MIT                                      |

See each project's release page for full notices.

## Contributing

- Issues & suggestions: [GitHub Issues](https://github.com/OWNER/lumin/issues) or [Gitee Issues](https://gitee.com/Lateautumn00/lumin/issues)
- Code: branch from `master` as `feature/*` or `fix/*`, make sure `pnpm gate` is green, open a Pull Request, and update `CHANGELOG.md` plus the matching `docs/spec` and `docs/smoke` notes

## Disclaimer

The video downloader is only for content you have the right to save. Follow the target platform's terms of service and local law. Any copyright or compliance risk is borne by the user.
