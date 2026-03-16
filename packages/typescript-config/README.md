# @repo/typescript-config — Shared TypeScript Configurations

Shared `tsconfig` base files consumed by every package and app in the monorepo.

## Configs

| File | Purpose |
|---|---|
| `base.json` | Strict ESM base — `"module": "NodeNext"`, `noUncheckedIndexedAccess`, `strictNullChecks` |
| `nextjs.json` | Extends `base.json`; adds Next.js JSX and lib settings |
| `react-library.json` | Extends `base.json`; adds `"jsx": "react-jsx"` for React component packages |

## Usage

In any `tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "incremental": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

## Important Notes

- The base config sets `"incremental": false`. Override with `"incremental": true` in child configs (do **not** use `"composite": true` — it conflicts with the base setting and causes TS6379).
- All packages in this monorepo use `"type": "module"` (ESM). Import paths in source files must include the `.js` extension when referencing local files.
