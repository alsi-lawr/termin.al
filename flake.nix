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
    in
    {
      nixosModules.default = import ./nix/module.nix { source = ./.; };

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
