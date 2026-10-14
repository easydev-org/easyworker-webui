# easyworker-webui

The control panel for **[easyworker](../easyworker)** — a thin Go client for the
easystream (native-a11y) daemon. Svelte 5 + Vite + Tailwind 4, served by the
worker from its own port, same-origin with the Connect RPC.

- a login gate (bearer token / one-time-code claim),
- a shell-style console with live output and **Detach**,
- mutually-exclusive Files (drag-drop upload) and Jobs (view/kill) drawers.

## Build

```sh
npm install && npm run build                  # -> ./dist
OUT_DIR=../easyworker/internal/webui/dist npm run build   # into the server's go:embed dir
```

The easyworker server embeds the built output via `//go:embed all:dist`
(`internal/webui/webui.go`). **dist is not committed** — the server's Containerfile
builds it from this repo in a dedicated stage.
