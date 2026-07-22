# NixOS operations

The repository exposes one deployment interface: `nixosModules.default` for
`x86_64-linux`.

## Deploy

Consume the repository as a flake input and import the module:

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

These are all five module options:

| Option | Default | Meaning |
| --- | --- | --- |
| `enable` | `false` | Enable the service. |
| `listenAddress` | `"127.0.0.1"` | HTTP listen address. |
| `port` | `5000` | HTTP port, limited to 1024–65535. |
| `environmentFile` | `null` | Optional absolute runtime environment-file path. |
| `cvFile` | `null` | Optional absolute runtime CV Markdown path. |

Omit `cvFile` when protected CV access is disabled. The module does not open a
firewall port, configure DNS, terminate TLS, create a reverse proxy, or
provision secrets.

Create runtime inputs without placing their contents in the Nix store:

```console
sudo install -o root -g root -m 0400 ./termin-al.env /run/secrets/termin-al.env
sudo install -o root -g root -m 0400 ./cv.md /run/secrets/termin-al-cv-source.md
sudo nixos-rebuild switch --flake .#<host>
```

systemd reads the environment file and stages the root-only CV source as a
read-only service credential for the dynamic service user. See
[Live host configuration](live-configuration.md) for the environment and CV
requirements.

## Mutable state

Mutable state remains outside the Nix store:

- `/var/lib/termin.al/data-protection-keys` — protected auth and CV session
  keys;
- `/var/lib/termin.al/stats` — aggregate statistics.

The service is single-instance; shared cache and state coordination are not
implemented.

## Statistics

Statistics contain aggregate total sessions, total page views, per-content-ID
counts, and 400 UTC daily buckets. The session identifier is a random 128-bit
HttpOnly, SameSite cookie. The statistics store contains no GitHub identity, CV
key, IP address, or user-agent value.

Only catalog and project content IDs are accepted, and a content ID is counted
at most once per active session state. CV views are not counted.

The NixOS service persists the snapshot at
`/var/lib/termin.al/stats/statistics.json`. Invalid storage with no recoverable
snapshot makes statistics unavailable rather than replacing it with guessed
data. A valid snapshot that becomes unwritable remains readable as `STALE` but
cannot record new views.

## Health checks

- `GET /healthz` is dependency-free process liveness.
- `GET /readyz` checks required production configuration and the GitHub-backed
  public catalog.

Use both after a deployment or restore.

## Backup

Back up the complete state directory while the service is stopped. With
`DynamicUser`, `/var/lib/termin.al` may resolve into `/var/lib/private`:

```console
sudo systemctl stop termin-al
state=$(sudo readlink -f /var/lib/termin.al)
sudo tar --acls --xattrs --numeric-owner -C "$(dirname "$state")" \
  -cpf /path/to/termin-al-state.tar "$(basename "$state")"
sudo systemctl start termin-al
```

The runtime environment file and CV source are separate secrets and need their
own backup process.

## Restore

Stop the service, move the current resolved directory aside, and extract the
archive into its parent before starting the service:

```console
sudo systemctl stop termin-al
state=$(sudo readlink -f /var/lib/termin.al)
sudo mv "$state" "${state}.before-restore"
sudo tar --acls --xattrs --numeric-owner -C "$(dirname "$state")" \
  -xpf /path/to/termin-al-state.tar
sudo systemctl start termin-al
```

Keep the old directory until liveness, readiness, login, and statistics have
been checked.

Return to the [documentation guide](README.md).
