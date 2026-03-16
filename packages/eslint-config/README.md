# @repo/eslint-config — Shared ESLint Configurations

Shared ESLint flat-config presets used across all packages and apps in the monorepo.

## Configs

| File | Extends | Use in |
|---|---|---|
| `base.js` | `eslint:recommended`, `typescript-eslint` | All TypeScript packages |
| `next.js` | `base.js`, `next/core-web-vitals` | `apps/web` |
| `react-internal.js` | `base.js`, `plugin:react/recommended` | React component packages |

## Usage

In any `eslint.config.js` (or `eslint.config.mjs`):

```js
import { base } from "@repo/eslint-config/base";

export default [...base];
```

For Next.js apps:

```js
import { nextConfig } from "@repo/eslint-config/next";

export default [...nextConfig];
```
