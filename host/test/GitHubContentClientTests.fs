namespace Termin.Al.Host.Tests

open System
open System.Collections.Generic
open System.IO
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Configuration
open Termin.Al.Host

[<RequireQualifiedAccess>]
module GitHubContentClientTests =
    type private Request =
        { PathAndQuery: string
          Accept: string
          ApiVersion: string option
          UserAgent: string
          IfNoneMatch: string option }

    type private FakeHandler(respond: Request -> HttpResponseMessage) =
        inherit HttpMessageHandler()

        let requests = ResizeArray<Request>()
        let requestsLock = obj ()

        member _.Requests = lock requestsLock (fun () -> requests |> Seq.toList)

        override _.SendAsync(request: HttpRequestMessage, _: CancellationToken) =
            let apiVersion =
                match request.Headers.TryGetValues("X-GitHub-Api-Version") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            let ifNoneMatch =
                match request.Headers.TryGetValues("If-None-Match") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            let captured =
                { PathAndQuery = request.RequestUri.PathAndQuery
                  Accept = request.Headers.Accept.ToString()
                  ApiVersion = apiVersion
                  UserAgent = request.Headers.UserAgent.ToString()
                  IfNoneMatch = ifNoneMatch }

            lock requestsLock (fun () -> requests.Add captured)
            Task.FromResult(respond captured)

    type private RequestGate() =
        let requestEntered =
            TaskCompletionSource<unit>(TaskCreationOptions.RunContinuationsAsynchronously)

        let release =
            TaskCompletionSource<unit>(TaskCreationOptions.RunContinuationsAsynchronously)

        member _.Enter() = requestEntered.TrySetResult() |> ignore
        member _.WaitForRequest() = requestEntered.Task
        member _.Release() = release.TrySetResult() |> ignore
        member _.WaitForRelease() = release.Task

    type private GatedHandler(gateForRequest: Request -> RequestGate option, respond: Request -> HttpResponseMessage) =
        inherit HttpMessageHandler()

        let requests = ResizeArray<Request>()
        let requestsLock = obj ()

        member _.Requests = lock requestsLock (fun () -> requests |> Seq.toList)

        override _.SendAsync(request: HttpRequestMessage, _: CancellationToken) =
            let apiVersion =
                match request.Headers.TryGetValues("X-GitHub-Api-Version") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            let ifNoneMatch =
                match request.Headers.TryGetValues("If-None-Match") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            let captured =
                { PathAndQuery = request.RequestUri.PathAndQuery
                  Accept = request.Headers.Accept.ToString()
                  ApiVersion = apiVersion
                  UserAgent = request.Headers.UserAgent.ToString()
                  IfNoneMatch = ifNoneMatch }

            lock requestsLock (fun () -> requests.Add captured)

            match gateForRequest captured with
            | Some gate ->
                task {
                    gate.Enter()
                    do! gate.WaitForRelease()
                    return respond captured
                }
            | None -> Task.FromResult(respond captured)

    type private CancelledHandler() =
        inherit HttpMessageHandler()

        override _.SendAsync(_: HttpRequestMessage, _: CancellationToken) =
            Task.FromCanceled<HttpResponseMessage>(CancellationToken(true))

    let private response status body etag =
        let value = new HttpResponseMessage(status)

        if not (String.IsNullOrEmpty body) then
            value.Content <- new StringContent(body, Encoding.UTF8, "application/json")

        match etag with
        | Some tag -> value.Headers.ETag <- EntityTagHeaderValue(tag)
        | None -> ()

        value

    let private linkResponse status body etag next =
        let value = response status body etag

        value.Headers.TryAddWithoutValidation("Link", $"<{next}>; rel=\"next\"")
        |> ignore

        value

    let private repositoryJson fullName description =
        $"{{\"full_name\":\"{fullName}\",\"default_branch\":\"main\",\"html_url\":\"https://github.com/{fullName}\",\"updated_at\":\"2026-07-15T00:00:00Z\",\"description\":{description},\"fork\":false,\"archived\":false,\"private\":false,\"owner\":{{\"login\":\"example-owner\"}}}}"

    let private releaseJson tag publishedAt =
        $"{{\"draft\":false,\"prerelease\":false,\"tag_name\":\"{tag}\",\"name\":\"{tag}\",\"published_at\":\"{publishedAt}\",\"body\":\"Release body\",\"html_url\":\"https://github.com/example-owner/application/releases/tag/{tag}\"}}"

    let private releasePage releases = "[" + String.concat "," releases + "]"

    let private draftReleaseJson tag =
        $"{{\"draft\":true,\"prerelease\":false,\"tag_name\":\"{tag}\",\"name\":\"{tag}\",\"published_at\":\"2026-07-01T00:00:00Z\",\"body\":\"Draft body\",\"html_url\":\"https://github.com/example-owner/application/releases/tag/{tag}\"}}"

    let private gitObjectJson objectType sha =
        $"{{\"object\":{{\"type\":\"{objectType}\",\"sha\":\"{sha}\"}}}}"

    let private commitJson sha summary authoredAt =
        $"{{\"sha\":\"{sha}\",\"html_url\":\"https://github.com/example-owner/application/commit/{sha}\",\"commit\":{{\"message\":\"{summary}\",\"author\":{{\"date\":\"{authoredAt}\"}}}}}}"

    let private comparisonJson status behindBy totalCommits baseCommit mergeBase commits =
        let rows = String.concat "," commits

        $"{{\"status\":\"{status}\",\"ahead_by\":{totalCommits},\"behind_by\":{behindBy},\"total_commits\":{totalCommits},\"base_commit\":{{\"sha\":\"{baseCommit}\"}},\"merge_base_commit\":{{\"sha\":\"{mergeBase}\"}},\"commits\":[{rows}]}}"

    let private commitShas (commits: ContentDomain.Commit list) =
        commits |> List.map (ContentDomain.Commit.sha >> ContentDomain.CommitSha.value)

    let private catalogManifest =
        "{\"entries\":[{\"kind\":\"directory\",\"id\":\"home\",\"path\":\"~\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":0},{\"kind\":\"file\",\"id\":\"about-document\",\"path\":\"~/about.md\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":64,\"documentHandle\":\"about\",\"sourcePath\":\"content/about.md\"}]}"

    let private fractionalCatalogManifest () =
        let path =
            Path.Combine(AppContext.BaseDirectory, "contracts", "fixtures", "catalog-fractional-size.json")

        use document = JsonDocument.Parse(File.ReadAllText path)
        let entries = document.RootElement.GetProperty("entries").GetRawText()
        "{\"entries\":" + entries + "}"

    let private projectsManifest =
        "{\"projects\":[{\"id\":\"curated-project\",\"slug\":\"curated-project\",\"name\":\"Curated Project\",\"summary\":\"Curated project summary.\",\"url\":\"https://github.com/example-owner/curated-project\",\"repository\":\"example-owner/curated-project\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"fsharp\"]}]}"

    let private emptyProjectsManifest = "{\"projects\":[]}"

    let private githubConfiguration () =
        let values = Dictionary<string, string>()
        values.Add("GitHub:Owner", "example-owner")
        values.Add("GitHub:ContentRepository", "content")
        values.Add("GitHub:ApplicationRepository", "application")
        values.Add("GitHub:ProfileRepository", "profile")

        ConfigurationBuilder().AddInMemoryCollection(values).Build()
        |> GitHubContentConfiguration.tryCreate
        |> function
            | Ok value -> value
            | Error problem -> failwith (ContentDomain.Problem.detail problem)

    let private createClient handler clock =
        let httpClient = new HttpClient(handler)

        let contentClient =
            GitHubContentClient.create httpClient (githubConfiguration ()) clock

        httpClient, contentClient

    let private expectOk (result: Result<'value, ContentDomain.Problem>) : 'value =
        match result with
        | Ok value -> value
        | Error problem -> failwithf "Expected content, but got %s." (ContentDomain.Problem.detail problem)

    let private countRequests path (requests: Request list) =
        requests
        |> List.filter (fun request -> request.PathAndQuery = path)
        |> List.length

    let private testColdCache304AndStaleFallback () =
        let mutable now = DateTimeOffset.Parse("2026-07-15T00:00:00Z")
        let mutable stage = 0

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery, stage with
                | "/repos/example-owner/content", 0 ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/content" "\"Content repository\"")
                        (Some "\"content-v1\"")
                | "/repos/example-owner/content/contents/content/catalog.json?ref=main", 0 ->
                    response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                | "/repos/example-owner/content", 1
                | "/repos/example-owner/content/contents/content/catalog.json?ref=main", 1 ->
                    response HttpStatusCode.NotModified "" None
                | "/repos/example-owner/content", 2
                | "/repos/example-owner/content/contents/content/catalog.json?ref=main", 2 ->
                    response HttpStatusCode.ServiceUnavailable "" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient = createClient handler (fun () -> now)
        use httpClient = createdHttpClient

        let first =
            match contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
            | Ok value -> value
            | Error problem ->
                failwithf
                    "Expected cold catalog content, but got %s after requests %A."
                    (ContentDomain.Problem.detail problem)
                    handler.Requests

        let afterFirst = handler.Requests |> List.length

        let second =
            contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if handler.Requests |> List.length <> afterFirst then
            failwith "Fresh catalog requests must use the cache."

        if
            ContentDomain.CacheMetadata.state (ContentDomain.Catalog.cache second)
            <> ContentDomain.Fresh
        then
            failwith "Fresh cached content must report a fresh cache state."

        stage <- 1
        now <- now.AddMinutes(6.0)

        let third =
            contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if
            ContentDomain.CacheMetadata.state (ContentDomain.Catalog.cache third)
            <> ContentDomain.Fresh
        then
            failwith "A 304 response must refresh the cache."

        if
            handler.Requests
            |> List.exists (fun request -> request.IfNoneMatch = Some "\"catalog-v1\"")
            |> not
        then
            failwith "Expired GitHub content requests must send If-None-Match."

        stage <- 2
        now <- now.AddMinutes(6.0)

        let stale =
            contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if
            ContentDomain.CacheMetadata.state (ContentDomain.Catalog.cache stale)
            <> ContentDomain.Stale
        then
            failwith "A failed refresh inside the stale allowance must return stale content."

        if
            handler.Requests
            |> List.exists (fun request ->
                request.Accept.Contains("application/vnd.github", StringComparison.Ordinal)
                && request.ApiVersion = Some "2026-03-10"
                && request.UserAgent = "termin.al-content")
            |> not
        then
            failwith "GitHub requests must send official media, version, and user-agent headers."

        if first |> ContentDomain.Catalog.entries |> List.length <> 2 then
            failwith "Catalog manifest entries were not supplied."

        now <- now.AddMinutes(60.0)

        match contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "Expired cached payloads must not be retained for stale fallback."

        match handler.Requests |> List.last with
        | { PathAndQuery = "/repos/example-owner/content"
            IfNoneMatch = None } -> ()
        | _ -> failwith "Expired cached payloads must not retain conditional request validators."

    let private testSameKeyColdRequests () =
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let contentRepositoryGate = new RequestGate()
        let catalogGate = new RequestGate()

        let gates =
            [ contentRepositoryPath, contentRepositoryGate; catalogPath, catalogGate ]
            |> Map.ofList

        let handler =
            new GatedHandler(
                (fun request -> Map.tryFind request.PathAndQuery gates),
                fun request ->
                    match request.PathAndQuery with
                    | path when path = contentRepositoryPath ->
                        response
                            HttpStatusCode.OK
                            (repositoryJson "example-owner/content" "\"Content repository\"")
                            (Some "\"content-v1\"")
                    | path when path = catalogPath -> response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                    | _ -> response HttpStatusCode.NotFound "" None
            )

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let first = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.WaitForRequest().GetAwaiter().GetResult()

        let second = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.Release()
        catalogGate.WaitForRequest().GetAwaiter().GetResult()
        catalogGate.Release()

        Task.WhenAll([| first; second |]).GetAwaiter().GetResult()
        |> Array.iter (fun result -> expectOk result |> ignore)

        let requests = handler.Requests

        if
            countRequests contentRepositoryPath requests <> 1
            || countRequests catalogPath requests <> 1
        then
            failwith "Same-key cold callers must share one upstream request for each payload key."

        let requestCount = List.length requests

        contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectOk
        |> ignore

        if handler.Requests |> List.length <> requestCount then
            failwith "Completed cold fetches must leave reusable fresh cache payloads."

    let private testSameKeyStaleRequests () =
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let contentRepositoryGate = new RequestGate()
        let catalogGate = new RequestGate()

        let gates =
            [ contentRepositoryPath, contentRepositoryGate; catalogPath, catalogGate ]
            |> Map.ofList

        let mutable now = DateTimeOffset.Parse("2026-07-15T00:00:00Z")
        let mutable isRefresh = false

        let handler =
            new GatedHandler(
                (fun request ->
                    if isRefresh then
                        Map.tryFind request.PathAndQuery gates
                    else
                        None),
                fun request ->
                    match request.PathAndQuery, isRefresh with
                    | path, false when path = contentRepositoryPath ->
                        response
                            HttpStatusCode.OK
                            (repositoryJson "example-owner/content" "\"Content repository\"")
                            (Some "\"content-v1\"")
                    | path, false when path = catalogPath ->
                        response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                    | path, true when path = contentRepositoryPath || path = catalogPath ->
                        response HttpStatusCode.NotModified "" None
                    | _ -> response HttpStatusCode.NotFound "" None
            )

        let createdHttpClient, contentClient = createClient handler (fun () -> now)
        use httpClient = createdHttpClient

        contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectOk
        |> ignore

        let initialRequestCount = handler.Requests |> List.length
        now <- now.AddMinutes(6.0)
        isRefresh <- true

        let first = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.WaitForRequest().GetAwaiter().GetResult()

        let second = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.Release()
        catalogGate.WaitForRequest().GetAwaiter().GetResult()
        catalogGate.Release()

        Task.WhenAll([| first; second |]).GetAwaiter().GetResult()
        |> Array.iter (fun result ->
            let catalog = expectOk result

            if
                ContentDomain.Catalog.cache catalog |> ContentDomain.CacheMetadata.state
                <> ContentDomain.Fresh
            then
                failwith "A coalesced stale refresh must return fresh content after a 304 response.")

        let refreshRequests = handler.Requests |> List.skip initialRequestCount

        if
            countRequests contentRepositoryPath refreshRequests <> 1
            || countRequests catalogPath refreshRequests <> 1
        then
            failwith "Same-key stale callers must share one conditional refresh per payload key."

        if
            refreshRequests
            |> List.exists (fun request -> request.IfNoneMatch = Some "\"catalog-v1\"")
            |> not
        then
            failwith "Coalesced stale refreshes must retain ETag validation."

    let private testCallerCancellationDoesNotCancelSharedFetch () =
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let contentRepositoryGate = new RequestGate()
        let catalogGate = new RequestGate()

        let gates =
            [ contentRepositoryPath, contentRepositoryGate; catalogPath, catalogGate ]
            |> Map.ofList

        let handler =
            new GatedHandler(
                (fun request -> Map.tryFind request.PathAndQuery gates),
                fun request ->
                    match request.PathAndQuery with
                    | path when path = contentRepositoryPath ->
                        response
                            HttpStatusCode.OK
                            (repositoryJson "example-owner/content" "\"Content repository\"")
                            (Some "\"content-v1\"")
                    | path when path = catalogPath -> response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                    | _ -> response HttpStatusCode.NotFound "" None
            )

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient
        use cancelledCaller = new CancellationTokenSource()

        let cancelled = contentClient.GetCatalog(cancelledCaller.Token)
        contentRepositoryGate.WaitForRequest().GetAwaiter().GetResult()

        let retained = contentClient.GetCatalog(CancellationToken.None)
        cancelledCaller.Cancel()

        try
            cancelled.GetAwaiter().GetResult() |> ignore
            failwith "Cancelling one caller must cancel that caller's wait."
        with :? OperationCanceledException ->
            ()

        contentRepositoryGate.Release()
        catalogGate.WaitForRequest().GetAwaiter().GetResult()
        catalogGate.Release()

        retained.GetAwaiter().GetResult() |> expectOk |> ignore

        let requests = handler.Requests

        if
            countRequests contentRepositoryPath requests <> 1
            || countRequests catalogPath requests <> 1
        then
            failwith "Cancelling one caller must not start a duplicate or cancel the shared fetch."

    let private testFailedSharedFetchCanRetryImmediately () =
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let contentRepositoryGate = new RequestGate()
        let retryGate = new RequestGate()
        let mutable failFetch = true

        let handler =
            new GatedHandler(
                (fun request ->
                    match request.PathAndQuery, failFetch with
                    | path, true when path = contentRepositoryPath -> Some contentRepositoryGate
                    | path, false when path = contentRepositoryPath -> Some retryGate
                    | _ -> None),
                fun request ->
                    match request.PathAndQuery, failFetch with
                    | path, true when path = contentRepositoryPath -> response HttpStatusCode.ServiceUnavailable "" None
                    | path, false when path = contentRepositoryPath ->
                        response
                            HttpStatusCode.OK
                            (repositoryJson "example-owner/content" "\"Content repository\"")
                            (Some "\"content-v1\"")
                    | path, false when path = catalogPath ->
                        response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                    | _ -> response HttpStatusCode.NotFound "" None
            )

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let first = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.WaitForRequest().GetAwaiter().GetResult()

        let second = contentClient.GetCatalog(CancellationToken.None)
        contentRepositoryGate.Release()

        match first.GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "The first failed caller must receive the typed upstream failure."

        failFetch <- false

        let retry = contentClient.GetCatalog(CancellationToken.None)
        retryGate.WaitForRequest().GetAwaiter().GetResult()

        match second.GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "Concurrent failed callers must receive the typed upstream failure."

        retryGate.Release()

        retry.GetAwaiter().GetResult() |> expectOk |> ignore

        let requests = handler.Requests

        if
            countRequests contentRepositoryPath requests <> 2
            || countRequests catalogPath requests <> 1
        then
            failwith "An immediate request after a failed shared fetch must start a new upstream attempt."

    let private testDifferentKeysRemainParallel () =
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let documentPath = "/repos/example-owner/content/contents/content/about.md?ref=main"

        let projectsPath =
            "/repos/example-owner/content/contents/content/projects.json?ref=main"

        let documentGate = new RequestGate()
        let projectsGate = new RequestGate()

        let gates = [ documentPath, documentGate; projectsPath, projectsGate ] |> Map.ofList

        let handler =
            new GatedHandler(
                (fun request -> Map.tryFind request.PathAndQuery gates),
                fun request ->
                    match request.PathAndQuery with
                    | path when path = contentRepositoryPath ->
                        response
                            HttpStatusCode.OK
                            (repositoryJson "example-owner/content" "\"Content repository\"")
                            (Some "\"content-v1\"")
                    | path when path = catalogPath -> response HttpStatusCode.OK catalogManifest (Some "\"catalog-v1\"")
                    | path when path = documentPath ->
                        response HttpStatusCode.OK "---\n{\"title\":\"About\"}\n---\n# About\n" (Some "\"about-v1\"")
                    | path when path = projectsPath ->
                        response HttpStatusCode.OK emptyProjectsManifest (Some "\"projects-v1\"")
                    | "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ->
                        response HttpStatusCode.OK "[]" (Some "\"owned-v1\"")
                    | _ -> response HttpStatusCode.NotFound "" None
            )

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectOk
        |> ignore

        let aboutId =
            match ContentDomain.ContentId.tryCreate "test.documentId" "about" with
            | Ok value -> value
            | Error failure -> failwithf "%s: %s" failure.Field failure.Message

        let document = contentClient.GetDocument(aboutId, CancellationToken.None)
        documentGate.WaitForRequest().GetAwaiter().GetResult()

        let projects = contentClient.GetProjects(CancellationToken.None)
        projectsGate.WaitForRequest().GetAwaiter().GetResult()

        documentGate.Release()
        projectsGate.Release()

        document.GetAwaiter().GetResult() |> expectOk |> ignore

        projects.GetAwaiter().GetResult() |> expectOk |> ignore

        let requests = handler.Requests

        if
            countRequests documentPath requests <> 1
            || countRequests projectsPath requests <> 1
        then
            failwith "Different cache keys must retain independent parallel upstream requests."

    let private testPublicationMetadata () =
        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let publicationPath =
            "/repos/example-owner/content/contents/blog/validated-metadata.md?ref=main"

        let manifest =
            "{\"entries\":[{\"kind\":\"directory\",\"id\":\"home\",\"path\":\"~\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":0},{\"kind\":\"directory\",\"id\":\"blog\",\"path\":\"~/blog\",\"updatedAt\":\"2026-07-15T00:00:01.000Z\",\"size\":0},{\"kind\":\"file\",\"id\":\"validated-metadata-document\",\"path\":\"~/blog/validated-metadata.md\",\"updatedAt\":\"2026-07-15T00:00:04.000Z\",\"size\":256,\"documentHandle\":\"blog-validated-metadata\",\"sourcePath\":\"blog/validated-metadata.md\"}]}"

        let markdown =
            "---\n{\"title\":\"Validated Metadata\",\"summary\":\"The supplied publication summary.\",\"publishedAt\":\"2026-07-10T00:00:00.000Z\",\"tags\":[\"fsharp\",\"content\"]}\n---\n# Body Heading\n\nThis body paragraph is not the supplied summary."

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/content" ->
                    response HttpStatusCode.OK (repositoryJson "example-owner/content" "\"Content repository\"") None
                | path when path = catalogPath -> response HttpStatusCode.OK manifest None
                | path when path = publicationPath -> response HttpStatusCode.OK markdown None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.Parse("2026-07-15T00:00:00Z"))

        use httpClient = createdHttpClient

        let documentId =
            match ContentDomain.ContentId.tryCreate "test.documentId" "blog-validated-metadata" with
            | Ok value -> value
            | Error failure -> failwithf "%s: %s" failure.Field failure.Message

        let document =
            contentClient.GetDocument(documentId, CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        let updatedAt =
            document
            |> ContentDomain.ContentDocument.updatedAt
            |> ContentDomain.Timestamp.value

        match document |> ContentDomain.ContentDocument.metadata with
        | ContentDomain.ContentDocumentMetadata.Page ->
            failwith "A blog repository path must produce publication metadata."
        | ContentDomain.ContentDocumentMetadata.Publication metadata ->
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
                updatedAt <> "2026-07-15T00:00:04.000Z"
                || summary <> "The supplied publication summary."
                || publishedAt <> "2026-07-10T00:00:00.000Z"
                || tags <> [ "fsharp"; "content" ]
            then
                failwith "The live supplier must preserve validated publication metadata and update time."

    let private testPayloadCacheRetention () =
        let cacheDocumentId index = sprintf "cache-document-%03d" index

        let cacheDocumentPath index =
            sprintf "content/cache-document-%03d.md" index

        let cacheSha (index: int) = index.ToString("x").PadLeft(40, '0')
        let cacheReleaseTag index = sprintf "cache-release-%03d" index
        let cacheHead = cacheSha 9_999
        let contentRepositoryPath = "/repos/example-owner/content"

        let catalogPath =
            "/repos/example-owner/content/contents/content/catalog.json?ref=main"

        let ordinalFirstTieDocumentPath =
            "/repos/example-owner/content/contents/content/cache-document-001.md?ref=main"

        let ordinalSecondTieDocumentPath =
            "/repos/example-owner/content/contents/content/cache-document-002.md?ref=main"

        let projectsPath =
            "/repos/example-owner/content/contents/content/projects.json?ref=main"

        let documents =
            [ 1 .. ContentDomain.PageItemLimit - 1 ]
            |> List.map (fun index ->
                let id = cacheDocumentId index
                let path = cacheDocumentPath index

                let body = $"---\n{{\"title\":\"Cache document {index}\"}}\n---\n# {id}\n"

                id, path, body)

        let cacheCatalogManifest =
            documents
            |> List.map (fun (id, path, _) ->
                $"{{\"kind\":\"file\",\"id\":\"catalog-{id}\",\"path\":\"~/{id}.md\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":64,\"documentHandle\":\"{id}\",\"sourcePath\":\"{path}\"}}")
            |> List.append
                [ "{\"kind\":\"directory\",\"id\":\"home\",\"path\":\"~\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":0}" ]
            |> String.concat ","
            |> fun entries -> $"{{\"entries\":[{entries}]}}"

        let documentResponses =
            documents
            |> List.map (fun (_, path, body) -> $"/repos/example-owner/content/contents/{path}?ref=main", body)
            |> Map.ofList

        let cacheReleaseResponses =
            [ 1..99 ]
            |> List.collect (fun index ->
                let tag = cacheReleaseTag index
                let tagObject = cacheSha (1_000 + index)
                let commit = cacheSha (2_000 + index)

                [ $"/repos/example-owner/application/git/ref/tags/{tag}", gitObjectJson "tag" tagObject
                  $"/repos/example-owner/application/git/tags/{tagObject}", gitObjectJson "commit" commit ])
            |> Map.ofList

        let cacheReleasePositions =
            [ 1..99 ]
            |> List.map (fun index -> cacheSha (2_000 + index), index)
            |> Map.ofList

        let cacheReleases =
            [ 1..99 ]
            |> List.map (fun index -> releaseJson (cacheReleaseTag index) "2026-07-15T00:00:00Z")
            |> releasePage

        let cacheProjectRows =
            [ 1..6 ]
            |> List.map (fun index ->
                repositoryJson $"example-owner/cache-project-{index}" "\"Cache project description\"")
            |> String.concat ","
            |> fun rows -> $"[{rows}]"

        let releasesPath = "/repos/example-owner/application/releases?per_page=100"
        let releasesPageTwo = "/repos/example-owner/application/releases?page=2"
        let ownedRepositoriesPageTwo = "/users/example-owner/repos?page=2"
        let comparisonPrefix = "/repos/example-owner/application/compare/"

        let comparisonBody baseCommit aheadBy =
            $"{{\"status\":\"ahead\",\"ahead_by\":{aheadBy},\"behind_by\":0,\"total_commits\":0,\"base_commit\":{{\"sha\":\"{baseCommit}\"}},\"merge_base_commit\":{{\"sha\":\"{baseCommit}\"}},\"commits\":[]}}"

        let mutable stage = 0

        let handler =
            new FakeHandler(fun request ->
                let path = request.PathAndQuery

                if path = contentRepositoryPath && (stage = 1 || stage = 3) then
                    response HttpStatusCode.ServiceUnavailable "" None
                elif stage = 3 && path = ordinalFirstTieDocumentPath then
                    response HttpStatusCode.ServiceUnavailable "" None
                elif stage = 2 && path = releasesPath then
                    linkResponse
                        HttpStatusCode.OK
                        cacheReleases
                        (Some "\"cache-releases\"")
                        $"https://api.github.com{releasesPageTwo}"
                elif request.IfNoneMatch.IsSome then
                    response HttpStatusCode.NotModified "" None
                else
                    match Map.tryFind path documentResponses, Map.tryFind path cacheReleaseResponses with
                    | Some body, _ -> response HttpStatusCode.OK body (Some "\"cache-document\"")
                    | None, Some body -> response HttpStatusCode.OK body (Some "\"cache-tag\"")
                    | None, None ->
                        match path with
                        | "/repos/example-owner/content" ->
                            response
                                HttpStatusCode.OK
                                (repositoryJson "example-owner/content" "\"Content repository\"")
                                (Some "\"cache-content\"")
                        | "/repos/example-owner/content/contents/content/catalog.json?ref=main" ->
                            response HttpStatusCode.OK cacheCatalogManifest (Some "\"cache-catalog\"")
                        | "/repos/example-owner/content/contents/content/projects.json?ref=main" ->
                            response HttpStatusCode.OK emptyProjectsManifest (Some "\"cache-projects\"")
                        | "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ->
                            linkResponse
                                HttpStatusCode.OK
                                cacheProjectRows
                                (Some "\"cache-owned\"")
                                $"https://api.github.com{ownedRepositoriesPageTwo}"
                        | "/users/example-owner/repos?page=2" ->
                            response HttpStatusCode.OK "[]" (Some "\"cache-owned-page-two\"")
                        | "/repos/example-owner/application" ->
                            response
                                HttpStatusCode.OK
                                (repositoryJson "example-owner/application" "\"Application repository\"")
                                (Some "\"cache-application\"")
                        | "/repos/example-owner/profile" ->
                            response
                                HttpStatusCode.OK
                                (repositoryJson "example-owner/profile" "\"Profile repository\"")
                                (Some "\"cache-profile\"")
                        | "/users/example-owner/events/public?per_page=100" ->
                            response HttpStatusCode.OK "[]" (Some "\"cache-activity\"")
                        | "/repos/example-owner/application/readme?ref=main" ->
                            response HttpStatusCode.OK "# Application" (Some "\"cache-application-readme\"")
                        | "/repos/example-owner/profile/readme?ref=main" ->
                            response HttpStatusCode.OK "# Profile" (Some "\"cache-profile-readme\"")
                        | "/repos/example-owner/application/releases?per_page=100" ->
                            response HttpStatusCode.OK cacheReleases (Some "\"cache-releases\"")
                        | "/repos/example-owner/application/releases?page=2" ->
                            response HttpStatusCode.OK "[]" (Some "\"cache-releases-page-two\"")
                        | "/repos/example-owner/application/git/ref/heads/main" ->
                            response HttpStatusCode.OK (gitObjectJson "commit" cacheHead) (Some "\"cache-head\"")
                        | projectReadme when
                            projectReadme.StartsWith("/repos/example-owner/cache-project-", StringComparison.Ordinal)
                            && projectReadme.EndsWith("/readme?ref=main", StringComparison.Ordinal)
                            ->
                            response HttpStatusCode.OK "# Cache project" (Some "\"cache-project-readme\"")
                        | comparison when comparison.StartsWith(comparisonPrefix, StringComparison.Ordinal) ->
                            let range =
                                comparison
                                    .Substring(comparisonPrefix.Length)
                                    .Replace("?per_page=100", "", StringComparison.Ordinal)

                            let commits = range.Split([| "..." |], StringSplitOptions.None)

                            if commits.Length <> 2 then
                                failwithf "Unexpected comparison request '%s'." comparison

                            let aheadBy =
                                if StringComparer.Ordinal.Equals(commits[1], cacheHead) then
                                    match Map.tryFind commits[0] cacheReleasePositions with
                                    | Some value -> value
                                    | None -> failwithf "Unexpected release comparison '%s'." comparison
                                else
                                    1

                            response
                                HttpStatusCode.OK
                                (comparisonBody commits[0] aheadBy)
                                (Some "\"cache-comparison\"")
                        | _ -> failwithf "Unexpected cache retention request '%s'." path)

        let mutable now = DateTimeOffset.Parse("2026-07-15T00:00:00Z")
        let createdHttpClient, contentClient = createClient handler (fun () -> now)
        use httpClient = createdHttpClient

        let expectCacheContent label result =
            match result with
            | Ok value -> value
            | Error problem -> failwithf "%s: %s" label (ContentDomain.Problem.detail problem)

        contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Initial cache catalog"
        |> ignore

        now <- now.AddMinutes(1.0)

        for (id, _, _) in documents do
            let documentId =
                match ContentDomain.ContentId.tryCreate "test.documentId" id with
                | Ok value -> value
                | Error failure -> failwithf "%s: %s" failure.Field failure.Message

            contentClient.GetDocument(documentId, CancellationToken.None).GetAwaiter().GetResult()
            |> expectCacheContent $"Initial cache document {id}"
            |> ignore

            if id = cacheDocumentId 2 then
                now <- now.AddMinutes(5.0)

                contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
                |> expectCacheContent "Refresh cache catalog before the equal-time eviction tie"
                |> ignore

                now <- now.AddMinutes(1.0)

        contentClient.GetProjects(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Initial cache projects"
        |> ignore

        contentClient.GetNow(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Initial cache now"
        |> ignore

        contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Initial cache changelog"
        |> ignore

        let initialPayloadRequests =
            handler.Requests |> List.filter (fun request -> request.IfNoneMatch.IsNone)

        if initialPayloadRequests |> List.length <> 512 then
            failwithf "Expected 512 retained payload requests, but received %d." (initialPayloadRequests |> List.length)

        stage <- 1
        now <- now.AddMinutes(6.0)

        contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Retained stale cache catalog"
        |> ignore

        stage <- 2

        contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Overflow cache changelog"
        |> ignore

        let requestsAfterOverflow = handler.Requests |> List.length
        now <- now.AddMinutes(1.0)

        contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Refreshed cache changelog"
        |> ignore

        if handler.Requests |> List.length <> requestsAfterOverflow then
            failwith "A refreshed payload must remain cached after the 513th payload is admitted."

        let ordinalSecondTieDocumentId =
            match ContentDomain.ContentId.tryCreate "test.documentId" (cacheDocumentId 2) with
            | Ok value -> value
            | Error failure -> failwithf "%s: %s" failure.Field failure.Message

        contentClient.GetDocument(ordinalSecondTieDocumentId, CancellationToken.None).GetAwaiter().GetResult()
        |> expectCacheContent "Retained ordinal-later equal-time cache document"
        |> ignore

        match handler.Requests |> List.last with
        | { PathAndQuery = path
            IfNoneMatch = Some _ } when path = ordinalSecondTieDocumentPath -> ()
        | _ -> failwith "The ordinal-later equal-time cache key must remain retained after overflow."

        stage <- 3

        let ordinalFirstTieDocumentId =
            match ContentDomain.ContentId.tryCreate "test.documentId" (cacheDocumentId 1) with
            | Ok value -> value
            | Error failure -> failwithf "%s: %s" failure.Field failure.Message

        match contentClient.GetDocument(ordinalFirstTieDocumentId, CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "The ordinal-first equal-time cache key must be evicted before the 513th payload is admitted."

        match handler.Requests |> List.last with
        | { PathAndQuery = path
            IfNoneMatch = None } when path = ordinalFirstTieDocumentPath -> ()
        | { PathAndQuery = path } when path = ordinalFirstTieDocumentPath ->
            failwith "Evicted equal-time cache keys must not retain conditional request validators."
        | _ -> failwith "The ordinal-first equal-time cache key must be requested after eviction."

    let private testRateMalformedAndTimeoutFailures () =
        let rateHandler =
            new FakeHandler(fun _ ->
                let value = response HttpStatusCode.Forbidden "" None
                value.Headers.TryAddWithoutValidation("X-RateLimit-Remaining", "0") |> ignore
                value)

        let createdRateHttp, rateClient =
            createClient rateHandler (fun () -> DateTimeOffset.UtcNow)

        use rateHttp = createdRateHttp

        match rateClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.RateLimited -> ()
        | _ -> failwith "Rate-limited GitHub responses must map to rate-limited problems."

        let malformedHandler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/content" -> response HttpStatusCode.OK "{}" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdMalformedHttp, malformedClient =
            createClient malformedHandler (fun () -> DateTimeOffset.UtcNow)

        use malformedHttp = createdMalformedHttp

        match malformedClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "Malformed GitHub payloads must map to upstream-unavailable problems."

        let createdTimeoutHttp, timeoutClient =
            createClient (new CancelledHandler()) (fun () -> DateTimeOffset.UtcNow)

        use timeoutHttp = createdTimeoutHttp

        match timeoutClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "GitHub cancellation-timeout failures must map to upstream-unavailable problems."

    let private testFractionalCatalogSize () =
        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/content" ->
                    response HttpStatusCode.OK (repositoryJson "example-owner/content" "\"Content repository\"") None
                | "/repos/example-owner/content/contents/content/catalog.json?ref=main" ->
                    response HttpStatusCode.OK (fractionalCatalogManifest ()) None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        match contentClient.GetCatalog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "Fractional catalog byte sizes must not pass the host contract."

    let private testProjectsPaginationAndReadmes () =
        match ContentDomain.ProjectManifest.tryParse projectsManifest with
        | Ok _ -> ()
        | Error failure -> failwithf "Projects fixture is invalid: %s" failure.Message

        let pageTwo = "https://api.github.com/users/example-owner/repos?page=2"

        let repositoryRows =
            [ 1..7 ]
            |> List.map (fun index -> repositoryJson $"example-owner/recent-{index}" "\"Repository summary\"")
            |> String.concat ","
            |> fun rows -> $"[{rows}]"

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/content" ->
                    response HttpStatusCode.OK (repositoryJson "example-owner/content" "\"Content repository\"") None
                | "/repos/example-owner/content/contents/content/projects.json?ref=main" ->
                    response HttpStatusCode.OK projectsManifest None
                | "/repos/example-owner/curated-project" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "Example-Owner/Curated-Project" "\"Curated project summary\"")
                        None
                | "/repos/Example-Owner/Curated-Project/readme?ref=main" ->
                    response HttpStatusCode.OK "# Curated Project README\n\nThis is the supplied curated README." None
                | "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ->
                    linkResponse
                        HttpStatusCode.OK
                        (repositoryRows.Substring(0, repositoryRows.IndexOf("},{", StringComparison.Ordinal) + 1)
                         + "]")
                        None
                        pageTwo
                | "/users/example-owner/repos?page=2" -> response HttpStatusCode.OK repositoryRows None
                | path when
                    path.StartsWith("/repos/example-owner/recent-", StringComparison.Ordinal)
                    && path.EndsWith("/readme?ref=main", StringComparison.Ordinal)
                    ->
                    response
                        HttpStatusCode.OK
                        "# Generated Project README\n\nThis is the supplied generated README."
                        None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let projects =
            match contentClient.GetProjects(CancellationToken.None).GetAwaiter().GetResult() with
            | Ok value -> value
            | Error problem ->
                failwithf
                    "Expected projects, but got %s after requests %A."
                    (ContentDomain.Problem.detail problem)
                    handler.Requests

        if ContentDomain.Projects.entries projects |> List.length <> 7 then
            failwith "Projects must combine curated projects with six recent public owned repositories."

        match ContentDomain.Projects.entries projects with
        | curated :: _ when
            curated |> ContentDomain.ProjectReadme.body |> ContentDomain.MarkdownBody.value = "# Curated Project README\n\nThis is the supplied curated README."
            ->
            if
                curated
                |> ContentDomain.ProjectReadme.project
                |> ContentDomain.Project.repository
                |> ContentDomain.RepositoryName.value
                <> "example-owner/curated-project"
            then
                failwith "Curated projects must retain their configured repository casing."
        | _ -> failwith "Curated projects must retain their supplied repository README bodies."

        if
            handler.Requests
            |> List.exists (fun request -> request.PathAndQuery = "/users/example-owner/repos?page=2")
            |> not
        then
            failwith "Repository pagination must follow the GitHub Link next relation."

    let private testProjectsDeduplicateCaseInsensitiveRepositoryIdentity () =
        let caseOnlyCandidate =
            repositoryJson "Example-Owner/Curated-Project" "\"Repository summary\""

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/content" ->
                    response HttpStatusCode.OK (repositoryJson "example-owner/content" "\"Content repository\"") None
                | "/repos/example-owner/content/contents/content/projects.json?ref=main" ->
                    response HttpStatusCode.OK projectsManifest None
                | "/repos/example-owner/curated-project" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/curated-project" "\"Curated project summary\"")
                        None
                | "/repos/example-owner/curated-project/readme?ref=main" ->
                    response HttpStatusCode.OK "# Curated Project README\n\nThis is the supplied curated README." None
                | "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ->
                    response HttpStatusCode.OK $"[{caseOnlyCandidate}]" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let projects =
            match contentClient.GetProjects(CancellationToken.None).GetAwaiter().GetResult() with
            | Ok value -> value
            | Error problem ->
                failwithf
                    "Case-only curated and generated repository identities must not fail projects: %s."
                    (ContentDomain.Problem.detail problem)

        match ContentDomain.Projects.entries projects with
        | [ project ] when
            project
            |> ContentDomain.ProjectReadme.project
            |> ContentDomain.Project.repository
            |> ContentDomain.RepositoryName.value = "example-owner/curated-project"
            ->
            ()
        | _ -> failwith "Case-only repository identities must retain only the curated project."

        let requestedPaths =
            handler.Requests |> List.map (fun request -> request.PathAndQuery)

        let expectedPaths =
            [ "/repos/example-owner/content"
              "/repos/example-owner/content/contents/content/projects.json?ref=main"
              "/repos/example-owner/curated-project"
              "/repos/example-owner/curated-project/readme?ref=main"
              "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ]

        if requestedPaths <> expectedPaths then
            failwithf "Case-only generated candidates must be excluded before README requests: %A." requestedPaths

    let private testMissingProfileAndReleaseTagChangelog () =
        let v1 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let v2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let betweenV2AndV3 = "cccccccccccccccccccccccccccccccccccccccc"
        let v3 = "dddddddddddddddddddddddddddddddddddddddd"
        let annotatedTag = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        let head = "ffffffffffffffffffffffffffffffffffffffff"

        let releases =
            [ releaseJson "v1.0.0" "2026-07-20T00:00:00Z"
              releaseJson "v3.0.0" "2026-07-01T00:00:00Z"
              releaseJson "v2.0.0" "2026-07-10T00:00:00Z" ]
            |> String.concat ","
            |> fun rows -> $"[{rows}]"

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/users/example-owner/events/public?per_page=100" -> response HttpStatusCode.OK "[]" None
                | "/repos/example-owner/application/readme?ref=main" -> response HttpStatusCode.NotFound "" None
                | "/repos/example-owner/profile" -> response HttpStatusCode.NotFound "" None
                | "/repos/example-owner/application/releases?per_page=100" -> response HttpStatusCode.OK releases None
                | "/repos/example-owner/application/git/ref/tags/v3.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "tag" annotatedTag) None
                | path when path = $"/repos/example-owner/application/git/tags/{annotatedTag}" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" v3) None
                | "/repos/example-owner/application/git/ref/tags/v2.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" v2) None
                | "/repos/example-owner/application/git/ref/tags/v1.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" v1) None
                | "/repos/example-owner/application/git/ref/heads/main" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" head) None
                | path when path = $"/repos/example-owner/application/compare/{v1}...{head}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            4
                            v1
                            v1
                            [ commitJson v2 "Release v2" "2026-07-01T00:00:00Z"
                              commitJson betweenV2AndV3 "Prepare v3" "2026-07-12T00:00:00Z"
                              commitJson v3 "Release v3" "2026-07-13T00:00:00Z"
                              commitJson head "Work after the tag" "2026-07-15T00:00:00Z" ])
                        None
                | path when path = $"/repos/example-owner/application/compare/{v3}...{head}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            1
                            v3
                            v3
                            [ commitJson head "Work after the tag" "2026-07-15T00:00:00Z" ])
                        None
                | path when path = $"/repos/example-owner/application/compare/{v2}...{head}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            3
                            v2
                            v2
                            [ commitJson betweenV2AndV3 "Prepare v3" "2026-07-12T00:00:00Z"
                              commitJson v3 "Release v3" "2026-07-13T00:00:00Z"
                              commitJson head "Work after the tag" "2026-07-15T00:00:00Z" ])
                        None
                | path when path = $"/repos/example-owner/application/compare/{v2}...{v3}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            2
                            v2
                            v2
                            [ commitJson betweenV2AndV3 "Prepare v3" "2026-07-12T00:00:00Z"
                              commitJson v3 "Release v3" "2026-07-13T00:00:00Z" ])
                        None
                | path when path = $"/repos/example-owner/application/compare/{v1}...{v2}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson "ahead" 0 1 v1 v1 [ commitJson v2 "Release v2" "2026-07-01T00:00:00Z" ])
                        None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let now =
            contentClient.GetNow(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        let changelog =
            contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if ContentDomain.Now.title now |> ContentDomain.ContentTitle.value <> "Now" then
            failwith "A missing profile README must not prevent Now content."

        if ContentDomain.Changelog.unreleased changelog |> commitShas <> [ head ] then
            failwith
                "Unreleased commits must come from the ancestry-newest tag through the resolved default-branch head."

        match ContentDomain.Changelog.releases changelog with
        | [ newest; middle; oldest ] ->
            if ContentDomain.Release.tag newest |> ContentDomain.ContentTag.value <> "v3.0.0" then
                failwith "Release groups must be ordered newest first."

            if ContentDomain.Release.commits newest |> commitShas <> [ v3; betweenV2AndV3 ] then
                failwith "A release must contain only the adjacent older-tag to own-tag range."

            if ContentDomain.Release.tag middle |> ContentDomain.ContentTag.value <> "v2.0.0" then
                failwith "Adjacent release-tag ranges must retain deterministic release ordering."

            if ContentDomain.Release.commits middle |> commitShas <> [ v2 ] then
                failwith "The preceding release range must end at its own immutable tag commit."

            if ContentDomain.Release.commits oldest <> [] then
                failwith "The oldest release must not approximate pre-tag history from a latest-commits listing."
        | _ -> failwith "Changelog must retain all adjacent release groups."

        let paths = handler.Requests |> List.map (fun request -> request.PathAndQuery)

        if
            not (
                paths
                |> List.contains $"/repos/example-owner/application/git/tags/{annotatedTag}"
            )
        then
            failwith "Annotated release tags must be dereferenced to commit boundaries."

        if
            paths
            |> List.exists (fun path ->
                path = "/repos/example-owner/application/tags?per_page=100"
                || path = "/repos/example-owner/application/commits?per_page=100")
        then
            failwith "Changelog grouping must not fall back to tag listings or latest commits."

        let comparisonPaths =
            paths
            |> List.filter (fun path -> path.Contains("/compare/", StringComparison.Ordinal))

        let expectedComparisonPaths =
            [ $"/repos/example-owner/application/compare/{v1}...{head}?per_page=100"
              $"/repos/example-owner/application/compare/{v3}...{head}?per_page=100"
              $"/repos/example-owner/application/compare/{v2}...{head}?per_page=100"
              $"/repos/example-owner/application/compare/{v2}...{v3}?per_page=100"
              $"/repos/example-owner/application/compare/{v1}...{v2}?per_page=100" ]

        if comparisonPaths <> expectedComparisonPaths then
            failwith
                "Release boundaries must use one tag-to-head comparison each before ancestry-ordered adjacent ranges."

    let private testChangelogReleasePaginationBound () =
        let tag = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let firstRelease = releasePage [ releaseJson "v1.0.0" "2026-07-10T00:00:00Z" ]
        let secondPage = releasePage [ draftReleaseJson "draft-2" ]
        let thirdPage = releasePage [ draftReleaseJson "draft-3" ]

        let pageTwo =
            "https://api.github.com/repos/example-owner/application/releases?page=2"

        let pageThree =
            "https://api.github.com/repos/example-owner/application/releases?page=3"

        let pageFour =
            "https://api.github.com/repos/example-owner/application/releases?page=4"

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/repos/example-owner/application/releases?per_page=100" ->
                    linkResponse HttpStatusCode.OK firstRelease None pageTwo
                | "/repos/example-owner/application/releases?page=2" ->
                    linkResponse HttpStatusCode.OK secondPage None pageThree
                | "/repos/example-owner/application/releases?page=3" ->
                    linkResponse HttpStatusCode.OK thirdPage None pageFour
                | "/repos/example-owner/application/releases?page=4" -> response HttpStatusCode.OK "[]" None
                | "/repos/example-owner/application/git/ref/tags/v1.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" tag) None
                | "/repos/example-owner/application/git/ref/heads/main" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" head) None
                | path when path = $"/repos/example-owner/application/compare/{tag}...{head}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            1
                            tag
                            tag
                            [ commitJson head "Post-release work" "2026-07-11T00:00:00Z" ])
                        None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let changelog =
            contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if ContentDomain.Changelog.releases changelog |> List.length <> 1 then
            failwith "Published releases found after draft-only pages must be retained."

        let paths = handler.Requests |> List.map (fun request -> request.PathAndQuery)

        if
            not (paths |> List.contains "/repos/example-owner/application/releases?page=2")
            || not (paths |> List.contains "/repos/example-owner/application/releases?page=3")
            || paths |> List.contains "/repos/example-owner/application/releases?page=4"
        then
            failwith "Release pagination must stop at the explicit three-page bound."

    let private testChangelogRejectsMissingTag () =
        let releases = releasePage [ releaseJson "v1.0.0" "2026-07-10T00:00:00Z" ]

        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/repos/example-owner/application/releases?per_page=100" -> response HttpStatusCode.OK releases None
                | "/repos/example-owner/application/git/ref/tags/v1.0.0" -> response HttpStatusCode.NotFound "" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        match contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.NotFound -> ()
        | _ -> failwith "A missing release tag must fail instead of silently dropping the release."

        if
            handler.Requests
            |> List.exists (fun request ->
                request.PathAndQuery.Contains("/compare/", StringComparison.Ordinal)
                || request.PathAndQuery.EndsWith("/commits?per_page=100", StringComparison.Ordinal))
        then
            failwith "A missing tag must not trigger a timestamp or latest-commits fallback."

    let private testChangelogWithoutReleases () =
        let handler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/repos/example-owner/application/releases?per_page=100" -> response HttpStatusCode.OK "[]" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdHttpClient, contentClient =
            createClient handler (fun () -> DateTimeOffset.UtcNow)

        use httpClient = createdHttpClient

        let changelog =
            contentClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult()
            |> expectOk

        if
            ContentDomain.Changelog.unreleased changelog <> []
            || ContentDomain.Changelog.releases changelog <> []
        then
            failwith "No releases must return an empty bounded changelog rather than a latest-commits approximation."

        if handler.Requests |> List.length <> 2 then
            failwith "No releases must not resolve a branch head, tags, or commit comparisons."

    let private testChangelogRejectsNonComparableAndOversizedRanges () =
        let tag = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let releases = releasePage [ releaseJson "v1.0.0" "2026-07-10T00:00:00Z" ]

        let nonComparableHandler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/repos/example-owner/application/releases?per_page=100" -> response HttpStatusCode.OK releases None
                | "/repos/example-owner/application/git/ref/tags/v1.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" tag) None
                | "/repos/example-owner/application/git/ref/heads/main" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" head) None
                | path when path = $"/repos/example-owner/application/compare/{tag}...{head}?per_page=100" ->
                    response
                        HttpStatusCode.OK
                        (comparisonJson
                            "diverged"
                            1
                            1
                            tag
                            tag
                            [ commitJson head "Diverged work" "2026-07-11T00:00:00Z" ])
                        None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdNonComparableHttp, nonComparableClient =
            createClient nonComparableHandler (fun () -> DateTimeOffset.UtcNow)

        use nonComparableHttp = createdNonComparableHttp

        match nonComparableClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "A non-comparable tag range must fail through the typed upstream error path."

        let nextPage =
            $"https://api.github.com/repos/example-owner/application/compare/{tag}...{head}?page=2"

        let oversizedHandler =
            new FakeHandler(fun request ->
                match request.PathAndQuery with
                | "/repos/example-owner/application" ->
                    response
                        HttpStatusCode.OK
                        (repositoryJson "example-owner/application" "\"Application repository\"")
                        None
                | "/repos/example-owner/application/releases?per_page=100" -> response HttpStatusCode.OK releases None
                | "/repos/example-owner/application/git/ref/tags/v1.0.0" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" tag) None
                | "/repos/example-owner/application/git/ref/heads/main" ->
                    response HttpStatusCode.OK (gitObjectJson "commit" head) None
                | path when path = $"/repos/example-owner/application/compare/{tag}...{head}?per_page=100" ->
                    linkResponse
                        HttpStatusCode.OK
                        (comparisonJson
                            "ahead"
                            0
                            101
                            tag
                            tag
                            [ commitJson head "Too much history" "2026-07-11T00:00:00Z" ])
                        None
                        nextPage
                | path when path = $"/repos/example-owner/application/compare/{tag}...{head}?page=2" ->
                    response HttpStatusCode.OK "{}" None
                | _ -> response HttpStatusCode.NotFound "" None)

        let createdOversizedHttp, oversizedClient =
            createClient oversizedHandler (fun () -> DateTimeOffset.UtcNow)

        use oversizedHttp = createdOversizedHttp

        match oversizedClient.GetChangelog(CancellationToken.None).GetAwaiter().GetResult() with
        | Error problem when ContentDomain.Problem.code problem = ContentDomain.UpstreamUnavailable -> ()
        | _ -> failwith "An over-limit comparison must not truncate a release range."

        if
            oversizedHandler.Requests
            |> List.exists (fun request ->
                request.PathAndQuery = $"/repos/example-owner/application/compare/{tag}...{head}?page=2")
        then
            failwith "An over-limit comparison must stop at the explicit range bound."

    let run () =
        testColdCache304AndStaleFallback ()
        testSameKeyColdRequests ()
        testSameKeyStaleRequests ()
        testCallerCancellationDoesNotCancelSharedFetch ()
        testFailedSharedFetchCanRetryImmediately ()
        testDifferentKeysRemainParallel ()
        testPublicationMetadata ()
        testPayloadCacheRetention ()
        testRateMalformedAndTimeoutFailures ()
        testFractionalCatalogSize ()
        testProjectsPaginationAndReadmes ()
        testProjectsDeduplicateCaseInsensitiveRepositoryIdentity ()
        testMissingProfileAndReleaseTagChangelog ()
        testChangelogReleasePaginationBound ()
        testChangelogRejectsMissingTag ()
        testChangelogWithoutReleases ()
        testChangelogRejectsNonComparableAndOversizedRanges ()
