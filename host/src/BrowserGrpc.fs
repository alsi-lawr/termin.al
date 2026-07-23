namespace Termin.Al.Host

open System.Globalization
open Grpc.Core
open Google.Protobuf
open Microsoft.AspNetCore.Antiforgery
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.DependencyInjection
open Termin.Al.Contracts.V1

[<RequireQualifiedAccess>]
module private BrowserGrpcWire =
    let sessionKind =
        function
        | Auth.AnonymousView -> SessionKind.Anonymous, ""
        | Auth.GitHubViewerView login -> SessionKind.GithubViewer, login
        | Auth.CvViewerView -> SessionKind.CvViewer, ""
        | Auth.GitHubCvViewerView login -> SessionKind.GithubCvViewer, login
        | Auth.OwnerView login -> SessionKind.Owner, login

    let cache (value: ContentDomain.CacheMetadata) =
        let response = CacheMetadata()

        response.State <-
            match ContentDomain.CacheMetadata.state value with
            | ContentDomain.Fresh -> Termin.Al.Contracts.V1.CacheState.Fresh
            | ContentDomain.Stale -> Termin.Al.Contracts.V1.CacheState.Stale

        response.FetchedAt <- ContentDomain.CacheMetadata.fetchedAt value |> ContentDomain.Timestamp.value
        response.FreshUntil <- ContentDomain.CacheMetadata.freshUntil value |> ContentDomain.Timestamp.value
        response.StaleUntil <- ContentDomain.CacheMetadata.staleUntil value |> ContentDomain.Timestamp.value
        response

    let source (value: ContentDomain.ContentSource) =
        let response = ContentSource()
        response.Repository <- value.Repository |> ContentDomain.RepositoryName.value
        response.Path <- value.Path |> ContentDomain.RepositoryPath.value
        response.Revision <- value.Revision |> ContentDomain.ContentRevision.value
        response.Url <- value.Url |> ContentDomain.ContentUrl.value
        response

    let setContentCacheHeaders (context: ServerCallContext) cache =
        let response = context.GetHttpContext().Response

        match ContentDomain.CacheMetadata.state cache with
        | ContentDomain.Fresh -> response.Headers.CacheControl <- $"public, max-age={ContentDomain.FreshCacheSeconds}"
        | ContentDomain.Stale ->
            response.Headers.CacheControl <- "public, max-age=0, must-revalidate"
            response.Headers.Append("Warning", "110 - \"Response is stale\"")

    let catalogEntry =
        function
        | ContentDomain.Directory(id, path, updatedAt, size) ->
            let response = CatalogEntry()
            response.Kind <- CatalogEntryKind.Directory
            response.Id <- ContentDomain.CatalogId.value id
            response.Path <- ContentDomain.VirtualPath.value path
            response.UpdatedAt <- ContentDomain.Timestamp.value updatedAt
            response.Size <- ContentDomain.ByteSize.value size
            response
        | ContentDomain.File(id, path, updatedAt, size, handle) ->
            let response = CatalogEntry()
            response.Kind <- CatalogEntryKind.File
            response.Id <- ContentDomain.CatalogId.value id
            response.Path <- ContentDomain.VirtualPath.value path
            response.UpdatedAt <- ContentDomain.Timestamp.value updatedAt
            response.Size <- ContentDomain.ByteSize.value size
            response.DocumentHandle <- ContentDomain.ContentId.value handle
            response
        | ContentDomain.LockedFile(id, path, updatedAt, size) ->
            let response = CatalogEntry()
            response.Kind <- CatalogEntryKind.LockedFile
            response.Id <- ContentDomain.CatalogId.value id
            response.Path <- ContentDomain.VirtualPath.value path
            response.UpdatedAt <- ContentDomain.Timestamp.value updatedAt
            response.Size <- ContentDomain.ByteSize.value size
            response

    let document (value: ContentDomain.ContentDocument) =
        let response = DocumentResponse()
        response.Id <- value |> ContentDomain.ContentDocument.id |> ContentDomain.ContentId.value
        response.Path <- value |> ContentDomain.ContentDocument.path |> ContentDomain.VirtualPath.value
        response.Title <- value |> ContentDomain.ContentDocument.title |> ContentDomain.ContentTitle.value

        response.UpdatedAt <-
            value
            |> ContentDomain.ContentDocument.updatedAt
            |> ContentDomain.Timestamp.value

        response.Body <- value |> ContentDomain.ContentDocument.body |> ContentDomain.MarkdownBody.value
        response.RenderedHtml <-
            value
            |> ContentDomain.ContentDocument.renderedHtml
            |> ContentDomain.RenderedHtml.value
        response.Source <- value |> ContentDomain.ContentDocument.source |> source
        response.Cache <- value |> ContentDomain.ContentDocument.cache |> cache

        match value |> ContentDomain.ContentDocument.baseRevisions with
        | None -> ()
        | Some(headSha, blobSha) ->
            let source = value |> ContentDomain.ContentDocument.source
            response.Base <- DocumentBase()
            response.Base.DefaultBranch <- source.Revision |> ContentDomain.ContentRevision.value
            response.Base.HeadSha <- headSha |> ContentDomain.ContentRevision.value
            response.Base.BlobSha <- blobSha |> ContentDomain.ContentRevision.value
            response.Base.RepositoryPath <- source.Path |> ContentDomain.RepositoryPath.value
            response.Base.VirtualPath <- value |> ContentDomain.ContentDocument.path |> ContentDomain.VirtualPath.value

        match value |> ContentDomain.ContentDocument.metadata with
        | ContentDomain.ContentDocumentMetadata.Page -> response.Kind <- DocumentKind.Page
        | ContentDomain.ContentDocumentMetadata.Publication metadata ->
            response.Kind <-
                match ContentDomain.PublicationMetadata.kind metadata with
                | ContentDomain.PublicationKind.Blog -> DocumentKind.Blog
                | ContentDomain.PublicationKind.Note -> DocumentKind.Note

            response.Slug <-
                metadata
                |> ContentDomain.PublicationMetadata.slug
                |> ContentDomain.ContentSlug.value

            response.Summary <-
                metadata
                |> ContentDomain.PublicationMetadata.summary
                |> ContentDomain.ContentSummary.value

            response.Tags.Add(
                metadata
                |> ContentDomain.PublicationMetadata.tags
                |> List.map ContentDomain.ContentTag.value
            )

        response

    let project (value: ContentDomain.ProjectReadme) =
        let project = ContentDomain.ProjectReadme.project value
        let response = Project()
        response.Id <- project |> ContentDomain.Project.id |> ContentDomain.ContentId.value
        response.Slug <- project |> ContentDomain.Project.slug |> ContentDomain.ContentSlug.value
        response.Name <- project |> ContentDomain.Project.name |> ContentDomain.ContentTitle.value
        response.Summary <- project |> ContentDomain.Project.summary |> ContentDomain.ContentSummary.value
        response.Url <- project |> ContentDomain.Project.url |> ContentDomain.ContentUrl.value

        response.Repository <-
            project
            |> ContentDomain.Project.repository
            |> ContentDomain.RepositoryName.value

        response.CollectionPath <-
            project
            |> ContentDomain.Project.collectionPath
            |> ContentDomain.ProjectCollectionPath.value

        response.UpdatedAt <- project |> ContentDomain.Project.updatedAt |> ContentDomain.Timestamp.value
        response.Tags.Add(project |> ContentDomain.Project.tags |> List.map ContentDomain.ContentTag.value)
        response.Readme <- value |> ContentDomain.ProjectReadme.body |> ContentDomain.MarkdownBody.value
        response.RenderedHtml <-
            value
            |> ContentDomain.ProjectReadme.renderedHtml
            |> ContentDomain.RenderedHtml.value
        response

    let commit (value: ContentDomain.Commit) =
        let response = Termin.Al.Contracts.V1.Commit()
        response.Sha <- value |> ContentDomain.Commit.sha |> ContentDomain.CommitSha.value
        response.Summary <- value |> ContentDomain.Commit.summary |> ContentDomain.CommitSummary.value
        response.AuthoredAt <- value |> ContentDomain.Commit.authoredAt |> ContentDomain.Timestamp.value
        response.Url <- value |> ContentDomain.Commit.url |> ContentDomain.ContentUrl.value
        response

    let release (value: ContentDomain.Release) =
        let response = Termin.Al.Contracts.V1.Release()
        response.Tag <- value |> ContentDomain.Release.tag |> ContentDomain.ContentTag.value
        response.Name <- value |> ContentDomain.Release.name |> ContentDomain.ContentTitle.value
        response.PublishedAt <- value |> ContentDomain.Release.publishedAt |> ContentDomain.Timestamp.value
        response.Body <- value |> ContentDomain.Release.body
        response.Url <- value |> ContentDomain.Release.url |> ContentDomain.ContentUrl.value
        response.Commits.Add(value |> ContentDomain.Release.commits |> List.map commit)
        response

    let stats (value: Stats.Snapshot) =
        let response = Termin.Al.Contracts.V1.StatsSnapshot()
        response.TotalSessions <- value.TotalSessions
        response.TotalPageViews <- value.TotalPageViews

        response.StorageState <-
            match value.StorageState with
            | Stats.Writable -> StatsStorageState.Writable
            | Stats.ReadOnly -> StatsStorageState.ReadOnly

        for KeyValue(contentId, pageViews) in value.PageViewsByContent do
            response.PageViewsByContent.Add(StatsContentCount(ContentId = contentId, PageViews = pageViews))

        for day in value.Daily do
            response.Daily.Add(
                StatsDailyCount(
                    Date = day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    Sessions = day.Sessions,
                    PageViews = day.PageViews
                )
            )

        response

    let contentError (problem: ContentDomain.Problem) =
        let status =
            match ContentDomain.Problem.code problem with
            | ContentDomain.InvalidRequest -> StatusCode.InvalidArgument
            | ContentDomain.NotFound -> StatusCode.NotFound
            | ContentDomain.UpstreamUnavailable -> StatusCode.Unavailable
            | ContentDomain.RateLimited -> StatusCode.ResourceExhausted
            | ContentDomain.ConfigurationInvalid -> StatusCode.FailedPrecondition

        RpcException(Status(status, ContentDomain.ProblemCode.title (ContentDomain.Problem.code problem)))

    let generic status title = RpcException(Status(status, title))

    let noStore (context: ServerCallContext) =
        context.GetHttpContext().Response.Headers.CacheControl <- "no-store, no-cache"

