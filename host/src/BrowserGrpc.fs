namespace Termin.Al.Host

open System.Threading.Tasks
open Grpc.Core
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
        let state =
            match ContentDomain.CacheMetadata.state value with
            | ContentDomain.Fresh -> Termin.Al.Contracts.V1.CacheState.Fresh
            | ContentDomain.Stale -> Termin.Al.Contracts.V1.CacheState.Stale

        let response = CacheMetadata()
        response.State <- state
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

    let contentError (problem: ContentDomain.Problem) =
        let status =
            match ContentDomain.Problem.code problem with
            | ContentDomain.InvalidRequest -> StatusCode.InvalidArgument
            | ContentDomain.NotFound -> StatusCode.NotFound
            | ContentDomain.UpstreamUnavailable -> StatusCode.Unavailable
            | ContentDomain.RateLimited -> StatusCode.ResourceExhausted
            | ContentDomain.ConfigurationInvalid -> StatusCode.FailedPrecondition

        RpcException(Status(status, ContentDomain.ProblemCode.title (ContentDomain.Problem.code problem)))

type SessionGrpcService() =
    inherit SessionApi.SessionApiBase()

    override _.ReadSession(_: EmptyRequest, context: ServerCallContext) =
        task {
            let httpContext = context.GetHttpContext()
            httpContext.Response.Headers.CacheControl <- "no-store"
            let antiforgery = httpContext.RequestServices.GetRequiredService<IAntiforgery>()
            let tokens = antiforgery.GetAndStoreTokens(httpContext)

            if isNull tokens.RequestToken then
                raise (RpcException(Status(StatusCode.Unavailable, "Authentication failed.")))

            let! session = Auth.resolveSession httpContext
            let kind, login = Auth.sessionView session |> BrowserGrpcWire.sessionKind
            let response = SessionResponse()
            response.Kind <- kind
            response.Login <- login
            response.CsrfToken <- tokens.RequestToken
            return response
        }

type ContentGrpcService(contentClient: ContentClient) =
    inherit ContentApi.ContentApiBase()

    override _.ReadCatalog(_: EmptyRequest, context: ServerCallContext) =
        task {
            let! result = contentClient.GetCatalog context.CancellationToken

            match result with
            | Error problem -> return raise (BrowserGrpcWire.contentError problem)
            | Ok catalog ->
                let httpContext = context.GetHttpContext()

                match ContentDomain.Catalog.cache catalog |> ContentDomain.CacheMetadata.state with
                | ContentDomain.Fresh ->
                    httpContext.Response.Headers.CacheControl <- $"public, max-age={ContentDomain.FreshCacheSeconds}"
                | ContentDomain.Stale ->
                    httpContext.Response.Headers.CacheControl <- "public, max-age=0, must-revalidate"
                    httpContext.Response.Headers.Append("Warning", "110 - \"Response is stale\"")

                let response = CatalogResponse()
                response.Source <- ContentDomain.Catalog.source catalog |> BrowserGrpcWire.source
                response.Cache <- ContentDomain.Catalog.cache catalog |> BrowserGrpcWire.cache

                for entry in ContentDomain.Catalog.entries catalog do
                    response.Entries.Add(BrowserGrpcWire.catalogEntry entry)

                return response
        }
