# termin.al

termin.al is a desktop-first terminal portfolio: public profile, project, note,
blog, activity, changelog and aggregate-statistics views share a browser terminal
with a virtual filesystem, panes, Markdown viewers and an owner-only Vim-style
publishing editor.

The application has two modes:

- **Demo** (`/demo`) uses deterministic synthetic content in the browser. It
  performs no OAuth, host, GitHub or other external I/O, and rejects writes.
- **Live** (`/`) uses the F# host for GitHub-backed content, sessions, CV access,
  statistics and owner publication through generated binary gRPC-Web clients.

## Explore the terminal

Run `help` for the live command index and `man <command>` for the maintained
manual. The current commands are:

- portfolio: `about`, `skills`, `tools`, `projects`, `blog`, `notes`, `now`,
  `changelog`, `cv`, `stats`;
- virtual filesystem and text: `pwd`, `cd`, `ls`, `tree`, `find`, `cat`, `head`,
  `tail`, `grep`, `sed`, `echo`;
- presentation: `open`, `less`, `man`, `help`, `history`, `clear`, `theme`;
- identity and authoring: `login`, `logout`, `whoami`, `edit`;
- workspace: `pane`.

Shell panes have independent working directories and scrollback. Commands
support the bounded pipelines, redirection, virtual-path globs and completion
implemented by the browser shell; redirected files live in a browser-persistent
overlay, never the visitor's host filesystem.

`pane split`, `focus`, `select`, `resize`, `close`, `zoom`, `swap`, `rotate` and
`layout` manage the in-memory pane tree. `Ctrl+b` starts pane key bindings. Pane
layout and pane-local state do not survive a reload.

Owners open a publication with `edit blog/<path>/<slug>.md` or
`edit notes/<path>/<slug>.md`. The editor implements a practical Vim subset:
normal, insert, visual-character, visual-line and visual-block modes; counts;
motions and text objects; delete/change/yank and put; marks; search; substitution;
and undo/redo. Its application commands are `:w`, `:q`, `:q!`, `:wq`,
`:preview`, `:asset`, `:publish` and `:remove`. This is not a complete Vim
emulator.

The supported experience is desktop-first. Narrow-screen controls exist for
basic navigation, but mobile parity is not a product guarantee.

## Develop

The flake pins the development toolchain on `x86_64-linux`: Bun `1.3.13`, .NET
SDK `10.0.301`, Fantomas, Git and groff `1.24.1`.

```console
nix develop
cd ui
bun install --frozen-lockfile
cd ..
dotnet restore host/termin.al.slnx
```

Start the self-contained demo frontend on `http://127.0.0.1:5173`:

```console
cd ui
bun run dev
```

For live development, start the host on port 5000 and Vite's live-mode server
on port 5173 in separate shells. Vite proxies the OAuth and gRPC-Web paths to
the host.

```console
# shell 1, after configuring the host environment described below
dotnet run --project host/src/Termin.Al.Host.fsproj

# shell 2
cd ui
bun run dev:live
```

Build the frontend before the host because the host project publishes
`ui/dist` as `wwwroot`:

```console
cd ui
bun run build
cd ..
dotnet build host/termin.al.slnx
```

Run the maintained checks directly:

```console
# browser unit tests and lint
cd ui
bun run test
bun run lint

# generated artifacts
bun run grpc:check
bun run manpages:check
bun run highlighting:check

# return to the repository root for host tests and F# formatting
cd ..
dotnet run --project host/test/Termin.Al.Host.Tests.fsproj
fantomas --check host/src host/test
```

Apply F# formatting with `fantomas host/src host/test`. Update maintained
browser artifacts with `bun run grpc:generate` after changing
`contracts/browser.proto`, and `bun run manpages:generate` after changing
`man/*.1`; commit the generated files with their sources. `bun run build` also
runs all three generated-artifact checks before TypeScript and Vite.

The real-browser demo smoke requires a Chrome-compatible `google-chrome` (or
`CHROME_BIN`) and a separately running preview:

```console
# shell 1
cd ui
bun run build
bun run preview

# shell 2
cd ui
TERMINAL_SMOKE_BASE_URL=http://127.0.0.1:5175 bun run smoke:demo
```

## Live content repositories

The live host combines four repositories under one configured GitHub owner:

- the **content repository** supplies the catalog, page/publication Markdown,
  project curation and owner publication target;
- the **application repository** supplies the `now` summary fallback and
  changelog releases/commit ancestry; public owner activity supplies the
  activity line;
- the **profile repository** supplies an optional profile `README.md`, used as
  the `about` fallback and as another `now` summary source;
- public owner repositories supply project metadata and optional READMEs.

Repository settings are names, not `owner/name` pairs; `GitHub__Owner` supplies
the owner.

### Content repository layout

