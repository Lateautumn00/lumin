# Lumin

An offline-first Windows desktop toolbox. Single window with a sidebar; every tool is an independent, pluggable package. No self-hosted backend — your data stays on your machine.

## Features

| Tool               | Description                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculator         | Expression evaluation (mathjs) with history                                                                                                                                                                                                                                      |
| Unit converter     | Length, weight, temperature, area, volume, speed, time, data, data rate, pressure, power, energy, flow, fuel, angle, frequency, pixel/DPI — 17 categories (no FX rates)                                                                                                          |
| Office to PDF      | Batch-convert `.doc/.docx/.xls/.xlsx/.ppt/.pptx` to PDF, saved next to the source, auto `(1)` suffix on conflicts                                                                                                                                                                |
| Exam splitter      | OCR question slicing (images/PDF → per-question export); PDF split/crop as a pre-step, other PDF ops live in the PDF toolkit                                                                                                                                                     |
| Image toolbox      | Compress / convert / resize / adjust (grayscale/invert/binary threshold) / GIF from frames — JPG, PNG, WebP, AVIF, BMP, TIFF                                                                                                                                                     |
| Image rotate       | Batch rotate (90°/180°/270°) and horizontal/vertical flip, combinable; remembers output folder, never overwrites originals                                                                                                                                                       |
| Image crop         | Batch crop by aspect ratio (with 9-grid anchor) or percentage region; remembers output folder, never overwrites originals                                                                                                                                                        |
| Batch renamer      | Six stacked rules in one directory, live preview, conflict detection, single-step undo                                                                                                                                                                                           |
| Text toolbox       | JSON format/minify/validate, Base64/URL/Hex/Unicode encode-decode, regex test & replace preview, batch text processing & word count, Morse code, CSV ↔ JSON, Chinese → Pinyin, URL encode/decode & SQL format/minify                                                             |
| Clipboard history  | Automatically records copied text and images while the page is open (1s polling, image-first), 500 text / 100 image cap, type filter, search filter, pin without eviction, one-click re-copy, persisted to a local file                                                          |
| Markdown tool      | Markdown preview & HTML export, JSON→TypeScript types or JSON Schema, YAML format/convert                                                                                                                                                                                        |
| Color toolbox      | HEX/RGB/HSL conversion, full-screen eyedropper (outside the app window)/picker and color scales, image palette extraction (dominant colors & ratios), harmony palettes, color-vision-deficiency simulation (8 types), WCAG contrast (AA/AAA) checks                              |
| Time toolbox       | Timestamp ↔ date conversion, 8 common time zones, duration math, Cron parsing with next 5 runs, date calculator (interval / workdays / date add-subtract)                                                                                                                        |
| Calendar           | Solar/lunar month grid with solar terms & festivals, statutory holidays with make-up workdays, Chinese almanac (do/avoid, duty star, clash), solar & lunar anniversaries with countdown                                                                                          |
| Life calculator    | Mortgage payments (equal installment/equal principal) with schedule, salary tax with deductions, percentage & discount math                                                                                                                                                      |
| Password generator | Strong random passwords (charsets/exclusions/entropy & strength), EFF passphrases (3–10 words, separator/capitalize/digit suffix), UUID v4, random strings and integers                                                                                                          |
| Text diff          | Line-by-line text comparison, ignore whitespace/case, side-by-side and unified views, stats and unified diff copy                                                                                                                                                                |
| PDF images         | PDF pages → PNG/JPG (range/DPI), images → PDF in order (auto/A4/Letter, orientation/margins, custom name)                                                                                                                                                                        |
| PDF toolkit        | Merge, split, delete, rotate, reorder pages, edit metadata, add watermarks and page numbers, text extraction, image extraction and compression — output beside the source                                                                                                        |
| File hasher        | Batch MD5/SHA-1/SHA-256/SHA-512 with paste-to-verify against an expected digest, TSV copy                                                                                                                                                                                        |
| Duplicate finder   | Scan a folder, confirm duplicate groups with two-stage SHA-256, keep the oldest and trash the rest                                                                                                                                                                               |
| File cleaner       | Export a directory tree, scan & trash empty folders or temp files (after picking), batch-set file times (mtime/atime)                                                                                                                                                            |
| Dev toolbox        | Port usage lookup with process kill, cURL to fetch/axios/python, JWT decoding (no signature check), local static server bound to 127.0.0.1, base conversion & bitwise ops (AND/OR/XOR/NOT)                                                                                       |
| Misc toolbox       | Subnet/IP calculator (IPv4 /0–/32, IPv6 /0–/128), on-screen ruler (screenshot drag-to-measure in px/cm/inch), stopwatch, countdown and Pomodoro timer, Chinese info (masking / ID card validation / amount in Chinese characters)                                                |
| Disk usage         | Recursively scan a folder, list entries by size with usage bars, drill down level by level (read-only)                                                                                                                                                                           |
| System info        | CPU, memory, disks, network and OS overview with one-click copy (read-only)                                                                                                                                                                                                      |
| Folder compare     | Pair files by relative path across two folders, diff by size/mtime with filters and reveal (read-only, no content)                                                                                                                                                               |
| Zip tool           | Pack files/folders into ZIP (keeps relative structure) or extract ZIPs safely (zip-slip guarded, no overwrite, GBK names transcoded)                                                                                                                                             |
| Media converter    | Convert video/audio formats (8 video containers: MP4/MKV/WebM/MOV/AVI/FLV/TS/M4V; 7 audio: MP3/M4A/WAV/FLAC/OGG/AAC/Opus), remux without re-encoding, H.265, resolution/FPS/bitrate, strip audio, trim clips, extract audio, compress — reuses the bundled ffmpeg, fully offline |
| QR code tool       | Generate text/URL/WiFi/vCard QR codes (PNG/SVG) or decode local images (single or batch up to 50)                                                                                                                                                                                |
| OCR text           | Offline PP-OCR over single or multiple images, per-image editable preview, copy and per-file/merged TXT export                                                                                                                                                                   |
| Image watermark    | Batch text/image watermarks on multiple images (9-grid, opacity, rotation, tiling); originals untouched                                                                                                                                                                          |
| Image dewatermark  | Manually box multiple rectangles and remove watermarks via fast inpaint (Telea) / blur / solid fill; originals untouched, output folder remembered                                                                                                                               |
| Image stitching    | Stitch multiple images into vertical/horizontal long images or a grid, or split one long image by fixed height / part count (spacing, margin, background adjustable)                                                                                                             |
| File preview       | Preview text / Markdown / HTML / JSON / CSV / PDF / images / Office locally (Office via LibreOffice → PDF); PDF rendered page by page, Markdown/HTML in a sandboxed frame                                                                                                        |
| Text editor        | Plain-text editing with UTF-8/UTF-16/GBK detection & saving, CRLF/LF, line numbers and current-line highlight, read-only and 5 MiB guard, external-change conflict detection                                                                                                     |
| Video player       | Play local mp4/webm/ogv/ogg natively (browser codecs, speed and fullscreen; no transcoding, no file copies)                                                                                                                                                                      |
| Mind map           | Tree map editing (drag to re-parent/reorder, collapse, themeable styles), Markdown/OPML/JSON import & export, PNG/SVG export, local .json open/save with draft recovery                                                                                                          |
| Video downloader   | Bilibili/Douyin/YouTube presets (online, local parsing only; respect platform terms and copyright)                                                                                                                                                                               |
| Theme              | Follow system / light / dark, applied app-wide via design tokens with no per-tool overrides                                                                                                                                                                                      |

