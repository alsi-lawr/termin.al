# Content repository

The live host combines four repository sources under one configured GitHub
owner:

- the **content repository** supplies the catalog, page and publication
  Markdown, project curation, and owner publication target;
- the **application repository** supplies the `now` summary fallback and
  changelog releases and commit ancestry; public owner activity supplies the
  activity line;
- the **profile repository** supplies an optional profile `README.md`, used as
  the `about` fallback and as another `now` summary source;
- public owner repositories supply project metadata and optional READMEs.

Repository settings are names, not `owner/name` pairs. `GitHub__Owner` supplies
the owner. See [Live host configuration](live-configuration.md) for the related
environment variables.

## Layout

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

## Catalog

`content/catalog.json` is the virtual-filesystem authority. Its root contains
only `entries`. Directory and locked-file entries contain `kind`, `id`, `path`,
`updatedAt`, and `size`; file entries additionally contain `documentHandle` and
`sourcePath`.

Paths are canonical `~`-rooted virtual paths, source paths are
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

## Curated projects

`content/projects.json` contains a `projects` array. Each curated project has
exactly `id`, `slug`, `name`, `summary`, `url`, `repository`, `collectionPath`,
`updatedAt`, and `tags`.

The host also considers up to six uncurated public, owner-held, non-fork,
non-archived repositories. A project README is optional; the project remains
visible with `No README found.` when one is absent.

## Markdown and front matter

Page Markdown requires only a quoted `title` field. Recursive `blog/` and
`notes/` publications require exactly the ini-style fields below. Unknown or
duplicate fields are rejected.

```markdown
---
title = "Example"
summary = "Example summary."
tags = ["fsharp", "typescript"]
---

# Example
```

The filename determines the canonical slug and the repository root determines
blog versus note. There is no publication timestamp in front matter. Ordering
and display use the catalog entry's `updatedAt`.

Owner publication writes the timestamp, Markdown, matching catalog entry, and
staged assets in the same Git commit.

## Publication assets and removal

PNG, JPEG, WebP, and GIF assets mirror the complete recursive document path.
Removing a publication removes its Markdown and catalog entry but deliberately
leaves its asset directory.

The changelog is not a content-repository file. It is assembled from the
application repository's published releases, tags, and commit ancestry.

## Validation limits

- Catalog and project manifests accept at most 100 entries each.
- A Markdown document is limited to 1 MiB.
- Content IDs and canonical slugs are limited to 64 characters.
- Titles are limited to 200 characters and summaries to 500.
- Each tag is limited to 128 characters.

Return to the [documentation guide](README.md).
