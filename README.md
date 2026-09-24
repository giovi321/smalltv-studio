<p align="center">
  <img src="assets/logo.svg" alt="smalltv-studio" width="96" />
</p>

<h1 align="center">smalltv-studio</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-WTFPL-blue.svg" alt="License: WTFPL"></a>
  <a href="https://github.com/giovi321/smalltv-mod"><img src="https://img.shields.io/badge/firmware-smalltv--mod-22c55e" alt="Firmware: smalltv-mod"></a>
</p>

> Not affiliated with GeekMagic.

A theme editor for [smalltv-mod](https://github.com/giovi321/smalltv-mod), the custom firmware for the GeekMagic SmallTV. It builds the `.stheme` clock face packages that the firmware installs from its web UI: background images, animated sprites, clock and date text, shapes, and fields pulled from JSON data sources.

The editor produces packages only. The device side, meaning the parser, the renderer and the install API, lives in smalltv-mod.

## Status

Early development. The current release is listed on the [releases page](https://github.com/giovi321/smalltv-studio/releases). Each release names the smalltv-mod release its exports were validated against.

## Run locally

Needs Node.js 20.19 or newer and Python 3.

```sh
npm install
npm run build          # builds dist/index.html, a single self-contained file
python3 serve.py       # open http://localhost:4173/
```

`serve.py` is a small static server (stdlib only, 127.0.0.1) that also lets the editor talk to your TV. `dist/index.html` also works opened straight from disk, except for reading the TV's answers. Nothing leaves your machine except what you explicitly send to your own TV.

For development, run `npm run dev` for the hot-reloading editor, and `python3 serve.py` next to it if you want to use Send to TV.

## Features

- **Layers**: text, image, animation and shape (rectangle, circle, line) layers, up to 32. Thumbnails, drag-and-drop reordering, double-click rename, and editor-only hide/lock flags (never exported).
- **Canvas**: 240×240 live preview with pixel-perfect zoom (Fit, 100–500 %), graduated rulers, pixel grid, smart guides and snapping (hold Alt to bypass), handles for every layer type (resize images, rectangles, circles, line endpoints and text size; Shift keeps the aspect ratio), right-click actions and keyboard nudging.
- **Inspector**: grouped sections, hex + picker colors, 3×3 text anchor, align-to-screen, clock and data variable chips, aspect-locked resizing (nearest-neighbour, resampled from the original pixels), rounded rectangle corners.
- **Preview**: 60-second timeline with play, pause and seek, a simulated date and time, and a *Clock synced* switch that shows the device before its first NTP sync, when every clock variable reads `--`.
- **Scrolling text**: a text layer can scroll inside a fixed-width viewport, in `loop` or `bounce` mode, with its speed, pause and gap. The preview follows the device's timing to the millisecond, including the restart when the text changes.
- **Data bindings**: position, size, stroke width, scroll width/speed and colors can follow a fetched value, through a linear mapping or color stops. Each binding shows its result for the current preview value; without a value the static property applies, as on the device.
- **Data sources**: up to 4 JSON sources with up to 8 fields each (`{source.field}` variables), including the `insecureTls` acknowledgement the firmware requires for HTTPS. Renaming a source or field rewrites the text that uses it. Preview values are editor-only; *Fetch live values* fills them from the URL when the server allows browser requests.
- **Theme tab**: metadata, background, and a live budget for package size, manifest size, layers, entries and data sources.
- **Import / export**: `.stheme`, `theme.json`, or a source folder; drop files anywhere on the page (images become image layers, several become an animation). Oversized images are scaled to fit 240×240. Export `.stheme` (Ctrl/Cmd S), the source folder (`theme.json` and lossless PNGs in the firmware's layout, as a `.zip`), the manifest only, or a PNG of the preview. The firmware's `tools/smalltv_theme.py build` turns an exported source folder back into the exact same package.
- **Send to TV**: type the TV's IP and the theme is installed on the SmallTV through its API, then optionally activated. It checks the TV first (firmware, installed themes, free space), can replace an existing theme with the same ID, supports the TV's optional password, and shows the TV's own error messages. Started with `serve.py`, answers are fully visible; otherwise (plain static server or `dist/index.html` opened from disk) it sends blindly because the firmware has no CORS headers. The relay only forwards the firmware's theme routes to private-network addresses. Through the relay, the dialog also lists the themes installed on the TV (name, version, size, validity) and can switch to one or remove it.
- **Examples**: Pixel Room, Terminal Ops and Live Status, taken from the firmware repository. Live Status loads with preview values, so its scrolling headlines and data-driven bar move at once.
- **Validation**: every issue is listed, and clicking one jumps to the layer or the Data tab.

Press `?` in the editor for the keyboard shortcuts.

## Theme format

The `.stheme` format is defined by the smalltv-mod firmware and its packing and validation tools. The format is documented on the [theme clocks page](https://giovi321.github.io/smalltv-mod/features/themes/) of the smalltv-mod docs. A package built here has to pass that validator unchanged, so a theme that the editor accepts also installs on the device.

## Installing a theme on the device

1. Export the theme from the editor as a `.stheme` file
2. Open the device's web UI and go to the Display tab
3. Upload the file under the theme section and select it

Or use **Send to TV** in the editor, which installs it through the device API (see above).

An installed theme can make the device poll any URL listed in its manifest, including addresses on your LAN. Install themes only from sources you trust.

## Tests

```sh
npm test               # core tests (Vitest)
npm run typecheck      # both also run in CI on every pull request
```

The core is checked against the firmware package format, including data sources and the example packages: they must unpack and pack back byte for byte.

With a smalltv-mod checkout next to this one, the parity tests also build the firmware's native theme tool and compare the two implementations directly: every preview frame must match the C++ renderer pixel for pixel (examples, scrolling, rounded corners, bindings), a set of broken manifests must be rejected by both, on the same field, and exported source folders must rebuild into byte-identical packages with the firmware's packer.

```sh
SMALLTV_MOD=../smalltv-mod npm test
```

Exported packages can also be validated with the firmware's own C++ validator:

```sh
python3 ../smalltv-mod/tools/smalltv_theme.py validate my-theme.stheme
```

## Layout

The editor is written in TypeScript with React, built by Vite.

| Path | Role |
| --- | --- |
| `src/core/` | Manifest types, validation, package codec, RGB565 renderer and bitmap font (no DOM) |
| `src/core/dynamic.ts` | Data bindings and text scrolling, following the firmware engine |
| `src/core/source.ts` | Source folder export: PNG encoder and ZIP writer |
| `src/store/studio.ts` | State (zustand), undo history, layer and data-source actions |
| `src/device/device.ts` | Theme API client (relay or direct transport) |
| `src/lib/files.ts` | Import, export and bundled examples |
| `src/components/` | React UI: top bar, layers / theme / data tabs, stage, inspector, Send to TV |
| `src/App.tsx` | Layout, keyboard shortcuts, file drops, playback clock |
| `test/` | Core, store and firmware parity tests |
| `fixtures/` | Example packages, bundled into the editor |
| `serve.py` | Local static server and TV relay |

## Maintainers

- [kittyruntime](https://github.com/kittyruntime)
- [giovi321](https://github.com/giovi321)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[WTFPL](LICENSE).
