namespace Termin.Al.Host.Tests

open System
open System.Collections.Generic
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Text
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

        member _.Requests = requests |> Seq.toList

        override _.SendAsync(request: HttpRequestMessage, _: CancellationToken) =
            let apiVersion =
                match request.Headers.TryGetValues("X-GitHub-Api-Version") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            let ifNoneMatch =
                match request.Headers.TryGetValues("If-None-Match") with
                | true, values -> values |> Seq.tryHead
                | false, _ -> None

            requests.Add
                { PathAndQuery = request.RequestUri.PathAndQuery
                  Accept = request.Headers.Accept.ToString()
                  ApiVersion = apiVersion
                  UserAgent = request.Headers.UserAgent.ToString()
                  IfNoneMatch = ifNoneMatch }

            Task.FromResult(respond requests[requests.Count - 1])

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

    let private catalogManifest =
        "{\"entries\":[{\"kind\":\"directory\",\"id\":\"home\",\"path\":\"~\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":0},{\"kind\":\"file\",\"id\":\"about-document\",\"path\":\"~/about.md\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"size\":64,\"documentHandle\":\"about\",\"sourcePath\":\"content/about.md\"}]}"

    let private projectsManifest =
        "{\"projects\":[{\"id\":\"curated-project\",\"slug\":\"curated-project\",\"name\":\"Curated Project\",\"summary\":\"Curated project summary.\",\"url\":\"https://github.com/example-owner/curated-project\",\"repository\":\"example-owner/curated-project\",\"updatedAt\":\"2026-07-15T00:00:00.000Z\",\"tags\":[\"fsharp\"]}]}"

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
                    response HttpStatusCode.NotFound "" None
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

        if
            handler.Requests
            |> List.exists (fun request -> request.PathAndQuery = "/users/example-owner/repos?page=2")
            |> not
        then
            failwith "Repository pagination must follow the GitHub Link next relation."

    let private testMissingProfileAndChangelogInputs () =
        let releases =
            "[{\"draft\":false,\"prerelease\":false,\"tag_name\":\"v1.0.0\",\"name\":\"1.0.0\",\"published_at\":\"2026-07-14T00:00:00Z\",\"body\":\"Release body\",\"html_url\":\"https://github.com/example-owner/application/releases/tag/v1.0.0\"}]"

        let tags = "[{\"name\":\"v1.0.0\"}]"

        let commits =
            "[{\"sha\":\"0123456789abcdef0123456789abcdef01234567\",\"html_url\":\"https://github.com/example-owner/application/commit/0123456789abcdef0123456789abcdef01234567\",\"commit\":{\"message\":\"Add content contracts\",\"author\":{\"date\":\"2026-07-15T00:00:00Z\"}}}]"

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
                | "/repos/example-owner/application/tags?per_page=100" -> response HttpStatusCode.OK tags None
                | "/repos/example-owner/application/commits?per_page=100" -> response HttpStatusCode.OK commits None
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

        if ContentDomain.Changelog.releases changelog |> List.length <> 1 then
            failwith "Changelog releases must use GitHub releases, tags, and commits."

    let run () =
        testColdCache304AndStaleFallback ()
        testRateMalformedAndTimeoutFailures ()
        testProjectsPaginationAndReadmes ()
        testMissingProfileAndChangelogInputs ()