## Requirements

- Windows 10 / 11 (x64)
- No .NET, Python or other runtime required
- Office to PDF needs LibreOffice: download the portable build inside the tool (~359 MB) or point to an existing `soffice.exe`

## Download & install

Get the latest build from [Releases](https://gitee.com/Lateautumn00/lumin/releases):

- `Lumin-<version>-win-x64-setup.exe` — NSIS installer (choose directory, desktop/start-menu shortcuts)
- `Lumin-<version>-win-x64-portable.exe` — portable single executable

### SmartScreen on first run

Builds are not code-signed yet, so SmartScreen may show "Windows protected your PC":

1. Click **More info**
2. Click **Run anyway**

Only use installers from the official Releases page, and verify the SHA256 checksum listed in the release notes:

```powershell
Get-FileHash .\Lumin-0.9.0-win-x64-setup.exe -Algorithm SHA256
```

## Privacy

- No backend. Nothing leaves the machine except the optional video downloader
- Video engine (yt-dlp/FFmpeg) and OCR models ship with the app
- Cookies are stored with OS-level encryption (Electron safeStorage), never in plain text
- Logs stay in the local user data directory (openable from Settings) and are never uploaded

## Updates

- "Check for updates" on the About page: check → download → "Install and restart"
- Update feed is the Gitee `updates/` directory (generic provider); `allowDowngrade=false`, roll back by publishing a new version

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

- Issues & suggestions: [Gitee Issues](https://gitee.com/Lateautumn00/lumin/issues)
- Code: branch from `master` as `feature/*` or `fix/*`, make sure `pnpm gate` is green, open a Pull Request, and update `CHANGELOG.md` plus the matching `docs/spec` and `docs/smoke` notes

## Disclaimer

The video downloader is only for content you have the right to save. Follow the target platform's terms of service and local law. Any copyright or compliance risk is borne by the user.
