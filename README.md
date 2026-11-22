# paseo-plugins

[Paseo](https://paseo.sh) plugins, one per folder under `plugins/`.

| Plugin | What it does |
| --- | --- |
| [`ibm-bob-provider`](plugins/ibm-bob-provider) | Runs IBM Bob Shell as a Paseo agent over ACP, with an API key in the macOS Keychain, Bob team budgets in Usage, context-window data and terminal status |

## Layout

```text
paseo-plugins/
├─ package.json          npm workspaces (plugins/*), shared dev dependencies and scripts
├─ tsconfig.json         one typecheck for every plugin
├─ vitest.config.ts      runs plugins/**/*.test.ts
├─ .github/workflows/    CI: typecheck and tests
└─ plugins/<id>/
   ├─ paseo-plugin.json  manifest; id matches the folder name
   ├─ package.json       workspace package, no runtime dependencies
   ├─ OVERVIEW.md        listing text shown in Paseo
   ├─ index.server.ts    daemon entry (optional)
   ├─ index.client.tsx   app entry (optional)
   ├─ server/ client/ shared/
   └─ icon.svg / icon.png
```

Paseo provides `@getpaseo/plugin`, `zod`, `react`, `react-native` and `@tanstack/react-query` at runtime, so they are root dev dependencies used only for typechecking and tests. A plugin that needs another runtime dependency declares it in its own `package.json` and a `build` step in its manifest.

## Develop

```bash
npm install
npm run typecheck
npm test
```

Install a plugin from its folder on the daemon machine, then reload it after each edit:

```bash
paseo plugin install "$PWD/plugins/ibm-bob-provider"
paseo plugin reload ibm-bob-provider
paseo plugin logs ibm-bob-provider
```

Install from GitHub, without the registry:

```bash
paseo plugin add git:gillesdandrea/paseo-plugins:plugins/ibm-bob-provider
```

## Add a plugin

1. `paseo plugin init "$PWD/plugins/<id>"` to generate the entries and manifest.
2. Delete its generated `tsconfig.json` and move its dev dependencies to the root `package.json`, pinned to the same versions.
3. Set `requirements.paseo` to the oldest Paseo version whose APIs the plugin uses.
4. `npm install`, `npm run typecheck`, `npm test`.

## License

MIT