```text
content/
  catalog.json
  projects.json
  <page>.md
blog/
  <any traversal-free subdirectories>/<canonical-slug>.md
notes/
  <any traversal-free subdirectories>/<canonical-slug>.md
assets/
  blog/<same document hierarchy without .md>/<image>
  notes/<same document hierarchy without .md>/<image>
```

`content/catalog.json` is the virtual-filesystem authority. Its root contains
only `entries`. Directory and locked-file entries contain `kind`, `id`, `path`,
`updatedAt` and `size`; file entries additionally contain `documentHandle` and
`sourcePath`. Paths are canonical `~`-rooted virtual paths, source paths are
repository-relative, and timestamps use UTC millisecond precision.

```json
{
  "entries": [
    {
      "kind": "file",
      "id": "note-example",
      "path": "~/notes/runtime/example.md",
      "updatedAt": "2026-01-01T12:00:00.000Z",
      "size": 256,
      "documentHandle": "note-example",
      "sourcePath": "notes/runtime/example.md"
    }
  ]
}
```

`content/projects.json` contains a `projects` array. Each curated project has
exactly `id`, `slug`, `name`, `summary`, `url`, `repository`, `collectionPath`,
`updatedAt` and `tags`. The host also considers up to six uncurated public,
owner-held, non-fork, non-archived repositories. A project README is optional;
the project remains visible with `No README found.` when one is absent.

Catalog and project manifests accept at most 100 entries each, and a Markdown
document is limited to 1 MiB. Content IDs and canonical slugs are limited to 64
characters; titles to 200, summaries to 500 and individual tags to 128.

Page Markdown requires only a quoted `title` field. Recursive `blog/` and
`notes/` publications require exactly the ini-style fields below; unknown or
duplicate fields are rejected.

```markdown
---
title = "Example"
summary = "Example summary."
tags = ["fsharp", "typescript"]
---

# Example
```

The filename determines the canonical slug and the root determines blog versus
note. There is no publication timestamp in front matter. Ordering and display
use the catalog entry's `updatedAt`; owner publication writes that timestamp,
the Markdown, matching catalog entry and staged assets in the same Git commit.

PNG, JPEG, WebP and GIF assets mirror the complete recursive document path.
Removing a publication removes its Markdown and catalog entry but deliberately
leaves its asset directory. The changelog is not a content-repository file: it
is assembled from the application repository's published releases, tags and
commit ancestry.

## Host configuration and GitHub App

.NET maps double underscores in environment variables to configuration
sections. A live environment file can start with the following placeholders:

```dotenv
GitHub__Owner=<github-owner>
GitHub__ContentRepository=<content-repository-name>
GitHub__ApplicationRepository=<application-repository-name>
GitHub__ProfileRepository=<profile-repository-name>

# Optional for higher GitHub API limits; omit the line for anonymous public reads.
GitHub__ApiToken=<read-only-content-token>

# Configure all five lines together to enable GitHub authentication.
GitHub__App__ClientId=<github-app-client-id>
GitHub__App__ClientSecret=<github-app-client-secret>
GitHub__App__CallbackUrl=https://<public-host>/api/auth/github/callback
GitHub__OwnerId=<numeric-github-owner-id>
Application__PublicOrigin=https://<public-host>

# Optional protected CV access.
Cv__ViewerKeyHash=<generated-viewer-key-hash>
```

Remove optional placeholder lines rather than deploying them literally. Keep
the environment file root-readable and out of version control.

Create a GitHub App whose callback URL exactly matches
`GitHub__App__CallbackUrl`, then install it for the configured owner and content
repository. The publication code needs repository **Contents: read and write**;
GitHub includes read-only Metadata with every installation. It does not use
Issues, Pull requests or Actions, and it requests no email or other account
permissions. The OAuth request adds no scopes; identity resolution reads only
the authenticated user's numeric ID and login. If `GitHub__ApiToken` is used
for public content reads, give it read-only access to only the configured
repositories.

Any authenticated GitHub identity becomes a viewer. Only the identity matching
`GitHub__OwnerId` receives owner publication and owner CV capability. The host
stores access/refresh capability in an HttpOnly, protected session cookie; its
Data Protection keys must persist across restarts. `logout` removes GitHub and
shared-CV capabilities and closes CV presentation, but intentionally retains
local IndexedDB drafts.

Owner drafts remember the expected default branch, head and document blob.
Publication re-reads those values, creates one commit, and advances only the
current default branch with a non-forced ref update. A stale branch, head or
blob returns the latest upstream source and base; the editor presents
whole-document conflict markers for manual resolution. It never silently
overwrites or automatically merges upstream changes.

### Reverse proxies

The service is intended to listen on loopback behind a TLS reverse proxy.
Forwarded headers remain ignored unless explicitly enabled with at least one
trusted proxy address or network:

```dotenv
ForwardedHeaders__Enabled=true
ForwardedHeaders__KnownProxies__0=127.0.0.1
# Or: ForwardedHeaders__KnownNetworks__0=10.0.0.0/24
```

