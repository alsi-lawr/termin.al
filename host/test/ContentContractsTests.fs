namespace Termin.Al.Host.Tests

open System
open System.IO
open Termin.Al.Host

[<RequireQualifiedAccess>]
module ContentContractsTests =
    let private requireValid (result: ContentDomain.ValidationResult<'value>) : 'value =
        match result with
        | Ok value -> value
        | Error failure -> failwithf "%s: %s" failure.Field failure.Message

    let private timestamp value =
        ContentDomain.Timestamp.tryCreate "test.timestamp" value |> requireValid

    let private contentId value =
        ContentDomain.ContentId.tryCreate "test.id" value |> requireValid

    let private catalogId value =
        ContentDomain.CatalogId.tryCreate "test.catalogId" value |> requireValid

    let private virtualPath value =
        ContentDomain.VirtualPath.tryCreate "test.path" value |> requireValid

    let private byteSize value =
        ContentDomain.ByteSize.tryCreate "test.size" value |> requireValid

    let private source path url =
        ContentDomain.ContentSource.create
            (ContentDomain.RepositoryName.tryCreate "test.repository" "example-owner/content"
             |> requireValid)
            (ContentDomain.RepositoryPath.tryCreate "test.sourcePath" path |> requireValid)
            (ContentDomain.ContentRevision.tryCreate "test.revision" "main" |> requireValid)
            (ContentDomain.ContentUrl.tryCreate "test.url" url |> requireValid)

    let private applicationSource path url =
        ContentDomain.ContentSource.create
            (ContentDomain.RepositoryName.tryCreate "test.repository" "example-owner/application"
             |> requireValid)
            (ContentDomain.RepositoryPath.tryCreate "test.sourcePath" path |> requireValid)
            (ContentDomain.ContentRevision.tryCreate "test.revision" "main" |> requireValid)
            (ContentDomain.ContentUrl.tryCreate "test.url" url |> requireValid)

    let private cache =
        ContentDomain.CacheMetadata.tryCreate
            ContentDomain.Fresh
            (timestamp "2026-07-15T00:00:00.000Z")
            (timestamp "2026-07-15T00:05:00.000Z")
            (timestamp "2026-07-15T01:05:00.000Z")
        |> requireValid

    let private readFixture name =
        Path.Combine(AppContext.BaseDirectory, "contracts", "fixtures", name)
        |> File.ReadAllText
        |> fun value -> value.Trim()

    let private assertFixture name actual =
        let expected = readFixture name

        if actual <> expected then
            failwithf
                "Fixture '%s' did not match the serialized content contract.\nExpected: %s\nActual: %s"
                name
                expected
                actual

    let private catalog () =
        ContentDomain.Catalog.tryCreate
            (source "content/catalog.json" "https://github.com/example-owner/content/blob/main/content/catalog.json")
            cache
            [ ContentDomain.Directory(
                  catalogId "home",
                  virtualPath "~",
                  timestamp "2026-07-15T00:00:00.000Z",
                  byteSize 0
              )
              ContentDomain.Directory(
                  catalogId "projects",
                  virtualPath "~/projects",
                  timestamp "2026-07-15T00:00:01.000Z",
                  byteSize 0
              )
              ContentDomain.File(
                  catalogId "about-document",
                  virtualPath "~/about.md",
                  timestamp "2026-07-15T00:00:02.000Z",
                  byteSize 42,
                  contentId "about"
              ) ]
        |> requireValid

    let private document () =
        let markdown =
            "---\n"
            + "id: about\n"
            + "title: About\n"
            + "updatedAt: 2026-07-15T00:00:02.000Z\n"
            + "tags: fsharp, typescript\n"
            + "---\n"
            + "# About\n\nA validated shared content fixture."

        ContentDomain.ContentDocument.tryCreate
            (virtualPath "~/about.md")
            (source "content/about.md" "https://github.com/example-owner/content/blob/main/content/about.md")
            cache
            markdown
        |> requireValid

    let private projects () =
        let manifest =
            "{\"projects\":[{\"id\":\"sample-project\",\"slug\":\"sample-project\",\"name\":\"Sample Project\",\"summary\":\"A validated project fixture.\",\"url\":\"https://github.com/example-owner/sample-project\",\"repository\":\"example-owner/sample-project\",\"updatedAt\":\"2026-07-15T00:00:03.000Z\",\"tags\":[\"fsharp\",\"typescript\"]}]}"

        ContentDomain.ProjectManifest.tryParse manifest |> requireValid

    let private now () =
        ContentDomain.Now.create
            (ContentDomain.ContentTitle.tryCreate "test.nowTitle" "Now" |> requireValid)
            (ContentDomain.MarkdownBody.tryCreate "test.nowBody" "# Now\n\nA validated current-status fixture."
             |> requireValid)
            (timestamp "2026-07-15T00:00:04.000Z")
            (source "content/now.md" "https://github.com/example-owner/content/blob/main/content/now.md")
            cache

    let private commit sha summary authoredAt url =
        ContentDomain.Commit.create
            (ContentDomain.CommitSha.tryCreate "test.sha" sha |> requireValid)
            (ContentDomain.CommitSummary.tryCreate "test.summary" summary |> requireValid)
            (timestamp authoredAt)
            (ContentDomain.ContentUrl.tryCreate "test.commitUrl" url |> requireValid)

    let private changelog () =
        let unreleased =
            commit
                "0123456789abcdef0123456789abcdef01234567"
                "Add validated content contracts"
                "2026-07-15T00:00:05.000Z"
                "https://github.com/example-owner/application/commit/0123456789abcdef0123456789abcdef01234567"

        let initialCommit =
            commit
                "89abcdef0123456789abcdef0123456789abcdef"
                "Initial release"
                "2026-07-14T00:00:00.000Z"
                "https://github.com/example-owner/application/commit/89abcdef0123456789abcdef0123456789abcdef"

        let release =
            ContentDomain.Release.tryCreate
                (ContentDomain.ContentTag.tryCreate "test.releaseTag" "v1.0.0" |> requireValid)
                (ContentDomain.ContentTitle.tryCreate "test.releaseName" "1.0.0" |> requireValid)
                (timestamp "2026-07-14T00:00:00.000Z")
                "Initial validated release."
                (ContentDomain.ContentUrl.tryCreate
                    "test.releaseUrl"
                    "https://github.com/example-owner/application/releases/tag/v1.0.0"
                 |> requireValid)
                [ initialCommit ]
            |> requireValid

        ContentDomain.Changelog.tryCreate
            (applicationSource "releases" "https://github.com/example-owner/application/releases")
            cache
            [ unreleased ]
            [ release ]
        |> requireValid

    let private testSerializedFixtures () =
        catalog ()
        |> ContentWire.catalog
        |> ContentWire.CatalogResponse
        |> ContentWire.serialize
        |> assertFixture "catalog.json"

        document ()
        |> ContentWire.document
        |> ContentWire.DocumentResponse
        |> ContentWire.serialize
        |> assertFixture "document-about.json"

        ContentDomain.Projects.tryCreate
            (source "content/projects.json" "https://github.com/example-owner/content/blob/main/content/projects.json")
            cache
            (projects ())
        |> requireValid
        |> ContentWire.projects
        |> ContentWire.ProjectsResponse
        |> ContentWire.serialize
        |> assertFixture "projects.json"

        now ()
        |> ContentWire.now
        |> ContentWire.NowResponse
        |> ContentWire.serialize
        |> assertFixture "now.json"

        changelog ()
        |> ContentWire.changelog
        |> ContentWire.ChangelogResponse
        |> ContentWire.serialize
        |> assertFixture "changelog.json"

        ContentDomain.Problem.create ContentDomain.InvalidRequest "The requested document identifier is invalid."
        |> ContentWire.problem
        |> ContentWire.ProblemResponse
        |> ContentWire.serialize
        |> assertFixture "problem-invalid-request.json"

    let private testValidationFailures () =
        match ContentDomain.VirtualPath.tryCreate "path" "~/../about.md" with
        | Ok _ -> failwith "A traversal path should not validate."
        | Error _ -> ()

        let duplicateFrontMatter =
            "---\nid: about\nid: duplicate\ntitle: About\nupdatedAt: 2026-07-15T00:00:02.000Z\n---\n# About"

        match ContentDomain.FrontMatter.tryParse duplicateFrontMatter with
        | Ok _ -> failwith "Duplicate front matter keys should not validate."
        | Error _ -> ()

        let duplicateProjectManifest =
            "{\"projects\":[{\"id\":\"one\",\"slug\":\"same\",\"name\":\"One\",\"summary\":\"One\",\"url\":\"https://example.com/one\",\"repository\":\"example/one\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"one\"]},{\"id\":\"two\",\"slug\":\"same\",\"name\":\"Two\",\"summary\":\"Two\",\"url\":\"https://example.com/two\",\"repository\":\"example/two\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"two\"]}]}"

        match ContentDomain.ProjectManifest.tryParse duplicateProjectManifest with
        | Ok _ -> failwith "Duplicate project slugs should not validate."
        | Error _ -> ()

        let oversized = String.replicate (ContentDomain.DocumentByteLimit + 1) "a"

        match ContentDomain.MarkdownBody.tryCreate "body" oversized with
        | Ok _ -> failwith "Documents above the byte limit should not validate."
        | Error _ -> ()

    let run () =
        testSerializedFixtures ()
        testValidationFailures ()
