# Lumin

An offline-first Windows desktop toolbox. Single window with a sidebar; every tool is an independent, pluggable package. No self-hosted backend — your data stays on your machine.

## Features

| Tool             | Description                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Calculator       | Expression evaluation (mathjs) with history                                                                       |
| Unit converter   | Length, area, volume, mass, temperature, speed, pressure, energy, power, data (no FX rates)                       |
| Office to PDF    | Batch-convert `.doc/.docx/.xls/.xlsx/.ppt/.pptx` to PDF, saved next to the source, auto `(1)` suffix on conflicts |
| Exam splitter    | PDF split/merge/delete/crop + OCR question slicing (images/PDF → per-question export)                             |
| Image toolbox    | Compress / convert / resize — JPG, PNG, WebP, AVIF, BMP, TIFF; GIF→WebP keeps animation                           |
| Batch renamer    | Six stacked rules in one directory, live preview, conflict detection, single-step undo                            |
| Text toolbox     | JSON format/minify/validate, Base64/URL encode-decode, regex test & replace preview                               |
| PDF images       | PDF pages → PNG/JPG (range/DPI), images → PDF in order (auto/A4 page size)                                        |
| PDF toolkit      | Merge, split, delete, rotate, reorder pages, edit metadata, add watermarks and page numbers — output beside the source |
| File hasher      | Batch MD5/SHA-1/SHA-256 with paste-to-verify against an expected digest, TSV copy                                 |
| Duplicate finder | Scan a folder, confirm duplicate groups with two-stage SHA-256, keep the oldest and trash the rest                |
| Media converter  | Transcode (MP4/WebM/MKV), trim clips, extract audio, compress — reuses the bundled ffmpeg, fully offline          |
| QR code tool     | Generate text/URL/WiFi/vCard QR codes (PNG/SVG) or decode content from local images                                |
| OCR text         | Offline PP-OCR text extraction from images, editable preview, copy and TXT export                                  |
| Image watermark  | Batch text/image watermarks on multiple images (9-grid, opacity, rotation, tiling); originals untouched            |
| Video downloader | Bilibili/Douyin/YouTube presets (online, local parsing only; respect platform terms and copyright)                |
| Theme            | Follow system / light / dark, applied app-wide via design tokens with no per-tool overrides                       |

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

See each project's release page for full notices.

## Contributing

- Issues & suggestions: [Gitee Issues](https://gitee.com/Lateautumn00/lumin/issues)
- Code: branch from `master` as `feature/*` or `fix/*`, make sure `pnpm gate` is green, open a Pull Request, and update `CHANGELOG.md` plus the matching `docs/spec` and `docs/smoke` notes

## Disclaimer

The video downloader is only for content you have the right to save. Follow the target platform's terms of service and local law. Any copyright or compliance risk is borne by the user.