type SessionGrpcService() =
    inherit SessionApi.SessionApiBase()

    override _.ReadSession(_: EmptyRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context
            let httpContext = context.GetHttpContext()
            let antiforgery = httpContext.RequestServices.GetRequiredService<IAntiforgery>()
            let tokens = antiforgery.GetAndStoreTokens(httpContext)

            if isNull tokens.RequestToken then
                raise (BrowserGrpcWire.generic StatusCode.Unavailable "Authentication failed.")

            let! session = Auth.resolveSession httpContext
            let kind, login = Auth.sessionView session |> BrowserGrpcWire.sessionKind
            return SessionResponse(Kind = kind, Login = login, CsrfToken = tokens.RequestToken)
        }

    override _.Logout(_: EmptyRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context
            let httpContext = context.GetHttpContext()
            let! valid = Auth.validateMutation httpContext

            if not valid then
                raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "Authentication failed.")

            Auth.clearSession httpContext
            return EmptyRequest()
        }

type ContentGrpcService(contentClient: ContentClient) =
    inherit ContentApi.ContentApiBase()

    override _.ReadRepositoryBase(_: EmptyRequest, context: ServerCallContext) =
        task {
            match! contentClient.GetRepositoryBase context.CancellationToken with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok value ->
                return
                    RepositoryBaseResponse(
                        DefaultBranch = ContentDomain.ContentRevision.value value.DefaultBranch,
                        HeadSha = ContentDomain.ContentRevision.value value.Head
                    )
        }

    override _.ReadCatalog(_: EmptyRequest, context: ServerCallContext) =
        task {
            match! contentClient.GetCatalog context.CancellationToken with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok catalog ->
                BrowserGrpcWire.setContentCacheHeaders context (ContentDomain.Catalog.cache catalog)
                let response = CatalogResponse()
                response.Source <- ContentDomain.Catalog.source catalog |> BrowserGrpcWire.source
                response.Cache <- ContentDomain.Catalog.cache catalog |> BrowserGrpcWire.cache
                response.Entries.Add(ContentDomain.Catalog.entries catalog |> List.map BrowserGrpcWire.catalogEntry)
                return response
        }

    override _.ReadDocument(request: DocumentRequest, context: ServerCallContext) =
        task {
            match ContentDomain.ContentId.tryCreate "document.id" request.Id with
            | Error _ -> return raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "The request is invalid.")
            | Ok id ->
                match! contentClient.GetDocument(id, context.CancellationToken) with
                | Error problem -> return raise (BrowserGrpcWire.contentError problem)
                | Ok document ->
                    BrowserGrpcWire.setContentCacheHeaders context (ContentDomain.ContentDocument.cache document)
                    return BrowserGrpcWire.document document
        }

    override _.ReadProjects(_: EmptyRequest, context: ServerCallContext) =
        task {
            match! contentClient.GetProjects context.CancellationToken with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok projects ->
                BrowserGrpcWire.setContentCacheHeaders context (ContentDomain.Projects.cache projects)
                let response = ProjectsResponse()
                response.Source <- ContentDomain.Projects.source projects |> BrowserGrpcWire.source
                response.Cache <- ContentDomain.Projects.cache projects |> BrowserGrpcWire.cache
                response.Projects.Add(ContentDomain.Projects.entries projects |> List.map BrowserGrpcWire.project)
                return response
        }

    override _.ReadNow(_: EmptyRequest, context: ServerCallContext) =
        task {
            match! contentClient.GetNow context.CancellationToken with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok value ->
                BrowserGrpcWire.setContentCacheHeaders context (ContentDomain.Now.cache value)

                return
                    NowResponse(
                        Title = (value |> ContentDomain.Now.title |> ContentDomain.ContentTitle.value),
                        Body = (value |> ContentDomain.Now.body |> ContentDomain.MarkdownBody.value),
                        RenderedHtml = (value |> ContentDomain.Now.renderedHtml |> ContentDomain.RenderedHtml.value),
                        UpdatedAt = (value |> ContentDomain.Now.updatedAt |> ContentDomain.Timestamp.value),
                        Source = (value |> ContentDomain.Now.source |> BrowserGrpcWire.source),
                        Cache = (value |> ContentDomain.Now.cache |> BrowserGrpcWire.cache)
                    )
        }

    override _.ReadChangelog(_: EmptyRequest, context: ServerCallContext) =
        task {
            match! contentClient.GetChangelog context.CancellationToken with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok value ->
                BrowserGrpcWire.setContentCacheHeaders context (ContentDomain.Changelog.cache value)
                let response = ChangelogResponse()
                response.Source <- ContentDomain.Changelog.source value |> BrowserGrpcWire.source
                response.Cache <- ContentDomain.Changelog.cache value |> BrowserGrpcWire.cache
                response.Unreleased.Add(ContentDomain.Changelog.unreleased value |> List.map BrowserGrpcWire.commit)
                response.Releases.Add(ContentDomain.Changelog.releases value |> List.map BrowserGrpcWire.release)
                response.RenderedHtml <-
                    value |> ContentDomain.Changelog.renderedHtml |> ContentDomain.RenderedHtml.value
                return response
        }

