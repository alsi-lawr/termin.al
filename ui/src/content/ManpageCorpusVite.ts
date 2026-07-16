import manifest from "../generated/manpages-manifest.json";
import { createManpageCorpus, type ManpageCorpus } from "./ManpageCorpus.ts";

const generatedModules = import.meta.glob<string>(
  "../generated/manpages/*.txt",
  {
    eager: true,
    import: "default",
    query: "?raw",
  },
);

function canonicalName(path: string): string {
  const match = /\/([^/]+)\.txt$/u.exec(path);
  const name = match?.[1];

  if (name === undefined) {
    throw new Error(`Unexpected generated manpage module path: ${path}.`);
  }

  return name;
}

function generatedArtifacts(): ReadonlyMap<string, string> {
  const artifacts = new Map<string, string>();

  for (const [path, text] of Object.entries(generatedModules)) {
    const name = canonicalName(path);

    if (artifacts.has(name)) {
      throw new Error(`Generated manpage module is duplicated for ${name}.`);
    }

    artifacts.set(name, text);
  }

  return artifacts;
}

export const generatedManpageCorpus: ManpageCorpus = createManpageCorpus({
  manifest,
  artifacts: generatedArtifacts(),
});
