namespace Termin.Al.Host

open System.Text.Json

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

    type CatalogDirectoryDto =
        { Kind: string
          Id: string
          Path: string
          UpdatedAt: string
          Size: int }

    type CatalogFileDto =
        { Kind: string
          Id: string
          Path: string
          UpdatedAt: string
          Size: int
          DocumentHandle: string }

    type CatalogLockedFileDto =
        { Kind: string
          Id: string
          Path: string
          UpdatedAt: string
          Size: int }

    type CatalogDto =
        { Entries: obj list
          Source: SourceDto
          Cache: CacheDto }

    type PageDocumentDto =
        { Kind: string
          Id: string
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
          CollectionPath: string
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

    let private catalogEntry: ContentDomain.CatalogEntry -> obj =
        function
        | ContentDomain.Directory(id, path, updatedAt, size) ->
            ({ Kind = "directory"
               Id = id |> ContentDomain.CatalogId.value
               Path = path |> ContentDomain.VirtualPath.value
               UpdatedAt = updatedAt |> ContentDomain.Timestamp.value
               Size = size |> ContentDomain.ByteSize.value }
            : CatalogDirectoryDto)
            :> obj
        | ContentDomain.File(id, path, updatedAt, size, documentHandle) ->
            ({ Kind = "file"
               Id = id |> ContentDomain.CatalogId.value
               Path = path |> ContentDomain.VirtualPath.value
               UpdatedAt = updatedAt |> ContentDomain.Timestamp.value
               Size = size |> ContentDomain.ByteSize.value
               DocumentHandle = documentHandle |> ContentDomain.ContentId.value }
            : CatalogFileDto)
            :> obj
        | ContentDomain.LockedFile(id, path, updatedAt, size) ->
            ({ Kind = "locked-file"
               Id = id |> ContentDomain.CatalogId.value
               Path = path |> ContentDomain.VirtualPath.value
               UpdatedAt = updatedAt |> ContentDomain.Timestamp.value
               Size = size |> ContentDomain.ByteSize.value }
            : CatalogLockedFileDto)
            :> obj

    let catalog (catalog: ContentDomain.Catalog) : CatalogDto =
        { Entries = catalog |> ContentDomain.Catalog.entries |> List.map catalogEntry
          Source = catalog |> ContentDomain.Catalog.source |> source
          Cache = catalog |> ContentDomain.Catalog.cache |> cache }

    let document (document: ContentDomain.ContentDocument) : DocumentDto =
        let id = ContentDomain.ContentId.value (ContentDomain.ContentDocument.id document)

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
                { Kind = "page"
                  Id = id
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
          CollectionPath =
            project
            |> ContentDomain.Project.collectionPath
            |> ContentDomain.ProjectCollectionPath.value
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

    let private jsonOptions =
        JsonSerializerOptions(PropertyNamingPolicy = JsonNamingPolicy.CamelCase)

    let serialize response =
        match response with
        | CatalogResponse value -> JsonSerializer.Serialize(value, jsonOptions)
        | DocumentResponse(PageDocument value) -> JsonSerializer.Serialize(value, jsonOptions)
        | DocumentResponse(PublicationDocument value) -> JsonSerializer.Serialize(value, jsonOptions)
        | ProjectsResponse value -> JsonSerializer.Serialize(value, jsonOptions)
        | NowResponse value -> JsonSerializer.Serialize(value, jsonOptions)
        | ChangelogResponse value -> JsonSerializer.Serialize(value, jsonOptions)
        | ProblemResponse value -> JsonSerializer.Serialize(value, jsonOptions)
