{ source }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.termin-al;
  application = import ./application.nix {
    inherit lib pkgs source;
  };
  stateDirectory = "/var/lib/termin.al";
  cvPath = "/run/secrets/termin.al-cv.md";
  listenHost =
    if lib.hasInfix ":" cfg.listenAddress then "[${cfg.listenAddress}]" else cfg.listenAddress;
in
{
  options.services.termin-al = {
    enable = lib.mkEnableOption "termin.al";

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address on which the termin.al HTTP service listens.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 5000;
      description = "Port on which the termin.al HTTP service listens.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/secrets/termin-al.env";
      description = ''
        Absolute runtime environment file containing application configuration
        and secrets. The file is read by systemd and is not copied to the Nix store.
      '';
    };

    cvFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/secrets/termin-al-cv-source.md";
      description = ''
        Absolute runtime path to the optional CV document. systemd bind-mounts
        it read-only at ${cvPath}; the source is not copied to the Nix store.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = pkgs.stdenv.hostPlatform.system == "x86_64-linux";
        message = "services.termin-al currently supports x86_64-linux only.";
      }
      {
        assertion = cfg.environmentFile == null || lib.hasPrefix "/" cfg.environmentFile;
        message = "services.termin-al.environmentFile must be an absolute runtime path.";
      }
      {
        assertion = cfg.cvFile == null || lib.hasPrefix "/" cfg.cvFile;
        message = "services.termin-al.cvFile must be an absolute runtime path.";
      }
    ];

    systemd.services.termin-al = {
      description = "termin.al terminal portfolio";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        ASPNETCORE_ENVIRONMENT = "Production";
        ASPNETCORE_URLS = "http://${listenHost}:${toString cfg.port}";
        DOTNET_EnableDiagnostics = "0";
        Stats__DataPath = "${stateDirectory}/stats";
      };

      serviceConfig = {
        Type = "simple";
        ExecStart = "${pkgs.dotnetCorePackages.aspnetcore_10_0}/bin/dotnet ${application}/lib/termin-al/Termin.Al.Host.dll";
        WorkingDirectory = "${application}/lib/termin-al";
        Restart = "on-failure";
        RestartSec = "5s";
        TimeoutStopSec = "30s";

        DynamicUser = true;
        StateDirectory = [
          "termin.al/data-protection-keys"
          "termin.al/stats"
        ];
        StateDirectoryMode = "0700";
        UMask = "0077";

        EnvironmentFile = lib.optional (cfg.environmentFile != null) cfg.environmentFile;
        BindReadOnlyPaths = lib.optional (cfg.cvFile != null) "${cfg.cvFile}:${cvPath}";

        CapabilityBoundingSet = "";
        LockPersonality = true;
        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RemoveIPC = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        SystemCallArchitectures = "native";
      };
    };
  };
}
