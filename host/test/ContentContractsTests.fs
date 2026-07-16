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

    let private repositoryPath value =
        ContentDomain.RepositoryPath.tryCreate "test.repositoryPath" value
        |> requireValid

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
              ContentDomain.Directory(
                  catalogId "blog",
                  virtualPath "~/blog",
                  timestamp "2026-07-15T00:00:02.000Z",
                  byteSize 0
              )
              ContentDomain.File(
                  catalogId "about-document",
                  virtualPath "~/about.md",
                  timestamp "2026-07-15T00:00:03.000Z",
                  byteSize 42,
                  contentId "about"
              )
              ContentDomain.File(
                  catalogId "publication-document",
                  virtualPath "~/blog/validated-metadata.md",
                  timestamp "2026-07-15T00:00:04.000Z",
                  byteSize 128,
                  contentId "blog-validated-metadata"
              ) ]
        |> requireValid

    let private document () =
        let markdown =
            "---\n"
            + "{\"title\":\"About\"}\n"
            + "---\n"
            + "# About\n\nA validated shared content fixture."

        ContentDomain.ContentDocument.tryCreate
            (contentId "about")
            (virtualPath "~/about.md")
            (timestamp "2026-07-15T00:00:03.000Z")
            (source "content/about.md" "https://github.com/example-owner/content/blob/main/content/about.md")
            cache
            markdown
        |> requireValid

    let private publicationDocument () =
        let markdown =
            "---\n"
            + "{\"title\":\"Validated Metadata\",\"summary\":\"The supplied publication summary.\",\"publishedAt\":\"2026-07-10T00:00:00.000Z\",\"tags\":[\"fsharp\",\"content\"]}\n"
            + "---\n"
            + "# Body Heading\n\nThis first body paragraph is not the supplied summary."

        ContentDomain.ContentDocument.tryCreate
            (contentId "blog-validated-metadata")
            (virtualPath "~/blog/validated-metadata.md")
            (timestamp "2026-07-15T00:00:04.000Z")
            (source
                "blog/validated-metadata.md"
                "https://github.com/example-owner/content/blob/main/blog/validated-metadata.md")
            cache
            markdown
        |> requireValid

    let private projects () =
        let manifest =
            "{\"projects\":[{\"id\":\"sample-project\",\"slug\":\"sample-project\",\"name\":\"Sample Project\",\"summary\":\"A validated project fixture.\",\"url\":\"https://github.com/example-owner/sample-project\",\"repository\":\"example-owner/sample-project\",\"updatedAt\":\"2026-07-15T00:00:03.000Z\",\"tags\":[\"fsharp\",\"typescript\"]},{\"id\":\"second-project\",\"slug\":\"second-project\",\"name\":\"Second Project\",\"summary\":\"A second validated project fixture.\",\"url\":\"https://github.com/example-owner/second-project\",\"repository\":\"example-owner/second-project\",\"updatedAt\":\"2026-07-15T00:00:04.000Z\",\"tags\":[\"typescript\"]}]}"

        let readmes =
            [ "# Sample Project README\n\nThis is the supplied README body, not the project summary."
              "# Second Project README\n\nThis is a second supplied README body." ]

        let projectEntries =
            manifest |> ContentDomain.ProjectManifest.tryParse |> requireValid

        List.map2
            (fun project readme ->
                ContentDomain.ProjectReadme.create
                    project
                    (ContentDomain.MarkdownBody.tryCreate "test.projectReadme" readme |> requireValid))
            projectEntries
            readmes

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

        publicationDocument ()
        |> ContentWire.document
        |> ContentWire.DocumentResponse
        |> ContentWire.serialize
        |> assertFixture "document-publication.json"

        let projectEntries = projects ()

        if List.length projectEntries <> 2 then
            failwith "The shared projects fixture must retain distinct repositories."

        ContentDomain.Projects.tryCreate
            (source "content/projects.json" "https://github.com/example-owner/content/blob/main/content/projects.json")
            cache
            projectEntries
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
            "---\n{\"title\":\"About\",\"title\":\"Duplicate\"}\n---\n# About"

        match ContentDomain.FrontMatter.tryParse (repositoryPath "about.md") duplicateFrontMatter with
        | Ok _ -> failwith "Duplicate front matter keys should not validate."
        | Error _ -> ()

        let keyValueFrontMatter = "---\ntitle: About\n---\n# About"

        match ContentDomain.FrontMatter.tryParse (repositoryPath "about.md") keyValueFrontMatter with
        | Ok _ -> failwith "Superseded key/value front matter should not validate."
        | Error _ -> ()

        let frontMatterWithParallelAuthority =
            "---\n{\"id\":\"about\",\"title\":\"About\"}\n---\n# About"

        match ContentDomain.FrontMatter.tryParse (repositoryPath "about.md") frontMatterWithParallelAuthority with
        | Ok _ -> failwith "Front matter identifiers should not remain a parallel authority."
        | Error _ -> ()

        let invalidPublicationDate =
            "---\n{\"title\":\"Post\",\"summary\":\"Summary\",\"publishedAt\":\"2026-07-10\",\"tags\":[]}\n---\n# Post"

        match ContentDomain.FrontMatter.tryParse (repositoryPath "blog/post.md") invalidPublicationDate with
        | Ok _ -> failwith "Publication dates must use the validated timestamp semantics."
        | Error _ -> ()

        let validPublication =
            "---\n{\"title\":\"Post\",\"summary\":\"Summary\",\"publishedAt\":\"2026-07-10T00:00:00.000Z\",\"tags\":[]}\n---\n# Post"

        match
            ContentDomain.ContentDocument.tryCreate
                (contentId "post")
                (virtualPath "~/notes/post.md")
                (timestamp "2026-07-15T00:00:00.000Z")
                (source "blog/post.md" "https://github.com/example-owner/content/blob/main/blog/post.md")
                cache
                validPublication
        with
        | Ok _ -> failwith "Repository and virtual publication paths must agree."
        | Error _ -> ()

        let duplicateProjectManifest =
            "{\"projects\":[{\"id\":\"one\",\"slug\":\"same\",\"name\":\"One\",\"summary\":\"One\",\"url\":\"https://example.com/one\",\"repository\":\"example/one\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"one\"]},{\"id\":\"two\",\"slug\":\"same\",\"name\":\"Two\",\"summary\":\"Two\",\"url\":\"https://example.com/two\",\"repository\":\"example/two\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"two\"]}]}"

        match ContentDomain.ProjectManifest.tryParse duplicateProjectManifest with
        | Ok _ -> failwith "Duplicate project slugs should not validate."
        | Error _ -> ()

        let exactDuplicateRepositoryManifest =
            "{\"projects\":[{\"id\":\"one\",\"slug\":\"one\",\"name\":\"One\",\"summary\":\"One\",\"url\":\"https://example.com/one\",\"repository\":\"example/one\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"one\"]},{\"id\":\"two\",\"slug\":\"two\",\"name\":\"Two\",\"summary\":\"Two\",\"url\":\"https://example.com/two\",\"repository\":\"example/one\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"two\"]}]}"

        match ContentDomain.ProjectManifest.tryParse exactDuplicateRepositoryManifest with
        | Ok _ -> failwith "Exact duplicate project repositories should not validate."
        | Error _ -> ()

        let caseDuplicateRepositoryManifest =
            "{\"projects\":[{\"id\":\"one\",\"slug\":\"one\",\"name\":\"One\",\"summary\":\"One\",\"url\":\"https://example.com/one\",\"repository\":\"example/one\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"one\"]},{\"id\":\"two\",\"slug\":\"two\",\"name\":\"Two\",\"summary\":\"Two\",\"url\":\"https://example.com/two\",\"repository\":\"Example/One\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"two\"]}]}"

        match ContentDomain.ProjectManifest.tryParse caseDuplicateRepositoryManifest with
        | Ok _ -> failwith "Case-only duplicate project repositories should not validate."
        | Error _ -> ()

        let oversized = String.replicate (ContentDomain.DocumentByteLimit + 1) "a"

        match ContentDomain.MarkdownBody.tryCreate "body" oversized with
        | Ok _ -> failwith "Documents above the byte limit should not validate."
        | Error _ -> ()

    let private testPublicationMetadata () =
        let document = publicationDocument ()

        if
            document
            |> ContentDomain.ContentDocument.updatedAt
            |> ContentDomain.Timestamp.value
            <> "2026-07-15T00:00:04.000Z"
        then
            failwith "Document update time must remain independent from publication time."

        match document |> ContentDomain.ContentDocument.metadata with
        | ContentDomain.ContentDocumentMetadata.Page -> failwith "A blog path must produce publication metadata."
        | ContentDomain.ContentDocumentMetadata.Publication metadata ->
            let kind =
                metadata
                |> ContentDomain.PublicationMetadata.kind
                |> ContentDomain.PublicationKind.value

            let slug =
                metadata
                |> ContentDomain.PublicationMetadata.slug
                |> ContentDomain.ContentSlug.value

            let summary =
                metadata
                |> ContentDomain.PublicationMetadata.summary
                |> ContentDomain.ContentSummary.value

            let publishedAt =
                metadata
                |> ContentDomain.PublicationMetadata.publishedAt
                |> ContentDomain.Timestamp.value

            let tags =
                metadata
                |> ContentDomain.PublicationMetadata.tags
                |> List.map ContentDomain.ContentTag.value

            if
                kind <> "blog"
                || slug <> "validated-metadata"
                || summary <> "The supplied publication summary."
                || publishedAt <> "2026-07-10T00:00:00.000Z"
                || tags <> [ "fsharp"; "content" ]
            then
                failwith "Publication metadata must be validated and derived from its repository path."

    let run () =
        testSerializedFixtures ()
        testValidationFailures ()
        testPublicationMetadata ()
