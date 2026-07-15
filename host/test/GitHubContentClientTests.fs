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
            ContentDomain.Project.repository project |> ContentDomain.RepositoryName.value = "example-owner/curated-project"
            ->
            ()
        | _ -> failwith "Case-only repository identities must retain only the curated project."

        let requestedPaths =
            handler.Requests |> List.map (fun request -> request.PathAndQuery)

        let expectedPaths =
            [ "/repos/example-owner/content"
              "/repos/example-owner/content/contents/content/projects.json?ref=main"
              "/users/example-owner/repos?type=owner&sort=updated&direction=desc&per_page=100" ]

        if requestedPaths <> expectedPaths then
            failwithf "Case-only curated candidates must be excluded before README requests: %A." requestedPaths

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
        testRateMalformedAndTimeoutFailures ()
        testFractionalCatalogSize ()
        testProjectsPaginationAndReadmes ()
        testProjectsDeduplicateCaseInsensitiveRepositoryIdentity ()
        testMissingProfileAndReleaseTagChangelog ()
        testChangelogReleasePaginationBound ()
        testChangelogRejectsMissingTag ()
        testChangelogWithoutReleases ()
        testChangelogRejectsNonComparableAndOversizedRanges ()
