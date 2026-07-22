# Contributing to termin.al

Thank you for improving termin.al. This guide covers the repository development
workflow. Live-host configuration and operations belong in the linked operator
documentation rather than in local development setup.

## Development environment

The Nix flake pins the supported toolchain on `x86_64-linux`: Bun `1.3.13`,
.NET SDK `10.0.301`, Fantomas, Git, and groff `1.24.1`.

```console
nix develop
cd ui
bun install --frozen-lockfile
cd ..
dotnet restore host/termin.al.slnx
```

The repository contains these main areas:

- `ui/` — React and TypeScript browser application;
- `host/` — F#/.NET live host and host tests;
- `contracts/` — browser gRPC-Web protocol source;
- `man/` — roff sources for the browser command manual;
- `scripts/` — generated-artifact and browser-smoke tooling;
- `nix/` — package and NixOS service module.

## Run locally

Start the self-contained demo frontend on `http://127.0.0.1:5173`:

```console
cd ui
bun run dev
```

Live development uses two shells. Configure the host as described in
[Live host configuration](docs/live-configuration.md), then start the host on
port 5000 and Vite on port 5173. Vite proxies OAuth and gRPC-Web paths to the
host.

```console
# shell 1
dotnet run --project host/src/Termin.Al.Host.fsproj

# shell 2
cd ui
bun run dev:live
```

## Build

Build the frontend before the host. The host project publishes `ui/dist` as
`wwwroot`.

```console
cd ui
bun run build
cd ..
dotnet build host/termin.al.slnx
```

The frontend build also checks all generated browser artifacts before running
TypeScript and Vite.

## Test, lint, and format

Run the checks relevant to the files you change:

```console
# Browser unit tests and lint
cd ui
bun run test
bun run lint

# Generated artifacts
bun run grpc:check
bun run manpages:check
bun run highlighting:check

# Host tests and F# formatting, from the repository root
cd ..
dotnet run --project host/test/Termin.Al.Host.Tests.fsproj
fantomas --check host/src host/test
```

Apply F# formatting with:

```console
fantomas host/src host/test
```

The real-browser demo smoke test requires a Chrome-compatible `google-chrome`,
or a compatible executable selected with `CHROME_BIN`, and a separately running
preview:

```console
# shell 1
cd ui
bun run build
bun run preview

# shell 2
cd ui
TERMINAL_SMOKE_BASE_URL=http://127.0.0.1:5175 bun run smoke:demo
```

## Generated artifacts

Generated browser files are maintained in the repository. Update and commit
them with the source that caused the change:

- after changing `contracts/browser.proto`, run `cd ui && bun run grpc:generate`;
- after changing `man/*.1`, run `cd ui && bun run manpages:generate`;
- generated highlighting assets are checked with
  `cd ui && bun run highlighting:check`.

Do not hand-edit generated output. `bun run build` runs `grpc:check`,
`manpages:check`, and `highlighting:check`, so stale artifacts fail the build.

## Contribution expectations

- Keep changes focused on one coherent outcome and avoid unrelated cleanup.
- Preserve the distinction between deterministic, read-only demo behavior and
  GitHub-backed live behavior.
- Add or update focused tests when behavior changes, and report the checks you
  actually ran.
- Keep commands and manual pages aligned; regenerate maintained artifacts when
  their sources change.
- Never commit tokens, GitHub App credentials, CV keys, environment files, or
  other deployment secrets.
- Treat public protocol, content-schema, persistence, authentication, and
  deployment changes as compatibility-sensitive and document their impact.

For system behavior and deliberate boundaries, see
[Architecture and limits](docs/architecture-and-limits.md). For content schema
work, see [Content repository](docs/content-repository.md).
