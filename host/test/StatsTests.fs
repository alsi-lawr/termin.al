namespace Termin.Al.Host.Tests

open System
open System.IO
open System.Net
open System.Net.Http
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Hosting.Server
open Microsoft.AspNetCore.Hosting.Server.Features
open Microsoft.Extensions.DependencyInjection
open Termin.Al.Host

[<RequireQualifiedAccess>]
module StatsTests =
    let private now = DateTimeOffset.Parse("2026-07-16T12:34:56Z")
    let private allowedContent = Set.ofList [ "about"; "sample-project" ]

    let private requireValid (result: ContentDomain.ValidationResult<'value>) : 'value =
        match result with
        | Ok value -> value
        | Error failure -> failwithf "%s: %s" failure.Field failure.Message

    let private timestamp value =
        ContentDomain.Timestamp.tryCreate "test.timestamp" value |> requireValid

    let private source () =
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

    let private cache () =
        ContentDomain.CacheMetadata.tryCreate
            ContentDomain.Fresh
            (timestamp "2026-07-16T12:00:00.000Z")
            (timestamp "2026-07-16T12:05:00.000Z")
            (timestamp "2026-07-16T13:05:00.000Z")
        |> requireValid

    let private countableContentClient () : ContentClient =
        let root =
            ContentDomain.Directory(
                ContentDomain.CatalogId.tryCreate "test.id" "home" |> requireValid,
                ContentDomain.VirtualPath.tryCreate "test.path" "~" |> requireValid,
                timestamp "2026-07-16T12:00:00.000Z",
                ContentDomain.ByteSize.tryCreate "test.size" 0 |> requireValid
            )

        let about =
            ContentDomain.File(
                ContentDomain.CatalogId.tryCreate "test.id" "about-file" |> requireValid,
                ContentDomain.VirtualPath.tryCreate "test.path" "~/about.md" |> requireValid,
                timestamp "2026-07-16T12:00:00.000Z",
                ContentDomain.ByteSize.tryCreate "test.size" 10 |> requireValid,
                ContentDomain.ContentId.tryCreate "test.handle" "about" |> requireValid
            )

        let catalog =
            ContentDomain.Catalog.tryCreate (source ()) (cache ()) [ root; about ]
            |> requireValid

        let project =
            ContentDomain.Project.create
                (ContentDomain.ContentId.tryCreate "test.project.id" "sample-project"
                 |> requireValid)
                (ContentDomain.ContentSlug.tryCreate "test.project.slug" "sample-project"
                 |> requireValid)
                (ContentDomain.ContentTitle.tryCreate "test.project.name" "Sample Project"
                 |> requireValid)
                (ContentDomain.ContentSummary.tryCreate "test.project.summary" "A sample project."
                 |> requireValid)
                (ContentDomain.ContentUrl.tryCreate "test.project.url" "https://github.com/example-owner/sample-project"
                 |> requireValid)
                (ContentDomain.RepositoryName.tryCreate "test.project.repository" "example-owner/sample-project"
                 |> requireValid)
                (ContentDomain.ProjectCollectionPath.tryCreate "test.project.collection" "samples"
                 |> requireValid)
                (timestamp "2026-07-16T12:00:00.000Z")
                []

        let projectReadme =
            ContentDomain.ProjectReadme.create
                project
                (ContentDomain.MarkdownBody.tryCreate "test.project.readme" "# Sample Project"
                 |> requireValid)

        let projects =
            ContentDomain.Projects.tryCreate (source ()) (cache ()) [ projectReadme ]
            |> requireValid

        { new ContentClient with
            member _.GetCatalog _ = Task.FromResult(Ok catalog)
            member _.GetProjects _ = Task.FromResult(Ok projects)

            member _.GetDocument(_, _) =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetNow _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetChangelog _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing.")) }

    let private temporaryDirectory () =
        let path = Path.Combine(Path.GetTempPath(), $"termin-al-stats-{Guid.NewGuid():N}")
        Directory.CreateDirectory(path) |> ignore
        path

    let private withTemporaryDirectory action =
        let path = temporaryDirectory ()

        try
            action path
        finally
            if Directory.Exists path then
                Directory.Delete(path, true)

    let private snapshot (store: Stats.Store) =
        match store.GetSnapshot(CancellationToken.None).GetAwaiter().GetResult() with
        | Some value -> value
        | None -> failwith "Expected an available statistics snapshot."

    let private record (store: Stats.Store) (sessionId: string) (contentId: string) =
        store.RecordView(sessionId, contentId, allowedContent, now, CancellationToken.None)
        |> _.GetAwaiter().GetResult()

    let private expectAccepted =
        function
        | Stats.Accepted value -> value
        | result -> failwithf "Expected an accepted view, received %A." result

    let private assertFourHundredConsecutiveDays (expectedLastDate: DateOnly) (days: Stats.DailyCount list) =
        if days.Length <> 400 then
            failwithf "Expected exactly 400 daily buckets, received %d." days.Length

        days
        |> List.pairwise
        |> List.iter (fun (left, right) ->
            if right.Date <> left.Date.AddDays(1) then
                failwith "Statistics daily buckets must be consecutive UTC dates.")

        if days |> List.last |> _.Date <> expectedLastDate then
            failwith "Statistics daily buckets must end on the current UTC date."

    let private runStoreDurabilityAndPrivacyChecks () =
        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            let empty = snapshot store
            assertFourHundredConsecutiveDays (DateOnly(2026, 7, 16)) empty.Daily

            if empty.TotalSessions <> 0L || empty.TotalPageViews <> 0L then
                failwith "A new statistics store must start empty."

            let first = record store "private-session-one" "about" |> expectAccepted

            if first.TotalSessions <> 1L || first.TotalPageViews <> 1L then
                failwith "The first accepted view must count its session and content atomically."

            match record store "private-session-one" "about" with
            | Stats.Duplicate duplicate when duplicate.TotalPageViews = 1L -> ()
            | result -> failwithf "Expected a deduplicated view, received %A." result

            let secondContent =
                record store "private-session-one" "sample-project" |> expectAccepted

            if secondContent.TotalSessions <> 1L || secondContent.TotalPageViews <> 2L then
                failwith "A second content view in one session must not increment sessions."

            let secondSession = record store "private-session-two" "about" |> expectAccepted

            if secondSession.TotalSessions <> 2L || secondSession.TotalPageViews <> 3L then
                failwith "A first view in another session must increment both totals."

            store.Flush(CancellationToken.None).GetAwaiter().GetResult()
            store.Shutdown()

            let persistedPath = Path.Combine(path, "statistics.json")
            let persistedText = File.ReadAllText persistedPath
            use persisted = JsonDocument.Parse persistedText
            let root = persisted.RootElement
            let names = root.EnumerateObject() |> Seq.map _.Name |> Set.ofSeq

            let expected =
                Set.ofList
                    [ "schemaVersion"
                      "totalSessions"
                      "totalPageViews"
                      "pageViewsByContent"
                      "daily" ]

            if names <> expected then
                failwithf "Unexpected persisted statistics fields: %A." names

            if
                persistedText.Contains("private-session", StringComparison.Ordinal)
                || persistedText.Contains("cookie", StringComparison.OrdinalIgnoreCase)
                || persistedText.Contains("user-agent", StringComparison.OrdinalIgnoreCase)
                || persistedText.Contains(path, StringComparison.Ordinal)
            then
                failwith "Persisted statistics must not contain identifying or storage metadata."

            let daily = root.GetProperty("daily")

            if daily.GetArrayLength() <> 400 then
                failwith "Persisted statistics must contain exactly 400 daily buckets."

            daily.EnumerateArray()
            |> Seq.iter (fun day ->
                let dayNames = day.EnumerateObject() |> Seq.map _.Name |> Set.ofSeq

                if dayNames <> Set.ofList [ "date"; "sessions"; "pageViews" ] then
                    failwithf "Unexpected persisted daily fields: %A." dayNames)

            let restarted = Stats.createStoreAt path (fun () -> now.AddDays(2.0))
            let recovered = snapshot restarted
            assertFourHundredConsecutiveDays (DateOnly(2026, 7, 18)) recovered.Daily

            if recovered.TotalSessions <> 2L || recovered.TotalPageViews <> 3L then
                failwith "Restart must retain all-time totals."

            restarted.Shutdown())

    let private runRecoveryAndAvailabilityChecks () =
        withTemporaryDirectory (fun mainDirectory ->
            withTemporaryDirectory (fun temporaryDirectory ->
                let mainStore = Stats.createStoreAt mainDirectory (fun () -> now)
                record mainStore "main-session" "about" |> expectAccepted |> ignore
                mainStore.Shutdown()

                let temporaryStore = Stats.createStoreAt temporaryDirectory (fun () -> now)
                record temporaryStore "temporary-session" "about" |> expectAccepted |> ignore

                record temporaryStore "temporary-session" "sample-project"
                |> expectAccepted
                |> ignore

                temporaryStore.Shutdown()

                File.Copy(
                    Path.Combine(temporaryDirectory, "statistics.json"),
                    Path.Combine(mainDirectory, "statistics.json.tmp"),
                    true
                )

                let preferredMain = Stats.createStoreAt mainDirectory (fun () -> now)

                if (snapshot preferredMain).TotalPageViews <> 1L then
                    failwith "A valid main statistics file must be preferred over a valid sibling temporary file."

                if File.Exists(Path.Combine(mainDirectory, "statistics.json.tmp")) then
                    failwith "A valid main statistics file must remove its stale valid sibling temporary file."

                preferredMain.Shutdown()))

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            record store "session" "about" |> expectAccepted |> ignore
            store.Shutdown()

            let temporaryPath = Path.Combine(path, "statistics.json.tmp")
            File.WriteAllText(temporaryPath, "{not-json")
            let recovered = Stats.createStoreAt path (fun () -> now)

            if (snapshot recovered).TotalPageViews <> 1L then
                failwith "A malformed sibling temporary file must not replace a valid main statistics file."

            if File.Exists temporaryPath then
                failwith "A valid main statistics file must remove its malformed sibling temporary file."

            recovered.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            record store "session" "about" |> expectAccepted |> ignore
            store.Shutdown()

            let mainPath = Path.Combine(path, "statistics.json")
            let temporaryPath = Path.Combine(path, "statistics.json.tmp")
            File.Copy(mainPath, temporaryPath, true)
            File.WriteAllText(mainPath, "{not-json")

            let recovered = Stats.createStoreAt path (fun () -> now)

            if (snapshot recovered).TotalPageViews <> 1L then
                failwith "A valid sibling temporary file must recover an invalid main file."

            recovered.Shutdown())

        withTemporaryDirectory (fun path ->
            File.WriteAllText(Path.Combine(path, "statistics.json"), "{not-json")
            let unavailable = Stats.createStoreAt path (fun () -> now)

            if unavailable.GetSnapshot(CancellationToken.None).GetAwaiter().GetResult().IsSome then
                failwith "A never-valid corrupt store must be unavailable."

            match unavailable.Subscribe().GetAwaiter().GetResult() with
            | Stats.SubscriptionUnavailable -> ()
            | result -> failwithf "A never-valid store must reject subscriptions, received %A." result

            unavailable.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            record store "session" "about" |> expectAccepted |> ignore
            Directory.CreateDirectory(Path.Combine(path, "statistics.json.tmp")) |> ignore

            match record store "session" "sample-project" with
            | Stats.Unavailable -> ()
            | result -> failwithf "Expected a failed durable write to become unavailable, received %A." result

            let readOnly = snapshot store

            if readOnly.StorageState <> Stats.ReadOnly || readOnly.TotalPageViews <> 1L then
                failwith "A later write failure must retain the last valid snapshot as read-only."

            store.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            record store "session" "about" |> expectAccepted |> ignore
            store.Shutdown()

            let mainPath = Path.Combine(path, "statistics.json")
            let persisted = File.ReadAllText mainPath
            Directory.CreateDirectory(Path.Combine(path, "statistics.json.tmp")) |> ignore
            let readOnlyStore = Stats.createStoreAt path (fun () -> now)
            let readOnly = snapshot readOnlyStore

            if readOnly.StorageState <> Stats.ReadOnly || readOnly.TotalPageViews <> 1L then
                failwith "An unremovable temporary sibling must leave the valid main snapshot available read-only."

            let subscriptionId =
                match readOnlyStore.Subscribe().GetAwaiter().GetResult() with
                | Stats.Subscribed(_, subscriptionId, initial) when initial.StorageState = Stats.ReadOnly ->
                    subscriptionId
                | result -> failwithf "A readable read-only snapshot must remain subscribable, received %A." result

            match record readOnlyStore "another-session" "sample-project" with
            | Stats.Unavailable -> ()
            | result -> failwithf "A cleanup-failed store must reject writes as unavailable, received %A." result

            if File.ReadAllText(mainPath) <> persisted then
                failwith "Temporary-sibling cleanup failure must not damage the valid main statistics file."

            readOnlyStore.Unsubscribe subscriptionId
            readOnlyStore.Shutdown())

    let private runRateAndSubscriptionChecks () =
        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            for attempt in 1..15 do
                match record store "rate-session" "about" with
                | Stats.Accepted _ when attempt = 1 -> ()
                | Stats.Duplicate _ when attempt > 1 -> ()
                | result -> failwithf "Unexpected result for rate attempt %d: %A." attempt result

            match record store "rate-session" "about" with
            | Stats.RateLimited -> ()
            | result -> failwithf "Duplicate attempts must consume the per-session rate budget, received %A." result

            let reader, subscriptionId =
                match store.Subscribe().GetAwaiter().GetResult() with
                | Stats.Subscribed(reader, subscriptionId, _) -> reader, subscriptionId
                | result -> failwithf "Expected an available subscription, received %A." result

            record store "published-session" "about" |> expectAccepted |> ignore
            record store "published-session" "sample-project" |> expectAccepted |> ignore

            let mutable publication = ""

            if
                not (reader.TryRead(&publication))
                || not (publication.Contains("\"totalPageViews\":3", StringComparison.Ordinal))
            then
                failwith "A slow subscriber must retain only the latest accepted aggregate snapshot."

            let mutable superseded = ""

            if reader.TryRead(&superseded) then
                failwith "A slow subscriber must not retain superseded aggregate snapshots."

            store.Unsubscribe subscriptionId
            store.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            store.Shutdown()

            match
                store
                    .Subscribe()
                    .WaitAsync(TimeSpan.FromSeconds(1.0))
                    .GetAwaiter()
                    .GetResult()
            with
            | Stats.SubscriptionStopped -> ()
            | result -> failwithf "Expected a post-shutdown subscription to stop immediately, received %A." result)

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            let subscription = store.Subscribe()
            let shutdown = Task.Run(fun () -> store.Shutdown())

            Task
                .WhenAll(subscription :> Task, shutdown)
                .WaitAsync(TimeSpan.FromSeconds(1.0))
                .GetAwaiter()
                .GetResult()

            match subscription.GetAwaiter().GetResult() with
            | Stats.Subscribed(reader, subscriptionId, _) ->
                reader
                    .Completion
                    .WaitAsync(TimeSpan.FromSeconds(1.0))
                    .GetAwaiter()
                    .GetResult()

                store.Unsubscribe subscriptionId
            | result -> failwithf "Expected a pre-stop registration to complete, received %A." result)

        withTemporaryDirectory (fun path ->
            for iteration in 1..25 do
                let iterationPath = Path.Combine(path, string iteration)
                let store = Stats.createStoreAt iterationPath (fun () -> now)
                use barrier = new Barrier(2)

                let subscription =
                    Task.Run<Stats.SubscriptionResult>(
                        Func<Task<Stats.SubscriptionResult>>(fun () ->
                            barrier.SignalAndWait()
                            store.Subscribe())
                    )

                let shutdown =
                    Task.Run(fun () ->
                        barrier.SignalAndWait()
                        store.Shutdown())

                Task
                    .WhenAll(subscription :> Task, shutdown)
                    .WaitAsync(TimeSpan.FromSeconds(1.0))
                    .GetAwaiter()
                    .GetResult()

                match subscription.GetAwaiter().GetResult() with
                | Stats.Subscribed(reader, subscriptionId, _) ->
                    reader
                        .Completion
                        .WaitAsync(TimeSpan.FromSeconds(1.0))
                        .GetAwaiter()
                        .GetResult()

                    store.Unsubscribe subscriptionId
                | Stats.SubscriptionStopped -> ()
                | result ->
                    failwithf
                        "Expected a legal concurrent subscription outcome in iteration %d, received %A."
                        iteration
                        result)

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            for attempt in 1..15 do
                match
                    store.RecordView(
                        "invalid-session",
                        "lexically-valid",
                        allowedContent,
                        now,
                        CancellationToken.None
                    )
                    |> _.GetAwaiter().GetResult()
                with
                | Stats.InvalidContent -> ()
                | result -> failwithf "Unexpected invalid-content result for attempt %d: %A." attempt result

            match
                store.RecordView(
                    "invalid-session",
                    "lexically-valid",
                    allowedContent,
                    now,
                    CancellationToken.None
                )
                |> _.GetAwaiter().GetResult()
            with
            | Stats.RateLimited -> ()
            | result -> failwithf "Invalid content must consume the session rate budget, received %A." result

            let unchanged = snapshot store

            if unchanged.TotalSessions <> 0L || unchanged.TotalPageViews <> 0L then
                failwith "Invalid content must not change aggregate totals."

            store.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            for sessionIndex in 1..20 do
                let sessionId = $"process-session-{sessionIndex}"

                for attempt in 1..15 do
                    match
                        store.RecordView(
                            sessionId,
                            "lexically-valid",
                            allowedContent,
                            now,
                            CancellationToken.None
                        )
                        |> _.GetAwaiter().GetResult()
                    with
                    | Stats.InvalidContent -> ()
                    | result ->
                        failwithf
                            "Unexpected invalid-content process-rate result for session %d attempt %d: %A."
                            sessionIndex
                            attempt
                            result

            match
                store.RecordView(
                    "process-session-21",
                    "lexically-valid",
                    allowedContent,
                    now,
                    CancellationToken.None
                )
                |> _.GetAwaiter().GetResult()
            with
            | Stats.RateLimited -> ()
            | result -> failwithf "Invalid content must consume the process rate budget, received %A." result

            let unchanged = snapshot store

            if unchanged.TotalSessions <> 0L || unchanged.TotalPageViews <> 0L then
                failwith "Process-rate invalid content must not change aggregate totals."

            let nextMinute = now.AddMinutes(1.0)

            match
                store.RecordView(
                    "process-session-21",
                    "lexically-valid",
                    allowedContent,
                    nextMinute,
                    CancellationToken.None
                )
                |> _.GetAwaiter().GetResult()
            with
            | Stats.InvalidContent -> ()
            | result -> failwithf "A new UTC minute must reset bounded rate windows, received %A." result

            store.Shutdown())

    let private withRunningHost (application: WebApplication) action =
        application.Urls.Add("http://127.0.0.1:0")

        try
            application.StartAsync().GetAwaiter().GetResult()
            let server = application.Services.GetRequiredService<IServer>()
            let addresses = server.Features.Get<IServerAddressesFeature>()

            if isNull addresses then
                failwith "The statistics test host did not publish an address."

            let address = addresses.Addresses |> Seq.exactlyOne
            use client = new HttpClient()
            client.BaseAddress <- Uri(address)
            action client address
        finally
            application
                .StopAsync()
                .WaitAsync(TimeSpan.FromSeconds(5.0))
                .GetAwaiter()
                .GetResult()

            application.DisposeAsync().AsTask().GetAwaiter().GetResult()

    let private request
        (method: HttpMethod)
        (path: string)
        (origin: string option)
        (body: string option)
        (cookie: string option)
        =
        let message = new HttpRequestMessage(method, path)

        origin |> Option.iter (fun value -> message.Headers.Add("Origin", value))
        cookie |> Option.iter (fun value -> message.Headers.Add("Cookie", value))

        body
        |> Option.iter (fun value -> message.Content <- new StringContent(value, Encoding.UTF8, "application/json"))

        message

    let private assertFailedSseSetupCleanupScope () =
        let sourcePath =
            Path.GetFullPath(Path.Combine(__SOURCE_DIRECTORY__, "../src/Stats.fs"))

        let lines = File.ReadAllLines sourcePath

        let assertCleanupScope (sourceLines: string array) =
            let isCodeLine (line: string) =
                not (String.IsNullOrWhiteSpace line)
                && not (line.TrimStart().StartsWith("//", StringComparison.Ordinal))

            let indentation (line: string) =
                line.Length - line.TrimStart().Length

            let requireUniqueExactLine description exactLine startIndex endIndex =
                let matches =
                    sourceLines[startIndex .. endIndex - 1]
                    |> Array.indexed
                    |> Array.choose (fun (offset, line) -> if line = exactLine then Some(startIndex + offset) else None)

                match matches with
                | [| index |] -> index
                | _ -> failwithf "Expected one exact %s line, found %d." description matches.Length

            let branchIndex =
                requireUniqueExactLine
                    "statistics SSE subscribed branch"
                    "                | Subscribed(reader, subscriptionId, initial) ->"
                    0
                    sourceLines.Length

            let branchEndIndex =
                requireUniqueExactLine
                    "statistics endpoint boundary"
                    "    let mapEndpoints"
                    (branchIndex + 1)
                    sourceLines.Length

            let outerTryIndex =
                requireUniqueExactLine
                    "statistics SSE outer try"
                    "                    try"
                    (branchIndex + 1)
                    branchEndIndex

            if
                sourceLines[branchIndex + 1 .. outerTryIndex - 1]
                |> Array.exists isCodeLine
            then
                failwith "The statistics SSE subscribed branch must enter its cleanup scope before response setup."

            let outerFinallyIndex =
                requireUniqueExactLine
                    "statistics SSE outer finally"
                    "                    finally"
                    (outerTryIndex + 1)
                    branchEndIndex

            let cleanupIndentation = indentation sourceLines[outerTryIndex]

            if
                sourceLines[outerTryIndex + 1 .. outerFinallyIndex - 1]
                |> Array.exists (fun line -> isCodeLine line && indentation line <= cleanupIndentation)
            then
                failwith "Every statistics SSE subscribed-branch operation must remain nested inside the outer try."

            let unsubscribeIndex =
                sourceLines[outerFinallyIndex + 1 .. branchEndIndex - 1]
                |> Array.tryFindIndex isCodeLine
                |> Option.map ((+) (outerFinallyIndex + 1))
                |> Option.defaultWith (fun () -> failwith "The statistics SSE outer finally block is empty.")

            if
                sourceLines[unsubscribeIndex]
                <> "                        store.Unsubscribe subscriptionId"
            then
                failwith "Statistics SSE unsubscribe must be the first executable line in the outer finally block."

            if
                sourceLines[unsubscribeIndex + 1 .. branchEndIndex - 1]
                |> Array.exists (fun line ->
                    isCodeLine line
                    && line <> "        }"
                    && line <> "        :> Task")
            then
                failwith "No executable statement may follow unsubscribe in the statistics SSE subscribed branch."

        assertCleanupScope lines

        let unsubscribeIndex =
            lines
            |> Array.findIndex ((=) "                        store.Unsubscribe subscriptionId")

        let cleanupEscapedMutation =
            Array.concat
                [ lines[.. unsubscribeIndex - 1]
                  [| "                        ()"
                     "                    store.Unsubscribe subscriptionId" |]
                  lines[unsubscribeIndex + 1 ..] ]

        try
            assertCleanupScope cleanupEscapedMutation
            failwith "The statistics SSE cleanup assertion accepted unsubscribe outside the outer finally."
        with error when
            error.Message = "Statistics SSE unsubscribe must be the first executable line in the outer finally block." ->
            ()

    let private runApiChecks () =
        assertFailedSseSetupCleanupScope ()

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            let randomBytes count =
                Array.init count (fun index -> byte (index + 1))

            HostApplication.createWithContentClientAndStats
                [||]
                (countableContentClient ())
                store
                true
                randomBytes
                (fun () -> now)
                (TimeSpan.FromMilliseconds(20.0))
            |> fun application ->
                withRunningHost application (fun client origin ->
                    use getRequest = request HttpMethod.Get "/api/stats" None None None
                    use getResponse = client.Send getRequest

                    if getResponse.StatusCode <> HttpStatusCode.OK then
                        failwithf "Expected statistics GET 200, received %O." getResponse.StatusCode

                    let setCookie = getResponse.Headers.GetValues("Set-Cookie") |> Seq.exactlyOne

                    for required in [ "termin.al.stats-session="; "httponly"; "samesite=strict"; "path=/" ] do
                        if not (setCookie.Contains(required, StringComparison.OrdinalIgnoreCase)) then
                            failwithf "Statistics cookie is missing %s." required

                    if setCookie.Contains("expires=", StringComparison.OrdinalIgnoreCase) then
                        failwith "The statistics session cookie must not have a persistent expiry."

                    let cookie = setCookie.Split(';')[0]
                    let cookieValue = cookie.Split('=')[1]

                    if cookieValue.Length <> 22 then
                        failwith "The statistics session cookie must contain one base64url 128-bit value."

                    use mismatchedGet =
                        request HttpMethod.Get "/api/stats" (Some "https://example.invalid") None None

                    use mismatchedGetResponse = client.Send mismatchedGet

                    if mismatchedGetResponse.StatusCode <> HttpStatusCode.Forbidden then
                        failwith "A present mismatched GET Origin must be rejected."

                    use missingPostOrigin =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            None
                            (Some "{\"contentId\":\"about\"}")
                            (Some cookie)

                    use missingPostOriginResponse = client.Send missingPostOrigin

                    if missingPostOriginResponse.StatusCode <> HttpStatusCode.Forbidden then
                        failwith "Statistics POST must require Origin."

                    use arbitraryId =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"lexically-valid\"}")
                            (Some cookie)

                    use arbitraryIdResponse = client.Send arbitraryId

                    if arbitraryIdResponse.StatusCode <> HttpStatusCode.BadRequest then
                        failwith "Lexically valid IDs outside the catalog/project boundary must be rejected."

                    let unchangedAfterInvalid = snapshot store

                    if unchangedAfterInvalid.TotalSessions <> 0L || unchangedAfterInvalid.TotalPageViews <> 0L then
                        failwith "An invalid content identifier must not change API aggregate totals."

                    use lexicalInvalid =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"not countable!\"}")
                            (Some cookie)

                    use lexicalInvalidResponse = client.Send lexicalInvalid

                    if lexicalInvalidResponse.StatusCode <> HttpStatusCode.BadRequest then
                        failwith "Lexically invalid content IDs must remain invalid requests."

                    use validPost =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"about\"}")
                            (Some cookie)

                    use validPostResponse = client.Send validPost

                    if validPostResponse.StatusCode <> HttpStatusCode.OK then
                        failwithf "Expected countable view 200, received %O." validPostResponse.StatusCode

                    let validBody =
                        validPostResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                    if
                        not (validBody.Contains("\"totalSessions\":1", StringComparison.Ordinal))
                        || not (validBody.Contains("\"totalPageViews\":1", StringComparison.Ordinal))
                    then
                        failwith "The first API view must atomically count its session and content."

                    use duplicatePost =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"about\"}")
                            (Some cookie)

                    use duplicatePostResponse = client.Send duplicatePost

                    let duplicateBody =
                        duplicatePostResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                    if not (duplicateBody.Contains("\"totalPageViews\":1", StringComparison.Ordinal)) then
                        failwith "The API must deduplicate content within one statistics session."

                    use projectPost =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"sample-project\"}")
                            (Some cookie)

                    use projectPostResponse = client.Send projectPost

                    let projectBody =
                        projectPostResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                    if
                        not (projectBody.Contains("\"totalSessions\":1", StringComparison.Ordinal))
                        || not (projectBody.Contains("\"totalPageViews\":2", StringComparison.Ordinal))
                    then
                        failwith
                            "Project IDs from the current content boundary must be countable without duplicating sessions."

                    for attempt in 5..15 do
                        use invalidContent =
                            request
                                HttpMethod.Post
                                "/api/stats/view"
                                (Some origin)
                                (Some "{\"contentId\":\"lexically-valid\"}")
                                (Some cookie)

                        use invalidContentResponse = client.Send invalidContent

                        if invalidContentResponse.StatusCode <> HttpStatusCode.BadRequest then
                            failwithf
                                "Expected invalid-content attempt %d to remain 400, received %O."
                                attempt
                                invalidContentResponse.StatusCode

                    use rateLimitedInvalidContent =
                        request
                            HttpMethod.Post
                            "/api/stats/view"
                            (Some origin)
                            (Some "{\"contentId\":\"lexically-valid\"}")
                            (Some cookie)

                    use rateLimitedInvalidContentResponse = client.Send rateLimitedInvalidContent

                    if rateLimitedInvalidContentResponse.StatusCode <> HttpStatusCode.TooManyRequests then
                        failwith
                            "Lexically valid invalid content must consume the API session budget before allowlist rejection."

                    let unchangedAfterRateLimit = snapshot store

                    if
                        unchangedAfterRateLimit.TotalSessions <> 1L
                        || unchangedAfterRateLimit.TotalPageViews <> 2L
                        || unchangedAfterRateLimit.PageViewsByContent.ContainsKey "lexically-valid"
                    then
                        failwith "Invalid API content must never aggregate or enter persisted content counts."

                    use cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(5.0))
                    use sseRequest = request HttpMethod.Get "/api/stats/events" None None (Some cookie)

                    use sseResponse =
                        client.Send(sseRequest, HttpCompletionOption.ResponseHeadersRead, cancellation.Token)

                    if
                        sseResponse.StatusCode <> HttpStatusCode.OK
                        || sseResponse.Content.Headers.ContentType.MediaType <> "text/event-stream"
                    then
                        failwith "The statistics event endpoint must return an SSE stream."

                    use stream = sseResponse.Content.ReadAsStream(cancellation.Token)
                    use reader = new StreamReader(stream)

                    let retry =
                        reader.ReadLineAsync(cancellation.Token).AsTask().GetAwaiter().GetResult()

                    let data =
                        reader.ReadLineAsync(cancellation.Token).AsTask().GetAwaiter().GetResult()

                    let separator =
                        reader.ReadLineAsync(cancellation.Token).AsTask().GetAwaiter().GetResult()

                    let heartbeat =
                        reader.ReadLineAsync(cancellation.Token).AsTask().GetAwaiter().GetResult()

                    let heartbeatSeparator =
                        reader.ReadLineAsync(cancellation.Token).AsTask().GetAwaiter().GetResult()

                    if
                        retry <> "retry: 5000"
                        || not (data.StartsWith("data: {", StringComparison.Ordinal))
                        || separator <> ""
                        || heartbeat <> ": heartbeat"
                        || heartbeatSeparator <> ""
                    then
                        failwith
                            "The statistics SSE stream must send retry guidance, its current snapshot, and heartbeats."

                    cancellation.Cancel()

                    try
                        reader
                            .ReadLineAsync(cancellation.Token)
                            .AsTask()
                            .WaitAsync(TimeSpan.FromSeconds(5.0))
                            .GetAwaiter()
                            .GetResult()
                        |> ignore

                        failwith "A cancelled statistics SSE request must stop reading promptly."
                    with :? OperationCanceledException -> ()))

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)
            let mutable setupAttempts = 0

            let wrongLengthRandomBytes count =
                setupAttempts <- setupAttempts + 1
                Array.zeroCreate (count - 1)

            HostApplication.createWithContentClientAndStats
                [||]
                (countableContentClient ())
                store
                true
                wrongLengthRandomBytes
                (fun () -> now)
                (TimeSpan.FromSeconds(30.0))
            |> fun application ->
                withRunningHost application (fun client _ ->
                    use sseRequest = request HttpMethod.Get "/api/stats/events" None None None

                    try
                        use response =
                            client
                                .SendAsync(sseRequest, HttpCompletionOption.ResponseHeadersRead)
                                .WaitAsync(TimeSpan.FromSeconds(5.0))
                                .GetAwaiter()
                                .GetResult()

                        if response.IsSuccessStatusCode then
                            failwith "Failed statistics SSE setup must not establish a successful stream."
                    with :? HttpRequestException -> ()

                    if setupAttempts <> 1 then
                        failwithf
                            "Expected one post-registration statistics cookie setup attempt, received %d."
                            setupAttempts))

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            HostApplication.createWithContentClientAndStats
                [||]
                (countableContentClient ())
                store
                false
                (fun count -> Array.zeroCreate count)
                (fun () -> now)
                (TimeSpan.FromSeconds(30.0))
            |> fun application ->
                withRunningHost application (fun client _ ->
                    use response = client.GetAsync("/api/stats").GetAwaiter().GetResult()
                    let setCookie = response.Headers.GetValues("Set-Cookie") |> Seq.exactlyOne

                    if not (setCookie.Contains("secure", StringComparison.OrdinalIgnoreCase)) then
                        failwith "Statistics cookies must be Secure outside local HTTP development."))

        let unavailableStore = Stats.unavailableStore (fun () -> now)

        HostApplication.createWithContentClientAndStats
            [||]
            (countableContentClient ())
            unavailableStore
            true
            (fun count -> Array.zeroCreate count)
            (fun () -> now)
            (TimeSpan.FromSeconds(30.0))
        |> fun application ->
            withRunningHost application (fun client _ ->
                use response = client.GetAsync("/api/stats").GetAwaiter().GetResult()
                let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                if
                    response.StatusCode <> HttpStatusCode.ServiceUnavailable
                    || not (body.Contains("\"code\":\"stats-unavailable\"", StringComparison.Ordinal))
                    || body.Contains("totalSessions", StringComparison.Ordinal)
                then
                    failwith "A never-valid statistics store must return a payload-free stable unavailable problem.")

    let run () =
        runStoreDurabilityAndPrivacyChecks ()
        runRecoveryAndAvailabilityChecks ()
        runRateAndSubscriptionChecks ()
        runApiChecks ()
