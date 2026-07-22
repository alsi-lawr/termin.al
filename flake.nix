{
  description = "termin.al";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      application = import ./nix/application.nix {
        inherit pkgs;
        inherit (pkgs) lib;
        source = ./.;
      };
    in
    {
      packages.${system} = {
        default = application;
        termin-al = application;
      };

      nixosModules.default = import ./nix/module.nix { inherit self; };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          bun
          dotnet-sdk_10
          fantomas
          git
          groff
        ];
      };
    };
}
