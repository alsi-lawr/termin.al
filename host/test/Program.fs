namespace Termin.Al.Host.Tests

open System
open System.Net
open System.Net.Http
open System.Text
open System.Threading
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Hosting.Server
open Microsoft.AspNetCore.Hosting.Server.Features
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Termin.Al.Host

module Program =
    let private withRunningHost (application: WebApplication) (action: HttpClient -> unit) =
        application.Urls.Add("http://127.0.0.1:0")

        try
            application.StartAsync().GetAwaiter().GetResult()

            let server = application.Services.GetRequiredService<IServer>()
            let addresses = server.Features.Get<IServerAddressesFeature>()

            if isNull addresses then
                failwith "The test host did not publish a server address."

            let address = addresses.Addresses |> Seq.exactlyOne
            use client = new HttpClient()
            client.BaseAddress <- Uri(address)
            action client
        finally
            application.StopAsync().GetAwaiter().GetResult()
            application.DisposeAsync().AsTask().GetAwaiter().GetResult()

    let private assertProblem (response: HttpResponseMessage) expectedStatus expectedCode =
        if response.StatusCode <> expectedStatus then
            failwithf "Expected API response %O, but received %O." expectedStatus response.StatusCode

        match response.Headers.TryGetValues("Cache-Control") with
        | true, _ -> failwith "Problem responses must not set Cache-Control."
        | false, _ -> ()

        match response.Content.Headers.ContentType with
        | null -> failwith "Expected a problem response content type."
        | contentType when contentType.MediaType <> "application/problem+json" ->
            failwithf "Expected application/problem+json, but received %s." contentType.MediaType
        | _ -> ()

        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if not (body.Contains($"\"code\":\"{expectedCode}\"", StringComparison.Ordinal)) then
            failwithf "Expected problem code '%s', but received %s." expectedCode body

    let private catalogWithCacheState cacheState =
        let requireValid (result: ContentDomain.ValidationResult<'value>) : 'value =
            match result with
            | Ok value -> value
            | Error failure -> failwithf "%s: %s" failure.Field failure.Message

        let timestamp value =
            ContentDomain.Timestamp.tryCreate "test.timestamp" value |> requireValid

        let source =
            ContentDomain.ContentSource.create
                (ContentDomain.RepositoryName.tryCreate "test.repository" "example-owner/content"
                 |> requireValid)
                (ContentDomain.RepositoryPath.tryCreate "test.path" "content/catalog.json"
                 |> requireValid)
                (ContentDomain.ContentRevision.tryCreate "test.revision" "main" |> requireValid)
                (ContentDomain.ContentUrl.tryCreate
                    "test.url"
                    "https://github.com/example-owner/content/blob/main/content/catalog.json"
                 |> requireValid)

        let cache =
            ContentDomain.CacheMetadata.tryCreate
                cacheState
                (timestamp "2026-07-15T00:00:00.000Z")
                (timestamp "2026-07-15T00:05:00.000Z")
                (timestamp "2026-07-15T01:05:00.000Z")
            |> requireValid

        ContentDomain.Catalog.tryCreate
            source
            cache
            [ ContentDomain.Directory(
                  ContentDomain.CatalogId.tryCreate "test.id" "home" |> requireValid,
                  ContentDomain.VirtualPath.tryCreate "test.path" "~" |> requireValid,
                  timestamp "2026-07-15T00:00:00.000Z",
                  ContentDomain.ByteSize.tryCreate "test.size" 0 |> requireValid
              ) ]
        |> requireValid

    let private contentClientWithCacheState cacheState : ContentClient =
        let catalog = catalogWithCacheState cacheState

        { new ContentClient with
            member _.GetCatalog _ = Task.FromResult(Ok catalog)

            member _.GetDocument(_, _) =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetProjects _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetNow _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetChangelog _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing.")) }

    let private staleContentClient () =
        contentClientWithCacheState ContentDomain.Stale

    let private freshContentClient () =
        contentClientWithCacheState ContentDomain.Fresh

    let private runHostContractChecks () =
        HostApplication.create [||]
        |> fun application ->
            withRunningHost application (fun client ->
                use health = client.GetAsync("/healthz").GetAwaiter().GetResult()

                if health.StatusCode <> HttpStatusCode.OK then
                    failwithf "Expected GET /healthz to return 200 OK, but received %O." health.StatusCode

                if health.Headers.CacheControl.ToString() <> "no-store" then
                    failwith "Health responses must not be cached."

                use index = client.GetAsync("/").GetAwaiter().GetResult()

                if index.StatusCode <> HttpStatusCode.OK then
                    failwithf "Expected the static SPA shell to return 200 OK, but received %O." index.StatusCode

                if isNull index.Headers.ETag then
                    failwith "Static files must retain an ETag validator."

                use conditionalIndexRequest = new HttpRequestMessage(HttpMethod.Get, "/")
                conditionalIndexRequest.Headers.IfNoneMatch.Add(index.Headers.ETag)
                use conditionalIndex = client.Send(conditionalIndexRequest)

                if conditionalIndex.StatusCode <> HttpStatusCode.NotModified then
                    failwithf
                        "Expected conditional static GET to return 304 Not Modified, but received %O."
                        conditionalIndex.StatusCode

                use missingConfiguration =
                    client.GetAsync("/api/content/catalog").GetAwaiter().GetResult()

                assertProblem missingConfiguration HttpStatusCode.InternalServerError "configuration-invalid"

                use invalidDocument =
                    client.GetAsync("/api/content/document/%21invalid").GetAwaiter().GetResult()

                assertProblem invalidDocument HttpStatusCode.BadRequest "invalid-request"

                use unknownApiRoute = client.GetAsync("/api/not-here").GetAwaiter().GetResult()
                assertProblem unknownApiRoute HttpStatusCode.NotFound "not-found")

    let private runFreshCacheEndpointCheck () =
        HostApplication.createWithContentClient [||] (freshContentClient ())
        |> fun application ->
            withRunningHost application (fun client ->
                use response = client.GetAsync("/api/content/catalog").GetAwaiter().GetResult()

                if response.StatusCode <> HttpStatusCode.OK then
                    failwithf "Expected fresh catalog response 200, but received %O." response.StatusCode

                let cacheControl =
                    match response.Headers.TryGetValues("Cache-Control") with
                    | true, values -> values |> Seq.exactlyOne
                    | false, _ -> failwith "Fresh content must set Cache-Control."

                if cacheControl <> "public, max-age=300" then
                    failwithf "Expected fresh content Cache-Control public, max-age=300, but received %s." cacheControl

                let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                if not (body.Contains("\"state\":\"fresh\"", StringComparison.Ordinal)) then
                    failwith "Fresh content responses must serialize their fresh cache state.")

    let private runStaleCacheEndpointCheck () =
        HostApplication.createWithContentClient [||] (staleContentClient ())
        |> fun application ->
            withRunningHost application (fun client ->
                use response = client.GetAsync("/api/content/catalog").GetAwaiter().GetResult()

                if response.StatusCode <> HttpStatusCode.OK then
                    failwithf "Expected cached catalog response 200, but received %O." response.StatusCode

                let cacheControl = response.Headers.CacheControl.ToString()

                if
                    not (cacheControl.Contains("public", StringComparison.Ordinal))
                    || not (cacheControl.Contains("max-age=0", StringComparison.Ordinal))
                    || not (cacheControl.Contains("must-revalidate", StringComparison.Ordinal))
                then
                    failwith "Stale content must be marked must-revalidate."

                if not (response.Headers.TryGetValues("Warning") |> fst) then
                    failwith "Stale content must be marked with a warning header."

                let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                if not (body.Contains("\"state\":\"stale\"", StringComparison.Ordinal)) then
                    failwith "Stale content responses must serialize their stale cache state.")

    [<EntryPoint>]
    let main _ =
        try
            GitHubContentClientTests.run ()
            StatsTests.run ()
            runHostContractChecks ()
            runFreshCacheEndpointCheck ()
            runStaleCacheEndpointCheck ()
            0
        with error ->
            eprintfn "Host health check failed: %s" error.Message
            1
