# poe-dat-viewer

Path of Exile .dat file viewer

https://snosme.github.io/poe-dat-viewer

- Supports .datc64 files from PoE1 & PoE2
- Can upload file from PC or import from PoE patch server
- Performs file analysis to find possible columns

![](./viewer/src/assets/showcase.png?raw=true)

## Exporting game data

Visit another [README.md file](./lib/README.md) in the lib directory.

## Deploying to Netlify

This repository includes a root `netlify.toml` so Netlify settings can stay versioned in git.

- Base directory: `viewer`
- Build command: `npm run build`
- Publish directory: `dist`
- Node.js version: `22.12.0`

Why the `base` setting matters:

- The deployable Vite app lives in `viewer/`
- The repository root does not contain the frontend `package.json`

Recommended Netlify setup:

1. Import this Git repository into Netlify.
2. Do not override the build settings in the UI unless you intentionally want different behavior.
3. Let Netlify read `netlify.toml` from the repository root.

The config also includes a SPA fallback redirect so direct visits to app URLs still serve `index.html`.

## Related projects

| Name | Language |
|------|----------|
| [PyPoE](https://github.com/Project-Path-of-Exile-Wiki/PyPoE) | Python |
| [pogo](https://github.com/oriath-net/pogo) | Go |
| [LibGGPK3](https://github.com/aianlinb/LibGGPK3) | C# |
