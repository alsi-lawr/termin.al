# Live host configuration

Live mode connects the browser application to GitHub-backed content, sessions,
protected CV access, aggregate statistics, and owner publication. This guide
covers the host environment, GitHub App, session behavior, and reverse proxy
boundary.

For the expected repository data, see
[Content repository](content-repository.md). For NixOS service configuration,
see [NixOS operations](nixos-operations.md).

## Environment

.NET maps double underscores in environment variables to configuration
sections. A live environment file can start with these placeholders:

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

The three repository variables contain repository names rather than
`owner/name` pairs. `GitHub__Owner` supplies their common owner.

## GitHub App

Create a GitHub App whose callback URL exactly matches
`GitHub__App__CallbackUrl`, then install it for the configured owner and content
repository.

The publication code needs repository **Contents: read and write**. GitHub
includes read-only Metadata with every installation. The application does not
use Issues, Pull requests, or Actions, and it requests no email or other account
permissions. The OAuth request adds no scopes; identity resolution reads only
the authenticated user's numeric ID and login.

If `GitHub__ApiToken` is used for public content reads, give it read-only access
to only the configured repositories.

## Identity, sessions, and publication

Any authenticated GitHub identity becomes a viewer. Only the identity matching
`GitHub__OwnerId` receives owner publication and owner CV capability.

The host stores access and refresh capability in an HttpOnly, protected session
cookie. Its Data Protection keys must persist across restarts. `logout` removes
GitHub and shared-CV capabilities and closes CV presentation, but intentionally
retains local IndexedDB drafts.

Owner drafts remember the expected default branch, head, and document blob.
Publication re-reads those values, creates one commit, and advances only the
current default branch with a non-forced ref update. A stale branch, head, or
blob returns the latest upstream source and base; the editor presents
whole-document conflict markers for manual resolution. It never silently
overwrites or automatically merges upstream changes.

## Protected CV access

Generate a viewer key from the repository root:

```console
dotnet run --no-launch-profile --project host/src/Termin.Al.Host.fsproj -- generate-cv-key
```

The command prints the plaintext key once and a PBKDF2-SHA256 value for
`Cv__ViewerKeyHash`. Distribute the plaintext separately and store only the hash
in the environment file.

Enabling the hash also requires the Markdown source that the NixOS module
exposes read-only at the application's fixed `/run/secrets/termin.al-cv.md`
path.

To rotate access, generate another pair, replace `Cv__ViewerKeyHash`, distribute
the new plaintext, and restart the service. Sessions carrying the old key
fingerprint stop authorizing after the restart. CV text is read only after
authorization, kept in memory, excluded from statistics, and never logged.

## Reverse proxy

The service is intended to listen on loopback behind a TLS reverse proxy.
Forwarded headers remain ignored unless explicitly enabled with at least one
trusted proxy address or network:

```dotenv
ForwardedHeaders__Enabled=true
ForwardedHeaders__KnownProxies__0=127.0.0.1
# Or: ForwardedHeaders__KnownNetworks__0=10.0.0.0/24
```

Use the actual proxy address or network. Do not copy the examples without
checking the deployment topology.

Return to the [documentation guide](README.md).
