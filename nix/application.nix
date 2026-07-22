{
  lib,
  pkgs,
  source,
}:
let
  fileset = lib.fileset;

  dependencySource = fileset.toSource {
    root = source;
    fileset = fileset.unions [
      (source + /ui/bun.lock)
      (source + /ui/bunfig.toml)
      (source + /ui/package.json)
      (source + /ui/patches)
    ];
  };

  bunDependencies = pkgs.stdenvNoCC.mkDerivation {
    pname = "termin-al-bun-dependencies";
    version = "0.0.0";
    src = dependencySource;

    nativeBuildInputs = [
      pkgs.bun
      pkgs.cacert
    ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild
      export HOME="$TMPDIR"
      cd ui
      bun install --frozen-lockfile --ignore-scripts
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      cp -R node_modules "$out"
      runHook postInstall
    '';

    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-L9bet/EnjxS/6JaZsXalD026UAUBvowmO/nzeLMKPBM=";
  };

  fetchNupkg = pkgs.dotnetCorePackages.fetchNupkg;
  grpcTools = fetchNupkg {
    pname = "Grpc.Tools";
    version = "2.82.0";
    hash = "sha256-5yYsikQ12205O5Gd5LoUELbO0xhm35joNFb5Accygz4=";
  };

  applicationSource = fileset.toSource {
    root = source;
    fileset = fileset.unions [
      (source + /global.json)
      (source + /contracts)
      (source + /host/src)
      (source + /man)
      (source + /scripts/generate-browser-grpc.ts)
      (source + /scripts/generate-highlighting-assets.ts)
      (source + /scripts/generate-manpages.ts)
      (source + /ui)
    ];
  };
in
pkgs.buildDotnetModule {
  pname = "termin-al";
  version = "0.0.0";
  src = applicationSource;

  projectFile = "host/src/Termin.Al.Host.fsproj";
  nugetDeps = ./nuget-deps.json;
  dotnet-sdk = pkgs.dotnet-sdk_10;
  dotnet-runtime = pkgs.dotnetCorePackages.aspnetcore_10_0;
  useAppHost = false;
  executables = [ ];

  nativeBuildInputs = [
    pkgs.bun
    pkgs.groff
    pkgs.nodejs
  ];

  preBuild = ''
    cp -R ${bunDependencies} ui/node_modules
    chmod -R u+w ui/node_modules
    patchShebangs ui/node_modules
    (cd ui && NUGET_PACKAGES=${grpcTools}/share/nuget/packages bun run build)
  '';

  meta = {
    description = "termin.al terminal portfolio host";
    platforms = [ "x86_64-linux" ];
  };
}
