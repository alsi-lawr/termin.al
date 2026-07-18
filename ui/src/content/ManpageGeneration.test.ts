import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runManpageGeneration } from "../../../scripts/generate-manpages.ts";

const repositoryRoot = new URL("../../../", import.meta.url);
const sourceDirectory = new URL("man/", repositoryRoot);

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "termin-al-manpages-"));
  const fixtureSources = join(root, "man");
  mkdirSync(fixtureSources, { recursive: true });

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".1")) {
      copyFileSync(new URL(entry.name, sourceDirectory), join(fixtureSources, entry.name));
    }
  }

  return root;
}

function withFixture(run: (root: string) => void): void {
  const root = fixtureRoot();

  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function containsUnsafeControl(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      return true;
    }

    if (
      codePoint < 10 ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159)
    ) {
      return true;
    }
  }

  return false;
}

test("generates an exact deterministic safe 33-manual corpus and manifest", () => {
  withFixture((root) => {
    const first = runManpageGeneration({ repositoryRoot: root, mode: "generate" });
    const manifestPath = join(root, "ui", "src", "generated", "manpages-manifest.json");
    const firstManifest = readFileSync(manifestPath);
    const firstArtifacts = first.entries.map((entry) =>
      readFileSync(join(root, entry.artifactPath))
    );
    const second = runManpageGeneration({ repositoryRoot: root, mode: "generate" });

    assert.equal(first.entries.length, 33);
    assert.deepEqual(first, second);
    assert.deepEqual(readFileSync(manifestPath), firstManifest);
    assert.deepEqual(
      second.entries.map((entry) => readFileSync(join(root, entry.artifactPath))),
      firstArtifacts,
    );
    assert.deepEqual(
      first.entries.map((entry) => entry.name),
      first.entries.map((entry) => entry.name).sort(),
    );

    for (const entry of first.entries) {
      const artifact = readFileSync(join(root, entry.artifactPath));
      const text = artifact.toString("utf8");

      assert.equal(artifact.byteLength, entry.byteCount);
      assert.equal(text.split("\n").length - 1, entry.lineCount);
      assert.equal(
        createHash("sha256").update(artifact).digest("hex"),
        entry.sha256,
      );
      assert.equal(text.endsWith("\n"), true);
      assert.equal(text.includes("\r"), false);
      assert.equal(containsUnsafeControl(text), false);
    }

    assert.doesNotThrow(() =>
      runManpageGeneration({ repositoryRoot: root, mode: "check" })
    );
  });
});

test("check mode rejects stale source, artifact, manifest, and extra coverage", () => {
  const mutations: ReadonlyArray<Readonly<{
    mutate: (root: string) => void;
    message: RegExp;
  }>> = [
    {
      mutate: (root) => {
        const path = join(root, "man", "ls.1");
        writeFileSync(path, `${readFileSync(path, "utf8")}\n.PP\nChanged.\n`);
      },
      message: /stale or manually modified/u,
    },
    {
      mutate: (root) => {
        const path = join(root, "ui", "src", "generated", "manpages", "ls.txt");
        writeFileSync(path, `${readFileSync(path, "utf8")}manual edit\n`);
      },
      message: /Generated artifact for ls is stale or manually modified/u,
    },
    {
      mutate: (root) => {
        const path = join(root, "ui", "src", "generated", "manpages-manifest.json");
        writeFileSync(path, `${readFileSync(path, "utf8")} `);
      },
      message: /Generated manifest is stale or manually modified/u,
    },
    {
      mutate: (root) => {
        writeFileSync(join(root, "man", "extra.1"), ".TH EXTRA 1\n");
      },
      message: /Roff source coverage mismatch.*extra: extra/u,
    },
    {
      mutate: (root) => {
        rmSync(join(root, "man", "ls.1"));
      },
      message: /Roff source coverage mismatch.*missing: ls/u,
    },
    {
      mutate: (root) => {
        writeFileSync(
          join(root, "ui", "src", "generated", "manpages", "extra.txt"),
          "extra\n",
        );
      },
      message: /Generated artifact coverage mismatch.*extra: extra/u,
    },
    {
      mutate: (root) => {
        rmSync(join(root, "ui", "src", "generated", "manpages", "ls.txt"));
      },
      message: /Generated artifact coverage mismatch.*missing: ls/u,
    },
  ];

  for (const mutation of mutations) {
    withFixture((root) => {
      runManpageGeneration({ repositoryRoot: root, mode: "generate" });
      mutation.mutate(root);
      assert.throws(
        () => runManpageGeneration({ repositoryRoot: root, mode: "check" }),
        mutation.message,
      );
    });
  }
});

test("generation rejects marker drift, unsafe controls, and groff diagnostics", () => {
  withFixture((root) => {
    const path = join(root, "man", "ls.1");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        ".\\\" termin.al-name: ls",
        ".\\\" termin.al-name: list",
      ),
    );
    assert.throws(
      () => runManpageGeneration({ repositoryRoot: root, mode: "generate" }),
      /declares canonical name 'list', expected 'ls'/u,
    );
  });

  withFixture((root) => {
    const path = join(root, "man", "ls.1");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(".TH LS 1", ".TH LS 2"),
    );
    assert.throws(
      () => runManpageGeneration({ repositoryRoot: root, mode: "generate" }),
      /must contain \.TH LS 1/u,
    );
  });

  withFixture((root) => {
    const path = join(root, "man", "ls.1");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        ".\\\" termin.al-usage: ls [-a] [-l] [--tree] [path]",
        ".\\\" termin.al-usage: ls [-a] [-l] [--tree] [path]\n.\\\" termin.al-usage: ls",
      ),
    );
    assert.throws(
      () => runManpageGeneration({ repositoryRoot: root, mode: "generate" }),
      /repeats the termin\.al-usage marker/u,
    );
  });

  withFixture((root) => {
    const path = join(root, "man", "ls.1");
    writeFileSync(path, `${readFileSync(path, "utf8")}unsafe\ttext\n`);
    assert.throws(
      () => runManpageGeneration({ repositoryRoot: root, mode: "generate" }),
      /unsafe control character U\+0009/u,
    );
  });

  withFixture((root) => {
    const fakeGroff = join(root, "fake-groff");
    writeFileSync(fakeGroff, "#!/bin/sh\necho 'synthetic groff warning' >&2\nexit 0\n");
    chmodSync(fakeGroff, 0o755);
    assert.throws(
      () => runManpageGeneration({
        repositoryRoot: root,
        mode: "generate",
        groffExecutable: fakeGroff,
      }),
      /groff failed.*synthetic groff warning/u,
    );
  });

  withFixture((root) => {
    const fakeGroff = join(root, "fake-groff");
    writeFileSync(fakeGroff, "#!/bin/sh\nexit 2\n");
    chmodSync(fakeGroff, 0o755);
    assert.throws(
      () => runManpageGeneration({
        repositoryRoot: root,
        mode: "generate",
        groffExecutable: fakeGroff,
      }),
      /groff failed.*exit status 2/u,
    );
  });
});
