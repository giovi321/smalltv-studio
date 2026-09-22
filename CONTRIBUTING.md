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

## Commits

- Commit messages use `type(scope): summary`, for example `feat(export): ...`, `fix(preview): ...`, `docs(readme): ...`, `ci: ...`

## License

Contributions are released under the WTFPL, the same license as the rest of the repo.
