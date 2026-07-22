# Architecture and limits

termin.al is a browser terminal with two deliberately different runtime modes.

## Runtime modes

### Demo

`/demo` uses deterministic synthetic content entirely in the browser. It makes
no OAuth, host, GitHub, or other external requests, and all writes are rejected.
It is an interface demonstration, not a publication sandbox or a recovery test
for external integrations.

### Live

`/` uses the F# host for GitHub-backed content, sessions, protected CV access,
aggregate statistics, and owner publication. Generated clients connect the
browser to the host using binary unary gRPC-Web.

## Browser boundary

The browser application protocol is generated from
`contracts/browser.proto`. There is no parallel REST/JSON application API,
SSE/WebSocket transport, or client/server streaming simulation. Ordinary HTTP
is used only for static delivery, OAuth redirects, and health endpoints.

The virtual shell supports only the bounded pipelines, redirection,
virtual-path globs, and completion implemented by the browser application.
Redirected files live in a browser-persistent overlay and never reach the
visitor's host filesystem.

Shell panes have independent working directories and scrollback. Pane layout
and pane-local state are in-memory and do not survive a reload.

## Authoring boundary

Owners open publications with `edit blog/<path>/<slug>.md` or
`edit notes/<path>/<slug>.md`. The editor supports normal, insert,
visual-character, visual-line, and visual-block modes; counts; motions and text
objects; delete, change, yank, and put; marks; search; substitution; and
undo/redo.

Its application commands are `:w`, `:q`, `:q!`, `:wq`, `:preview`, `:asset`,
`:publish`, and `:remove`. This is a practical subset, not a complete Vim
emulator.

Publication uses optimistic Git state and a non-forced default-branch update.
Content and GitHub failures surface through readiness and the existing
unavailable or conflict states; the application does not manufacture automatic
merges or integration recovery. See
[Live host configuration](live-configuration.md) for the publication and
session details.

## Deployment boundary

- The supported deployment is single-instance `x86_64-linux`; shared cache and
  state coordination are not implemented.
- The supported user experience is desktop-first. Narrow-screen controls exist
  for basic navigation, but mobile parity is not guaranteed.
- The NixOS module leaves TLS, proxy, firewall, secret provisioning, and backup
  scheduling to the operator.

See [NixOS operations](nixos-operations.md) for the concrete deployment
interface.

Return to the [documentation guide](README.md).
