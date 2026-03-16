# @repo/ui — Shared UI Components

Shared React component library used by `apps/web` and any future frontend applications.

## Components

| Component | Description |
|---|---|
| `Button` | Primary / secondary / ghost variants with loading state |
| `Card` | Container with consistent border, shadow, and padding |
| `Code` | Inline or block code display with monospace font |

## Usage

```tsx
import { Button, Card, Code } from "@repo/ui";

export default function Example() {
  return (
    <Card>
      <Code>npm run dev</Code>
      <Button variant="primary" onClick={() => {}}>
        Launch Agent
      </Button>
    </Card>
  );
}
```

## Adding Components

Place new components in `src/` and export them from `src/index.tsx`. The package is consumed directly from source by Next.js (no separate build step required) via the Turborepo `transpilePackages` setting in `apps/web/next.config.js`.
