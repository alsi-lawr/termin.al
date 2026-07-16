namespace Termin.Al.Host

open System.Text.Json.Nodes

[<RequireQualifiedAccess>]
module ContentWire =
    type SourceDto =
        { Repository: string
          Path: string
          Revision: string
          Url: string }

    type CacheDto =
        { State: string
          FetchedAt: string
          FreshUntil: string
          StaleUntil: string }

    type CatalogEntryDto =
        | Directory of id: string * path: string * updatedAt: string * size: int
        | File of id: string * path: string * updatedAt: string * size: int * documentHandle: string
        | LockedFile of id: string * path: string * updatedAt: string * size: int

    type CatalogDto =
        { Entries: CatalogEntryDto list
          Source: SourceDto
          Cache: CacheDto }

    type PageDocumentDto =
        { Id: string
          Path: string
          Title: string
          UpdatedAt: string
          Body: string
          Source: SourceDto
          Cache: CacheDto }

    type PublicationDocumentDto =
        { Kind: string
          Id: string
          Slug: string
          Path: string
          Title: string
          Summary: string
          PublishedAt: string
          UpdatedAt: string
          Tags: string list
          Body: string
          Source: SourceDto
          Cache: CacheDto }

    type DocumentDto =
        | PageDocument of PageDocumentDto
        | PublicationDocument of PublicationDocumentDto

    type ProjectDto =
        { Id: string
          Slug: string
          Name: string
          Summary: string
          Url: string
          Repository: string
          UpdatedAt: string
          Tags: string list
          Readme: string }

    type ProjectsDto =
        { Projects: ProjectDto list
          Source: SourceDto
          Cache: CacheDto }

    type NowDto =
        { Title: string
          Body: string
          UpdatedAt: string
          Source: SourceDto
          Cache: CacheDto }

    type CommitDto =
        { Sha: string
          Summary: string
          AuthoredAt: string
          Url: string }

    type ReleaseDto =
        { Tag: string
          Name: string
          PublishedAt: string
          Body: string
          Url: string
          Commits: CommitDto list }

    type ChangelogDto =
        { Unreleased: CommitDto list
          Releases: ReleaseDto list
          Source: SourceDto
          Cache: CacheDto }

    type ProblemDto =
        { Type: string
          Title: string
          Status: int
          Code: string
          Detail: string }

    type Response =
        | CatalogResponse of CatalogDto
        | DocumentResponse of DocumentDto
        | ProjectsResponse of ProjectsDto
        | NowResponse of NowDto
        | ChangelogResponse of ChangelogDto
        | ProblemResponse of ProblemDto

    let source (source: ContentDomain.ContentSource) : SourceDto =
        { Repository = source.Repository |> ContentDomain.RepositoryName.value
          Path = source.Path |> ContentDomain.RepositoryPath.value
          Revision = source.Revision |> ContentDomain.ContentRevision.value
          Url = source.Url |> ContentDomain.ContentUrl.value }

    let cache (cache: ContentDomain.CacheMetadata) : CacheDto =
        { State = cache |> ContentDomain.CacheMetadata.state |> ContentDomain.CacheState.value
          FetchedAt = cache |> ContentDomain.CacheMetadata.fetchedAt |> ContentDomain.Timestamp.value
          FreshUntil = cache |> ContentDomain.CacheMetadata.freshUntil |> ContentDomain.Timestamp.value
          StaleUntil = cache |> ContentDomain.CacheMetadata.staleUntil |> ContentDomain.Timestamp.value }

    let private catalogEntry entry : CatalogEntryDto =
        match entry with
        | ContentDomain.Directory(id, path, updatedAt, size) ->
            Directory(
                id |> ContentDomain.CatalogId.value,
                path |> ContentDomain.VirtualPath.value,
                updatedAt |> ContentDomain.Timestamp.value,
                size |> ContentDomain.ByteSize.value
            )
        | ContentDomain.File(id, path, updatedAt, size, documentHandle) ->
            File(
                id |> ContentDomain.CatalogId.value,
                path |> ContentDomain.VirtualPath.value,
                updatedAt |> ContentDomain.Timestamp.value,
                size |> ContentDomain.ByteSize.value,
                documentHandle |> ContentDomain.ContentId.value
            )
        | ContentDomain.LockedFile(id, path, updatedAt, size) ->
            LockedFile(
                id |> ContentDomain.CatalogId.value,
                path |> ContentDomain.VirtualPath.value,
                updatedAt |> ContentDomain.Timestamp.value,
                size |> ContentDomain.ByteSize.value
            )

    let catalog (catalog: ContentDomain.Catalog) : CatalogDto =
        { Entries = catalog |> ContentDomain.Catalog.entries |> List.map catalogEntry
          Source = catalog |> ContentDomain.Catalog.source |> source
          Cache = catalog |> ContentDomain.Catalog.cache |> cache }

    let document (document: ContentDomain.ContentDocument) : DocumentDto =
        let id =
            document |> ContentDomain.ContentDocument.id |> ContentDomain.ContentId.value

        let path =
            document
            |> ContentDomain.ContentDocument.path
            |> ContentDomain.VirtualPath.value

        let title =
            document
            |> ContentDomain.ContentDocument.title
            |> ContentDomain.ContentTitle.value

        let updatedAt =
            document
            |> ContentDomain.ContentDocument.updatedAt
            |> ContentDomain.Timestamp.value

        let body =
            document
            |> ContentDomain.ContentDocument.body
            |> ContentDomain.MarkdownBody.value

        let documentSource = document |> ContentDomain.ContentDocument.source |> source
        let documentCache = document |> ContentDomain.ContentDocument.cache |> cache

        match document |> ContentDomain.ContentDocument.metadata with
        | ContentDomain.ContentDocumentMetadata.Page ->
            PageDocument
                { Id = id
                  Path = path
                  Title = title
                  UpdatedAt = updatedAt
                  Body = body
                  Source = documentSource
                  Cache = documentCache }
        | ContentDomain.ContentDocumentMetadata.Publication metadata ->
            PublicationDocument
                { Kind =
                    metadata
                    |> ContentDomain.PublicationMetadata.kind
                    |> ContentDomain.PublicationKind.value
                  Id = id
                  Slug =
                    metadata
                    |> ContentDomain.PublicationMetadata.slug
                    |> ContentDomain.ContentSlug.value
                  Path = path
                  Title = title
                  Summary =
                    metadata
                    |> ContentDomain.PublicationMetadata.summary
                    |> ContentDomain.ContentSummary.value
                  PublishedAt =
                    metadata
                    |> ContentDomain.PublicationMetadata.publishedAt
                    |> ContentDomain.Timestamp.value
                  UpdatedAt = updatedAt
                  Tags =
                    metadata
                    |> ContentDomain.PublicationMetadata.tags
                    |> List.map ContentDomain.ContentTag.value
                  Body = body
                  Source = documentSource
                  Cache = documentCache }

    let project (readme: ContentDomain.ProjectReadme) : ProjectDto =
        let project = readme |> ContentDomain.ProjectReadme.project

        { Id = project |> ContentDomain.Project.id |> ContentDomain.ContentId.value
          Slug = project |> ContentDomain.Project.slug |> ContentDomain.ContentSlug.value
          Name = project |> ContentDomain.Project.name |> ContentDomain.ContentTitle.value
          Summary = project |> ContentDomain.Project.summary |> ContentDomain.ContentSummary.value
          Url = project |> ContentDomain.Project.url |> ContentDomain.ContentUrl.value
          Repository =
            project
            |> ContentDomain.Project.repository
            |> ContentDomain.RepositoryName.value
          UpdatedAt = project |> ContentDomain.Project.updatedAt |> ContentDomain.Timestamp.value
          Tags = project |> ContentDomain.Project.tags |> List.map ContentDomain.ContentTag.value
          Readme = readme |> ContentDomain.ProjectReadme.body |> ContentDomain.MarkdownBody.value }

    let projects (projects: ContentDomain.Projects) : ProjectsDto =
        { Projects = projects |> ContentDomain.Projects.entries |> List.map project
          Source = projects |> ContentDomain.Projects.source |> source
          Cache = projects |> ContentDomain.Projects.cache |> cache }

    let now (value: ContentDomain.Now) : NowDto =
        { Title = value |> ContentDomain.Now.title |> ContentDomain.ContentTitle.value
          Body = value |> ContentDomain.Now.body |> ContentDomain.MarkdownBody.value
          UpdatedAt = value |> ContentDomain.Now.updatedAt |> ContentDomain.Timestamp.value
          Source = value |> ContentDomain.Now.source |> source
          Cache = value |> ContentDomain.Now.cache |> cache }

    let private commit (value: ContentDomain.Commit) : CommitDto =
        { Sha = value |> ContentDomain.Commit.sha |> ContentDomain.CommitSha.value
          Summary = value |> ContentDomain.Commit.summary |> ContentDomain.CommitSummary.value
          AuthoredAt = value |> ContentDomain.Commit.authoredAt |> ContentDomain.Timestamp.value
          Url = value |> ContentDomain.Commit.url |> ContentDomain.ContentUrl.value }

    let private release (value: ContentDomain.Release) : ReleaseDto =
        { Tag = value |> ContentDomain.Release.tag |> ContentDomain.ContentTag.value
          Name = value |> ContentDomain.Release.name |> ContentDomain.ContentTitle.value
          PublishedAt = value |> ContentDomain.Release.publishedAt |> ContentDomain.Timestamp.value
          Body = value |> ContentDomain.Release.body
          Url = value |> ContentDomain.Release.url |> ContentDomain.ContentUrl.value
          Commits = value |> ContentDomain.Release.commits |> List.map commit }

    let changelog (value: ContentDomain.Changelog) : ChangelogDto =
        { Unreleased = value |> ContentDomain.Changelog.unreleased |> List.map commit
          Releases = value |> ContentDomain.Changelog.releases |> List.map release
          Source = value |> ContentDomain.Changelog.source |> source
          Cache = value |> ContentDomain.Changelog.cache |> cache }

    let problem (problem: ContentDomain.Problem) : ProblemDto =
        let code = problem |> ContentDomain.Problem.code

        { Type = $"https://termin.al/problems/{ContentDomain.ProblemCode.value code}"
          Title = ContentDomain.ProblemCode.title code
          Status = ContentDomain.ProblemCode.status code
          Code = ContentDomain.ProblemCode.value code
          Detail = problem |> ContentDomain.Problem.detail }

    let private text (value: string) : JsonNode =
        JsonValue.Create<string>(value) :> JsonNode

    let private number (value: int) : JsonNode =
        JsonValue.Create<int>(value) :> JsonNode

    let private objectOf (properties: (string * JsonNode) list) : JsonNode =
        let result = JsonObject()

        for key, value in properties do
            result[key] <- value

        result :> JsonNode

    let private arrayOf (values: JsonNode list) : JsonNode =
        let result = JsonArray()

        for value in values do
            result.Add value

        result :> JsonNode

    let private sourceNode (value: SourceDto) =
        objectOf
            [ "repository", text value.Repository
              "path", text value.Path
              "revision", text value.Revision
              "url", text value.Url ]

    let private cacheNode (value: CacheDto) =
        objectOf
            [ "state", text value.State
              "fetchedAt", text value.FetchedAt
              "freshUntil", text value.FreshUntil
              "staleUntil", text value.StaleUntil ]

    let private catalogEntryNode (value: CatalogEntryDto) =
        match value with
        | Directory(id, path, updatedAt, size) ->
            objectOf
                [ "kind", text "directory"
                  "id", text id
                  "path", text path
                  "updatedAt", text updatedAt
                  "size", number size ]
        | File(id, path, updatedAt, size, documentHandle) ->
            objectOf
                [ "kind", text "file"
                  "id", text id
                  "path", text path
                  "updatedAt", text updatedAt
                  "size", number size
                  "documentHandle", text documentHandle ]
        | LockedFile(id, path, updatedAt, size) ->
            objectOf
                [ "kind", text "locked-file"
                  "id", text id
                  "path", text path
                  "updatedAt", text updatedAt
                  "size", number size ]

    let private catalogNode (value: CatalogDto) =
        objectOf
            [ "entries", value.Entries |> List.map catalogEntryNode |> arrayOf
              "source", sourceNode value.Source
              "cache", cacheNode value.Cache ]

    let private documentNode (value: DocumentDto) =
        match value with
        | PageDocument page ->
            objectOf
                [ "kind", text "page"
                  "id", text page.Id
                  "path", text page.Path
                  "title", text page.Title
                  "updatedAt", text page.UpdatedAt
                  "body", text page.Body
                  "source", sourceNode page.Source
                  "cache", cacheNode page.Cache ]
        | PublicationDocument publication ->
            objectOf
                [ "kind", text publication.Kind
                  "id", text publication.Id
                  "slug", text publication.Slug
                  "path", text publication.Path
                  "title", text publication.Title
                  "summary", text publication.Summary
                  "publishedAt", text publication.PublishedAt
                  "updatedAt", text publication.UpdatedAt
                  "tags", publication.Tags |> List.map text |> arrayOf
                  "body", text publication.Body
                  "source", sourceNode publication.Source
                  "cache", cacheNode publication.Cache ]

    let private projectNode (value: ProjectDto) =
        objectOf
            [ "id", text value.Id
              "slug", text value.Slug
              "name", text value.Name
              "summary", text value.Summary
              "url", text value.Url
              "repository", text value.Repository
              "updatedAt", text value.UpdatedAt
              "tags", value.Tags |> List.map text |> arrayOf
              "readme", text value.Readme ]

    let private projectsNode (value: ProjectsDto) =
        objectOf
            [ "projects", value.Projects |> List.map projectNode |> arrayOf
              "source", sourceNode value.Source
              "cache", cacheNode value.Cache ]

    let private nowNode (value: NowDto) =
        objectOf
            [ "title", text value.Title
              "body", text value.Body
              "updatedAt", text value.UpdatedAt
              "source", sourceNode value.Source
              "cache", cacheNode value.Cache ]

    let private commitNode (value: CommitDto) =
        objectOf
            [ "sha", text value.Sha
              "summary", text value.Summary
              "authoredAt", text value.AuthoredAt
              "url", text value.Url ]

    let private releaseNode (value: ReleaseDto) =
        objectOf
            [ "tag", text value.Tag
              "name", text value.Name
              "publishedAt", text value.PublishedAt
              "body", text value.Body
              "url", text value.Url
              "commits", value.Commits |> List.map commitNode |> arrayOf ]

    let private changelogNode (value: ChangelogDto) =
        objectOf
            [ "unreleased", value.Unreleased |> List.map commitNode |> arrayOf
              "releases", value.Releases |> List.map releaseNode |> arrayOf
              "source", sourceNode value.Source
              "cache", cacheNode value.Cache ]

    let private problemNode (value: ProblemDto) =
        objectOf
            [ "type", text value.Type
              "title", text value.Title
              "status", number value.Status
              "code", text value.Code
              "detail", text value.Detail ]

    let toJsonNode (response: Response) =
        match response with
        | CatalogResponse value -> catalogNode value
        | DocumentResponse value -> documentNode value
        | ProjectsResponse value -> projectsNode value
        | NowResponse value -> nowNode value
        | ChangelogResponse value -> changelogNode value
        | ProblemResponse value -> problemNode value

    let serialize response =
        response |> toJsonNode |> (fun value -> value.ToJsonString())
