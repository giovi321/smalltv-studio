# Contributing

## The firmware defines the format

The `.stheme` format belongs to [smalltv-mod](https://github.com/giovi321/smalltv-mod). This editor follows it and never extends it on its own.

- A package exported by the editor must pass the smalltv-mod validator unchanged
- A new layer type, variable, manifest field or container change lands in smalltv-mod first. The editor adds support after that change is merged there
- A pull request that changes export output states which smalltv-mod commit or release it was validated against

The reason is compatibility. If the editor and the firmware disagree on the format, users get themes that preview correctly and then fail to install, and nobody can tell which side is wrong.

## Testing

- Validate at least one exported package with the smalltv-mod tools before opening a pull request
- State whether the exported theme was installed on a device, and which device. A theme that was only validated is fine, an unstated one is not
- Keep bundled example themes reproducible: exporting the same project twice produces byte-identical `.stheme` files

## Code

- Match the layout and comment density of the surrounding code
- Keep unrelated changes in their own pull request
- Never commit credentials, API keys, or URLs with tokens in them, including inside example themes

## Pull requests

- `main` is protected. Every change goes through a pull request, including changes by the maintainers
- Force pushes to `main` and deleting it are blocked
- Rebase on `main` before merging, so the history stays linear

## Releases

- Only the maintainers cut releases, from `main`, never from a feature branch
- Versions follow semantic versioning and are tagged `vMAJOR.MINOR.PATCH`, for example `v0.3.1`
  - MAJOR: a `.stheme` file exported by the new version fails to install on firmware that accepted the previous version's output, or project files from the previous version no longer open
  - MINOR: new editor features or support for new format features that smalltv-mod has already merged
  - PATCH: fixes that change neither the export output nor the project file format
- Do not bump the version in a feature pull request. The maintainer bumps it in a separate commit on `main` at release time
- Every release is a GitHub release with notes that list the changes and name the smalltv-mod release the export output was validated against
- Before tagging, export the bundled example themes and validate them with the smalltv-mod tools for that release. Do not tag if any of them fails
- A published tag is never moved or deleted. A broken release is fixed by a new patch release

## Commits

- Commit messages use `type(scope): summary`, for example `feat(export): ...`, `fix(preview): ...`, `docs(readme): ...`, `ci: ...`

## License

Contributions are released under the WTFPL, the same license as the rest of the repo.
