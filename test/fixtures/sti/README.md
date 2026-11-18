# STI test files

Copied from [smalltv-mod](https://github.com/giovi321/smalltv-mod), `tests/theme/sti/`, at commit
`8ce11539761f7d877d59969291900ce83c088066` (the folder last changed in `f36d144387af01da7714bf8c5b5d9af6d09eb676`).
`make.py` is left out; it needs the firmware's packer.

Two source images, each in STI1 and in both forms of STI2 (runs of colors, runs of palette indices).
`expected.json` gives each file's `width`, `height` and every pixel in row order as `[RGB565, alpha]`, a
fully transparent pixel as `[0, 0]`. `test/sti2.test.ts` decodes every file to exactly those pixels and
checks that the encoder writes the same bytes back.

To update them, copy the folder again from the smalltv-mod commit the change was validated against and
change the commit named here.