type PublicationGrpcService(publication: GitHubPublication.Client) =
    inherit PublicationApi.PublicationApiBase()

    override _.Publish(request: PublicationRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context
            let httpContext = context.GetHttpContext()
            let! validMutation = Auth.validateMutation httpContext

            if not validMutation then
                return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "Publication failed.")
            else
                match! Auth.resolveOwnerAccessToken httpContext with
                | None -> return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "Publication failed.")
                | Some ownerToken ->
                    let operation =
                        match request.Operation with
                        | PublicationOperation.Add -> Some GitHubPublication.Operation.Add
                        | PublicationOperation.Update -> Some GitHubPublication.Operation.Update
                        | PublicationOperation.Remove -> Some GitHubPublication.Operation.Remove
                        | PublicationOperation.Unspecified
                        | _ -> None

                    match operation with
                    | None -> return raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "Publication failed.")
                    | Some value ->
                        let publicationRequest: GitHubPublication.Request =
                            { Operation = value
                              RepositoryPath = request.RepositoryPath
                              VirtualPath = request.VirtualPath
                              Markdown = request.Markdown
                              ExpectedDefaultBranch = request.ExpectedDefaultBranch
                              ExpectedHeadSha = request.ExpectedHeadSha
                              ExpectedBlobSha = request.ExpectedBlobSha
                              Assets =
                                request.Assets
                                |> Seq.map (fun (asset: Termin.Al.Contracts.V1.PublicationAsset) ->
                                    let value: GitHubPublication.Asset =
                                        { DestinationPath = asset.DestinationPath
                                          DeclaredMediaType = asset.DeclaredMediaType
                                          Bytes = asset.Content.ToByteArray() }

                                    value)
                                |> Seq.toList
                              RemovalConfirmation = request.RemovalConfirmation }

                        match! publication.Publish(ownerToken, publicationRequest, context.CancellationToken) with
                        | GitHubPublication.Result.Invalid ->
                            return raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "Publication failed.")
                        | GitHubPublication.Result.Unavailable ->
                            return raise (BrowserGrpcWire.generic StatusCode.Unavailable "Publication failed.")
                        | GitHubPublication.Result.Published commit ->
                            return
                                PublicationResponse(
                                    Conflict = false,
                                    Sha = commit.Sha,
                                    Url = commit.Url,
                                    DefaultBranch = commit.DefaultBranch,
                                    DocumentBlobSha = commit.DocumentBlobSha
                                )
                        | GitHubPublication.Result.Conflict conflict ->
                            return
                                PublicationResponse(
                                    Conflict = true,
                                    LocalMarkdown = conflict.LocalMarkdown,
                                    UpstreamMarkdown = conflict.UpstreamMarkdown,
                                    DefaultBranch = conflict.DefaultBranch,
                                    HeadSha = conflict.HeadSha,
                                    BlobSha = conflict.BlobSha
                                )
        }

    override _.RemoveManaged(request: ManagedRemovalRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context
            let httpContext = context.GetHttpContext()
            let! validMutation = Auth.validateMutation httpContext

            if not validMutation then
                return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "Removal failed.")
            else
                match! Auth.resolveOwnerAccessToken httpContext with
                | None -> return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "Removal failed.")
                | Some ownerToken ->
                    let removalRequest: GitHubPublication.ManagedRemovalRequest =
                        { VirtualPath = request.VirtualPath
                          Recursive = request.Recursive
                          Confirmation = request.Confirmation }

                    match! publication.RemoveManaged(ownerToken, removalRequest, context.CancellationToken) with
                    | GitHubPublication.ManagedRemovalResult.Invalid ->
                        return raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "Removal failed.")
                    | GitHubPublication.ManagedRemovalResult.Unavailable ->
                        return raise (BrowserGrpcWire.generic StatusCode.Unavailable "Removal failed.")
                    | GitHubPublication.ManagedRemovalResult.Removed commit ->
                        return ManagedRemovalResponse(Sha = commit.Sha, Url = commit.Url)
        }

