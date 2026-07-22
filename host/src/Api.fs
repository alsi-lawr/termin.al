namespace Termin.Al.Host

open System
open System.Text
open System.Threading
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.AspNetCore.Routing

[<RequireQualifiedAccess>]
module Api =
    let private problemResult (problem: ContentDomain.Problem) : IResult =
        let dto = ContentWire.problem problem
        let body = ContentWire.serialize (ContentWire.ProblemResponse dto)

        Results.Text(
            body,
            "application/problem+json",
            Encoding.UTF8,
            ContentDomain.ProblemCode.status (ContentDomain.Problem.code problem)
        )

    let private setCacheHeaders (context: HttpContext) cache =
        match ContentDomain.CacheMetadata.state cache with
        | ContentDomain.Fresh ->
            context.Response.Headers.CacheControl <- $"public, max-age={ContentDomain.FreshCacheSeconds}"
        | ContentDomain.Stale ->
            context.Response.Headers.CacheControl <- "public, max-age=0, must-revalidate"
            context.Response.Headers.Append("Warning", "110 - \"Response is stale\"")

    let private contentResult context cache response =
        setCacheHeaders context cache
        Results.Text(ContentWire.serialize response, "application/json", Encoding.UTF8, StatusCodes.Status200OK)

    let private documentEndpoint
        (contentClient: ContentClient)
        (context: HttpContext)
        (documentId: string)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            match ContentDomain.ContentId.tryCreate "document.id" documentId with
            | Error _ ->
                return
                    ContentDomain.Problem.create ContentDomain.InvalidRequest "The document identifier is invalid."
                    |> problemResult
            | Ok validatedId ->
                let! result = contentClient.GetDocument(validatedId, cancellationToken)

                return
                    match result with
                    | Ok document ->
                        contentResult
                            context
                            (ContentDomain.ContentDocument.cache document)
                            (ContentWire.DocumentResponse(ContentWire.document document))
                    | Error problem -> problemResult problem
        }

    let private projectsEndpoint
        (contentClient: ContentClient)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            let! result = contentClient.GetProjects cancellationToken

            return
                match result with
                | Ok projects ->
                    contentResult
                        context
                        (ContentDomain.Projects.cache projects)
                        (ContentWire.ProjectsResponse(ContentWire.projects projects))
                | Error problem -> problemResult problem
        }

    let private nowEndpoint
        (contentClient: ContentClient)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            let! result = contentClient.GetNow cancellationToken

            return
                match result with
                | Ok value ->
                    contentResult
                        context
                        (ContentDomain.Now.cache value)
                        (ContentWire.NowResponse(ContentWire.now value))
                | Error problem -> problemResult problem
        }

    let private changelogEndpoint
        (contentClient: ContentClient)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            let! result = contentClient.GetChangelog cancellationToken

            return
                match result with
                | Ok value ->
                    contentResult
                        context
                        (ContentDomain.Changelog.cache value)
                        (ContentWire.ChangelogResponse(ContentWire.changelog value))
                | Error problem -> problemResult problem
        }

    let mapEndpoints (routes: IEndpointRouteBuilder) (contentClient: ContentClient) : unit =
        let api = routes.MapGroup("/api")

        api.MapGet(
            "/content/document/{id}",
            Func<HttpContext, string, CancellationToken, Task<IResult>>(fun context id cancellationToken ->
                documentEndpoint contentClient context id cancellationToken)
        )
        |> ignore

        api.MapGet(
            "/content/projects",
            Func<HttpContext, CancellationToken, Task<IResult>>(projectsEndpoint contentClient)
        )
        |> ignore

        api.MapGet("/content/now", Func<HttpContext, CancellationToken, Task<IResult>>(nowEndpoint contentClient))
        |> ignore

        api.MapGet(
            "/content/changelog",
            Func<HttpContext, CancellationToken, Task<IResult>>(changelogEndpoint contentClient)
        )
        |> ignore

        api.MapFallback(
            Func<HttpContext, IResult>(fun _ ->
                ContentDomain.Problem.create ContentDomain.NotFound "The API route was not found."
                |> problemResult)
        )
        |> ignore