Use the actual proxy address or network; do not copy those examples without
checking the deployment topology.

## CV access

Generate a new viewer key from the repository root:

```console
dotnet run --no-launch-profile --project host/src/Termin.Al.Host.fsproj -- generate-cv-key
```

The command prints the plaintext key once and a PBKDF2-SHA256 value for
`Cv__ViewerKeyHash`. Distribute the plaintext separately; store only the hash in
the environment file. Enabling the hash also requires the Markdown source that
the NixOS module exposes read-only at the application's fixed
`/run/secrets/termin.al-cv.md` path.

To rotate access, generate another pair, replace `Cv__ViewerKeyHash`, distribute
the new plaintext, and restart the service. Sessions carrying the old key
fingerprint stop authorizing after the restart. CV text is read only after
authorization, kept in memory, excluded from statistics and never logged.

## Statistics

Statistics contain aggregate total sessions, total page views, per-content-ID
counts and 400 UTC daily buckets. The session identifier is a random 128-bit
HttpOnly, SameSite cookie; the statistics store contains no GitHub identity,
CV key, IP address or user-agent value. Only catalog/project content IDs are
accepted, and a content ID is counted at most once per active session state.
CV views are not counted.

The NixOS service persists the snapshot at
`/var/lib/termin.al/stats/statistics.json`. Invalid or unwritable storage makes
statistics unavailable rather than replacing it with guessed data.

## NixOS deployment

Consume this repository directly as a flake input and import its sole deployment
interface, `nixosModules.default`:

```nix
{
  inputs.termin-al.url = "github:<source-owner>/<source-repository>";

  outputs = { nixpkgs, termin-al, ... }: {
    nixosConfigurations.<host> = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        termin-al.nixosModules.default
        {
          services.termin-al = {
            enable = true;
            listenAddress = "127.0.0.1";
            port = 5000;
            environmentFile = "/run/secrets/termin-al.env";
            cvFile = "/run/secrets/termin-al-cv-source.md";
          };
        }
      ];
    };
  };
}
```

These are all five module options. `environmentFile` and `cvFile` are optional
absolute runtime paths; omit `cvFile` when CV access is disabled. Ports are
limited to 1024–65535. The service does not open a firewall port, configure DNS,
terminate TLS or create a reverse proxy.

Create runtime inputs without placing their contents in the Nix store:

```console
sudo install -o root -g root -m 0400 ./termin-al.env /run/secrets/termin-al.env
sudo install -o root -g root -m 0400 ./cv.md /run/secrets/termin-al-cv-source.md
sudo nixos-rebuild switch --flake .#<host>
```

systemd reads the environment file and stages the root-only CV source as a
read-only service credential for the dynamic service user. Mutable state is
outside the Nix store:

- `/var/lib/termin.al/data-protection-keys` — protected auth/CV session keys;
- `/var/lib/termin.al/stats` — aggregate statistics.

### Backup and restore

Back up the complete state directory while the service is stopped. With
`DynamicUser`, `/var/lib/termin.al` may resolve into `/var/lib/private`:

```console
sudo systemctl stop termin-al
state=$(sudo readlink -f /var/lib/termin.al)
sudo tar --acls --xattrs --numeric-owner -C "$(dirname "$state")" \
  -cpf /path/to/termin-al-state.tar "$(basename "$state")"
sudo systemctl start termin-al
```

For restore, stop the service, move the current resolved directory aside, and
extract the archive into its parent before starting the service. Keep the old
directory until liveness, readiness, login and statistics have been checked.
The runtime environment file and CV source are separate secrets and need their
own backup process.

```console
sudo systemctl stop termin-al
state=$(sudo readlink -f /var/lib/termin.al)
sudo mv "$state" "${state}.before-restore"
sudo tar --acls --xattrs --numeric-owner -C "$(dirname "$state")" \
  -xpf /path/to/termin-al-state.tar
sudo systemctl start termin-al
```

`GET /healthz` is dependency-free process liveness. `GET /readyz` checks the
required production configuration and GitHub-backed public catalog; use both
after deployment or restore.

## Limits and non-goals

- The application is single-instance and `x86_64-linux`; shared cache/state
  coordination is not implemented.
- The browser application protocol is binary unary gRPC-Web generated from
  `contracts/browser.proto`. There is no parallel REST/JSON application API,
  SSE/WebSocket transport, or client/server streaming simulation. Ordinary HTTP
  remains only for static delivery, OAuth redirects and health endpoints.
- Demo mode is read-only and synthetic. It is not a publication sandbox or a
  recovery test for external integrations.
- Content and GitHub infrastructure failures surface through readiness and the
  existing unavailable/conflict states; the application does not manufacture
  automatic merges or integration recovery.
- The deployment module deliberately leaves TLS, proxy, firewall, secret
  provisioning and backup scheduling to the operator.