type StatisticsGrpcService(runtime: Stats.BrowserRuntime) =
    inherit StatisticsApi.StatisticsApiBase()

    override _.ReadSnapshot(_: EmptyRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context

            match! Stats.readSnapshot runtime (context.GetHttpContext()) context.CancellationToken with
            | Stats.SnapshotAvailable value -> return BrowserGrpcWire.stats value
            | Stats.SnapshotUnavailable ->
                return raise (BrowserGrpcWire.generic StatusCode.Unavailable "Statistics are unavailable.")
        }

    override _.RecordView(request: RecordViewRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context

            match! Stats.recordView runtime (context.GetHttpContext()) request.ContentId context.CancellationToken with
            | Stats.Accepted value
            | Stats.Duplicate value -> return BrowserGrpcWire.stats value
            | Stats.RateLimited ->
                return raise (BrowserGrpcWire.generic StatusCode.ResourceExhausted "Statistics are unavailable.")
            | Stats.InvalidContent ->
                return raise (BrowserGrpcWire.generic StatusCode.InvalidArgument "Statistics request failed.")
            | Stats.Unavailable ->
                return raise (BrowserGrpcWire.generic StatusCode.Unavailable "Statistics are unavailable.")
        }

type CvGrpcService() =
    inherit CvApi.CvApiBase()

    override _.Unlock(request: UnlockCvRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context

            match! Cv.unlock (context.GetHttpContext()) request.Key with
            | Cv.Changed -> return EmptyRequest()
            | Cv.RateLimited -> return raise (BrowserGrpcWire.generic StatusCode.ResourceExhausted "CV access failed.")
            | Cv.Rejected -> return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "CV access failed.")
            | Cv.Unavailable -> return raise (BrowserGrpcWire.generic StatusCode.Unavailable "CV access failed.")
        }

    override _.Lock(_: EmptyRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context

            match! Cv.lock (context.GetHttpContext()) with
            | Cv.Changed -> return EmptyRequest()
            | Cv.Rejected -> return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "CV access failed.")
            | Cv.RateLimited
            | Cv.Unavailable -> return raise (BrowserGrpcWire.generic StatusCode.Unavailable "CV access failed.")
        }

    override _.Read(_: EmptyRequest, context: ServerCallContext) =
        task {
            BrowserGrpcWire.noStore context

            match! Cv.read (context.GetHttpContext()) with
            | Cv.Available markdown -> return CvDocumentResponse(Markdown = markdown)
            | Cv.Locked -> return raise (BrowserGrpcWire.generic StatusCode.PermissionDenied "CV access failed.")
            | Cv.DocumentUnavailable ->
                return raise (BrowserGrpcWire.generic StatusCode.Unavailable "CV access failed.")
        }
