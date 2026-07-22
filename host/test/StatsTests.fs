namespace Termin.Al.Host.Tests

open System
open System.IO
open System.Text.Json
open System.Threading
open System.Threading.Tasks
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

            match record readOnlyStore "another-session" "sample-project" with
            | Stats.Unavailable -> ()
            | result -> failwithf "A cleanup-failed store must reject writes as unavailable, received %A." result

            if File.ReadAllText(mainPath) <> persisted then
                failwith "Temporary-sibling cleanup failure must not damage the valid main statistics file."

            readOnlyStore.Shutdown())

    let private runRateChecks () =
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

            store.Shutdown())

        withTemporaryDirectory (fun path ->
            let store = Stats.createStoreAt path (fun () -> now)

            for attempt in 1..15 do
                match
                    store.RecordView("invalid-session", "lexically-valid", allowedContent, now, CancellationToken.None)
                    |> _.GetAwaiter().GetResult()
                with
                | Stats.InvalidContent -> ()
                | result -> failwithf "Unexpected invalid-content result for attempt %d: %A." attempt result

            match
                store.RecordView("invalid-session", "lexically-valid", allowedContent, now, CancellationToken.None)
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
                        store.RecordView(sessionId, "lexically-valid", allowedContent, now, CancellationToken.None)
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
                store.RecordView("process-session-21", "lexically-valid", allowedContent, now, CancellationToken.None)
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

    let run () =
        runStoreDurabilityAndPrivacyChecks ()
        runRecoveryAndAvailabilityChecks ()
        runRateChecks ()
