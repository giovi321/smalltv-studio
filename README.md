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

Under development. No release yet.

## Theme format

The `.stheme` format is defined by the smalltv-mod firmware and its packing and validation tools. The format and the tools are in review in [smalltv-mod pull request #15](https://github.com/giovi321/smalltv-mod/pull/15). A package built here has to pass that validator unchanged, so a theme that the editor accepts also installs on the device.

## Installing a theme on the device

1. Export the theme from the editor as a `.stheme` file
2. Open the device's web UI and go to the Display tab
3. Upload the file under the theme section and select it

An installed theme can make the device poll any URL listed in its manifest, including addresses on your LAN. Install themes only from sources you trust.

## Maintainers

- [kittyruntime](https://github.com/kittyruntime)
- [giovi321](https://github.com/giovi321)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[WTFPL](LICENSE).
