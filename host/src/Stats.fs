namespace Termin.Al.Host

open System
open System.Globalization
open System.IO
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Channels
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.AspNetCore.Routing
open Microsoft.Extensions.Configuration

[<RequireQualifiedAccess>]
module Stats =
    [<Literal>]
    let private SchemaVersion = 1

    [<Literal>]
    let private RetainedDayCount = 400

    [<Literal>]
    let private SessionRateLimit = 15

    [<Literal>]
    let private ProcessRateLimit = 300

    [<Literal>]
    let private SessionCookieName = "termin.al.stats-session"

    type StorageState =
        | Writable
        | ReadOnly

    type DailyCount =
        { Date: DateOnly
          Sessions: int64
          PageViews: int64 }

    type Snapshot =
        { TotalSessions: int64
          TotalPageViews: int64
          PageViewsByContent: Map<string, int64>
          Daily: DailyCount list
          StorageState: StorageState }

    type RecordResult =
        | Accepted of Snapshot
        | Duplicate of Snapshot
        | InvalidContent
        | RateLimited
        | Unavailable

    type private PersistedState =
        { TotalSessions: int64
          TotalPageViews: int64
          PageViewsByContent: Map<string, int64>
          Daily: DailyCount list }

    type private LoadedState =
        | LoadedWritable of PersistedState
        | LoadedReadOnly of PersistedState
        | NeverValid

    type private RateWindow = { Minute: DateTimeOffset; Count: int }

    type private State =
        { Persisted: PersistedState option
          Writable: bool
          SeenSessions: Set<string>
          SeenContentBySession: Map<string, Set<string>>
          SessionRates: Map<string, RateWindow>
          ProcessRate: RateWindow option
          Subscribers: Map<Guid, ChannelWriter<string>> }

    type private Message =
        | GetSnapshot of AsyncReplyChannel<Snapshot option>
        | RecordView of string * string * Set<string> * DateTimeOffset * AsyncReplyChannel<RecordResult>
        | Subscribe of Guid * ChannelWriter<string> * AsyncReplyChannel<Snapshot option>
        | Unsubscribe of Guid
        | Flush of AsyncReplyChannel<unit>
        | Stop of AsyncReplyChannel<unit>

    let private utcDate (value: DateTimeOffset) =
        DateOnly.FromDateTime(value.UtcDateTime)

    let private utcMinute (value: DateTimeOffset) =
        let utc = value.ToUniversalTime()
        DateTimeOffset(utc.Year, utc.Month, utc.Day, utc.Hour, utc.Minute, 0, TimeSpan.Zero)

    let private emptyDays (today: DateOnly) : DailyCount list =
        [ 0 .. RetainedDayCount - 1 ]
        |> List.map (fun offset ->
            { Date = today.AddDays(offset - RetainedDayCount + 1)
              Sessions = 0L
              PageViews = 0L })

    let private normalizeDays (today: DateOnly) (days: DailyCount list) : DailyCount list =
        let counts = days |> Seq.map (fun day -> day.Date, day) |> Map.ofSeq

        emptyDays today
        |> List.map (fun empty -> counts |> Map.tryFind empty.Date |> Option.defaultValue empty)

    let private normalizeState (today: DateOnly) (state: PersistedState) : PersistedState =
        { state with
            Daily = normalizeDays today state.Daily }

    let private emptyState (today: DateOnly) : PersistedState =
        { TotalSessions = 0L
          TotalPageViews = 0L
          PageViewsByContent = Map.empty
          Daily = emptyDays today }

    let private snapshot (writable: bool) (persisted: PersistedState) : Snapshot =
        { TotalSessions = persisted.TotalSessions
          TotalPageViews = persisted.TotalPageViews
          PageViewsByContent = persisted.PageViewsByContent
          Daily = persisted.Daily
          StorageState = if writable then Writable else ReadOnly }

    let private writeSnapshotJson (stream: Stream) (persisted: PersistedState) =
        use writer = new Utf8JsonWriter(stream, JsonWriterOptions(Indented = true))
        writer.WriteStartObject()
        writer.WriteNumber("schemaVersion", SchemaVersion)
        writer.WriteNumber("totalSessions", persisted.TotalSessions)
        writer.WriteNumber("totalPageViews", persisted.TotalPageViews)
        writer.WritePropertyName("pageViewsByContent")
        writer.WriteStartObject()

        persisted.PageViewsByContent
        |> Map.iter (fun contentId count -> writer.WriteNumber(contentId, count))

        writer.WriteEndObject()
        writer.WritePropertyName("daily")
        writer.WriteStartArray()

        for day in persisted.Daily do
            writer.WriteStartObject()
            writer.WriteString("date", day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            writer.WriteNumber("sessions", day.Sessions)
            writer.WriteNumber("pageViews", day.PageViews)
            writer.WriteEndObject()

        writer.WriteEndArray()
        writer.WriteEndObject()
        writer.Flush()

    let private snapshotJson (value: Snapshot) =
        use stream = new MemoryStream()
        use writer = new Utf8JsonWriter(stream)
        writer.WriteStartObject()
        writer.WriteNumber("totalSessions", value.TotalSessions)
        writer.WriteNumber("totalPageViews", value.TotalPageViews)
        writer.WritePropertyName("pageViewsByContent")
        writer.WriteStartObject()

        value.PageViewsByContent
        |> Map.iter (fun contentId count -> writer.WriteNumber(contentId, count))

        writer.WriteEndObject()
        writer.WritePropertyName("daily")
        writer.WriteStartArray()

        for day in value.Daily do
            writer.WriteStartObject()
            writer.WriteString("date", day.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            writer.WriteNumber("sessions", day.Sessions)
            writer.WriteNumber("pageViews", day.PageViews)
            writer.WriteEndObject()

        writer.WriteEndArray()

        writer.WriteString(
            "storageState",
            match value.StorageState with
            | Writable -> "writable"
            | ReadOnly -> "read-only"
        )

        writer.WriteEndObject()
        writer.Flush()
        Encoding.UTF8.GetString(stream.ToArray())

    let private tryProperty (name: string) (element: JsonElement) =
        match element.TryGetProperty name with
        | true, value -> Some value
        | false, _ -> None

    let private hasExactProperties expected (element: JsonElement) =
        element.EnumerateObject() |> Seq.map _.Name |> Set.ofSeq = expected

    let private tryNonNegativeInt64 (name: string) (element: JsonElement) =
        match tryProperty name element with
        | Some value when value.ValueKind = JsonValueKind.Number ->
            match value.TryGetInt64() with
            | true, count when count >= 0L -> Some count
            | _ -> None
        | _ -> None

    let private tryDate (value: JsonElement) =
        if value.ValueKind <> JsonValueKind.String then
            None
        else
            let text = value.GetString()

            match DateOnly.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None) with
            | true, date -> Some date
            | _ -> None

    let private tryParsePersisted (path: string) : PersistedState option =
        try
            use stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)
            use document = JsonDocument.Parse(stream)
            let root = document.RootElement

            let expectedRootProperties =
                Set.ofList
                    [ "schemaVersion"
                      "totalSessions"
                      "totalPageViews"
                      "pageViewsByContent"
                      "daily" ]

            if
                root.ValueKind <> JsonValueKind.Object
                || not (hasExactProperties expectedRootProperties root)
            then
                None
            else
                match tryNonNegativeInt64 "schemaVersion" root with
                | Some version when version = int64 SchemaVersion ->
                    match
                        tryNonNegativeInt64 "totalSessions" root,
                        tryNonNegativeInt64 "totalPageViews" root,
                        tryProperty "pageViewsByContent" root,
                        tryProperty "daily" root
                    with
                    | Some totalSessions, Some totalPageViews, Some content, Some daily when
                        content.ValueKind = JsonValueKind.Object
                        && daily.ValueKind = JsonValueKind.Array
                        ->
                        let contentCounts =
                            content.EnumerateObject()
                            |> Seq.fold
                                (fun parsed (property: JsonProperty) ->
                                    parsed
                                    |> Option.bind (fun counts ->
                                        match ContentDomain.ContentId.tryCreate "contentId" property.Name with
                                        | Error _ -> None
                                        | Ok _ ->
                                            match property.Value.TryGetInt64() with
                                            | true, count when count >= 0L -> Some(Map.add property.Name count counts)
                                            | _ -> None))
                                (Some Map.empty)

                        let days =
                            daily.EnumerateArray()
                            |> Seq.fold
                                (fun parsed (day: JsonElement) ->
                                    parsed
                                    |> Option.bind (fun counts ->
                                        if
                                            day.ValueKind <> JsonValueKind.Object
                                            || not (
                                                hasExactProperties
                                                    (Set.ofList [ "date"; "sessions"; "pageViews" ])
                                                    day
                                            )
                                        then
                                            None
                                        else
                                            match
                                                tryProperty "date" day |> Option.bind tryDate,
                                                tryNonNegativeInt64 "sessions" day,
                                                tryNonNegativeInt64 "pageViews" day
                                            with
                                            | Some date, Some sessions, Some pageViews ->
                                                Some(
                                                    { Date = date
                                                      Sessions = sessions
                                                      PageViews = pageViews }
                                                    :: counts
                                                )
                                            | _ -> None))
                                (Some [])

                        match contentCounts, days with
                        | Some counts, Some reversedDays ->
                            let orderedDays = List.rev reversedDays
                            let dates = orderedDays |> List.map _.Date

                            let consecutive =
                                dates
                                |> List.pairwise
                                |> List.forall (fun (left, right) -> right = left.AddDays(1))

                            if
                                orderedDays.Length = RetainedDayCount
                                && consecutive
                                && (counts |> Map.toSeq |> Seq.sumBy snd) = totalPageViews
                            then
                                Some
                                    { TotalSessions = totalSessions
                                      TotalPageViews = totalPageViews
                                      PageViewsByContent = counts
                                      Daily = orderedDays }
                            else
                                None
                        | _ -> None
                    | _ -> None
                | _ -> None
        with _ ->
            None

    let private persist (mainPath: string) (temporaryPath: string) (persisted: PersistedState) =
        use stream =
            new FileStream(
                temporaryPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                4096,
                FileOptions.WriteThrough
            )

        writeSnapshotJson stream persisted
        stream.Flush(true)
        File.Move(temporaryPath, mainPath, true)

    let private load (dataPath: string option) (now: DateTimeOffset) : LoadedState =
        match dataPath with
        | None -> NeverValid
        | Some directory ->
            try
                Directory.CreateDirectory(directory) |> ignore
                let mainPath = Path.Combine(directory, "statistics.json")
                let temporaryPath = Path.Combine(directory, "statistics.json.tmp")
                let mainExists = File.Exists mainPath
                let temporaryExists = File.Exists temporaryPath || Directory.Exists temporaryPath
                let main = if mainExists then tryParsePersisted mainPath else None

                let temporary =
                    if File.Exists temporaryPath then
                        tryParsePersisted temporaryPath
                    else
                        None

                match main, temporary, mainExists, temporaryExists with
                | Some valid, _, _, _ ->
                    let normalized = normalizeState (utcDate now) valid

                    try
                        if temporaryExists then
                            File.Delete temporaryPath

                        if normalized <> valid then
                            persist mainPath temporaryPath normalized

                        LoadedWritable normalized
                    with _ ->
                        LoadedReadOnly normalized
                | None, Some valid, _, _ ->
                    let normalized = normalizeState (utcDate now) valid

                    try
                        persist mainPath temporaryPath normalized
                        LoadedWritable normalized
                    with _ ->
                        LoadedReadOnly normalized
                | None, None, false, false -> LoadedWritable(emptyState (utcDate now))
                | _ -> NeverValid
            with _ ->
                NeverValid

    let private incrementDaily (sessionIsNew: bool) (today: DateOnly) (days: DailyCount list) =
        normalizeDays today days
        |> List.map (fun day ->
            if day.Date = today then
                { day with
                    Sessions = day.Sessions + if sessionIsNew then 1L else 0L
                    PageViews = day.PageViews + 1L }
            else
                day)

    let private incrementPersisted
        (sessionIsNew: bool)
        (contentId: string)
        (now: DateTimeOffset)
        (persisted: PersistedState)
        : PersistedState =
        { TotalSessions = persisted.TotalSessions + if sessionIsNew then 1L else 0L
          TotalPageViews = persisted.TotalPageViews + 1L
          PageViewsByContent =
            persisted.PageViewsByContent
            |> Map.change contentId (fun count -> Some(defaultArg count 0L + 1L))
          Daily = incrementDaily sessionIsNew (utcDate now) persisted.Daily }

    let private consumeRate (limit: int) (minute: DateTimeOffset) (current: RateWindow option) =
        match current with
        | Some window when window.Minute = minute && window.Count >= limit -> false, window
        | Some window when window.Minute = minute -> true, { window with Count = window.Count + 1 }
        | _ -> true, { Minute = minute; Count = 1 }

    let private broadcast (subscribers: Map<Guid, ChannelWriter<string>>) (message: string) =
        subscribers |> Map.filter (fun _ writer -> writer.TryWrite message)

    type Store private (dataPath: string option, now: unit -> DateTimeOffset) =
        let mainPath =
            dataPath |> Option.map (fun path -> Path.Combine(path, "statistics.json"))

        let temporaryPath =
            dataPath |> Option.map (fun path -> Path.Combine(path, "statistics.json.tmp"))

        let initial = load dataPath (now ())
        let mutable stopped = false

        let initialState: State =
            match initial with
            | LoadedWritable persisted ->
                { Persisted = Some persisted
                  Writable = true
                  SeenSessions = Set.empty
                  SeenContentBySession = Map.empty
                  SessionRates = Map.empty
                  ProcessRate = None
                  Subscribers = Map.empty }
            | LoadedReadOnly persisted ->
                { Persisted = Some persisted
                  Writable = false
                  SeenSessions = Set.empty
                  SeenContentBySession = Map.empty
                  SessionRates = Map.empty
                  ProcessRate = None
                  Subscribers = Map.empty }
            | NeverValid ->
                { Persisted = None
                  Writable = false
                  SeenSessions = Set.empty
                  SeenContentBySession = Map.empty
                  SessionRates = Map.empty
                  ProcessRate = None
                  Subscribers = Map.empty }

        let agent =
            MailboxProcessor.Start(fun (inbox: MailboxProcessor<Message>) ->
                let rec loop (state: State) =
                    async {
                        let! message = inbox.Receive()

                        match message with
                        | GetSnapshot reply ->
                            state.Persisted |> Option.map (snapshot state.Writable) |> reply.Reply
                            return! loop state
                        | Subscribe(id, writer, reply) ->
                            state.Persisted |> Option.map (snapshot state.Writable) |> reply.Reply

                            return!
                                loop
                                    { state with
                                        Subscribers = Map.add id writer state.Subscribers }
                        | Unsubscribe id ->
                            return!
                                loop
                                    { state with
                                        Subscribers = Map.remove id state.Subscribers }
                        | Flush reply ->
                            reply.Reply()
                            return! loop state
                        | Stop reply ->
                            state.Subscribers |> Map.iter (fun _ writer -> writer.TryComplete() |> ignore)
                            reply.Reply()
                        | RecordView(sessionId, contentId, allowedContentIds, timestamp, reply) ->
                            match state.Persisted with
                            | None ->
                                reply.Reply Unavailable
                                return! loop state
                            | Some persisted when not state.Writable ->
                                reply.Reply Unavailable
                                return! loop state
                            | Some persisted ->
                                let minute = utcMinute timestamp

                                let currentSessionRates =
                                    state.SessionRates |> Map.filter (fun _ window -> window.Minute = minute)

                                let sessionAllowed, sessionWindow =
                                    consumeRate SessionRateLimit minute (currentSessionRates |> Map.tryFind sessionId)

                                let processAllowed, processWindow =
                                    consumeRate ProcessRateLimit minute state.ProcessRate

                                let ratedState =
                                    { state with
                                        SessionRates = Map.add sessionId sessionWindow currentSessionRates
                                        ProcessRate = Some processWindow }

                                if not sessionAllowed || not processAllowed then
                                    reply.Reply RateLimited
                                    return! loop ratedState
                                elif not (allowedContentIds.Contains contentId) then
                                    reply.Reply InvalidContent
                                    return! loop ratedState
                                else

                                    let seenContent =
                                        ratedState.SeenContentBySession
                                        |> Map.tryFind sessionId
                                        |> Option.defaultValue Set.empty

                                    if seenContent.Contains contentId then
                                        reply.Reply(Duplicate(snapshot true persisted))
                                        return! loop ratedState
                                    else
                                        let sessionIsNew = not (ratedState.SeenSessions.Contains sessionId)
                                        let updated = incrementPersisted sessionIsNew contentId timestamp persisted

                                        try
                                            persist (Option.get mainPath) (Option.get temporaryPath) updated
                                            let updatedSnapshot = snapshot true updated

                                            let subscribers =
                                                broadcast ratedState.Subscribers (snapshotJson updatedSnapshot)

                                            reply.Reply(Accepted updatedSnapshot)

                                            return!
                                                loop
                                                    { ratedState with
                                                        Persisted = Some updated
                                                        SeenSessions = Set.add sessionId ratedState.SeenSessions
                                                        SeenContentBySession =
                                                            Map.add
                                                                sessionId
                                                                (Set.add contentId seenContent)
                                                                ratedState.SeenContentBySession
                                                        Subscribers = subscribers }
                                        with _ ->
                                            let readOnlySnapshot = snapshot false persisted

                                            let subscribers =
                                                broadcast ratedState.Subscribers (snapshotJson readOnlySnapshot)

                                            reply.Reply Unavailable

                                            return!
                                                loop
                                                    { ratedState with
                                                        Writable = false
                                                        Subscribers = subscribers }
                    }

                loop initialState)

        static member Create(dataPath: string option, now: unit -> DateTimeOffset) = Store(dataPath, now)

        member _.GetSnapshot(cancellationToken: CancellationToken) : Task<Snapshot option> =
            agent.PostAndAsyncReply GetSnapshot
            |> fun work -> Async.StartAsTask(work, cancellationToken = cancellationToken)

        member _.RecordView
            (
                sessionId: string,
                contentId: string,
                allowedContentIds: Set<string>,
                timestamp: DateTimeOffset,
                cancellationToken: CancellationToken
            ) : Task<RecordResult> =
            agent.PostAndAsyncReply(fun reply -> RecordView(sessionId, contentId, allowedContentIds, timestamp, reply))
            |> fun work -> Async.StartAsTask(work, cancellationToken = cancellationToken)

        member _.Subscribe(cancellationToken: CancellationToken) =
            let id = Guid.NewGuid()
            let options = BoundedChannelOptions(1)
            options.FullMode <- BoundedChannelFullMode.DropOldest
            let channel = Channel.CreateBounded<string>(options)

            task {
                let! initial =
                    agent.PostAndAsyncReply(fun reply -> Subscribe(id, channel.Writer, reply))
                    |> fun work -> Async.StartAsTask(work, cancellationToken = cancellationToken)

                return channel.Reader, id, initial
            }

        member _.Unsubscribe(id: Guid) = agent.Post(Unsubscribe id)

        member _.Flush(cancellationToken: CancellationToken) : Task =
            agent.PostAndAsyncReply Flush
            |> fun work -> Async.StartAsTask(work, cancellationToken = cancellationToken)
            :> Task

        member _.Shutdown() =
            lock agent (fun () ->
                if not stopped then
                    agent.PostAndReply Stop
                    stopped <- true)

    let private sameOrigin (context: HttpContext) (requireOrigin: bool) =
        let origin = context.Request.Headers.Origin.ToString()

        if String.IsNullOrEmpty origin then
            not requireOrigin
        else
            String.Equals(origin, $"{context.Request.Scheme}://{context.Request.Host.Value}", StringComparison.Ordinal)

    let private problem (context: HttpContext) (status: int) (code: string) (title: string) : IResult =
        context.Response.Headers.CacheControl <- "no-store"

        Results.Text(
            $"{{\"title\":{JsonSerializer.Serialize title},\"status\":{status},\"code\":\"{code}\"}}",
            "application/problem+json",
            Encoding.UTF8,
            status
        )

    let private setSessionCookie allowLocalHttp (randomBytes: int -> byte array) (context: HttpContext) =
        let existing = context.Request.Cookies[SessionCookieName]

        let validExisting =
            if isNull existing || existing.Length <> 22 then
                false
            else
                try
                    let padded = existing.Replace('-', '+').Replace('_', '/') + "=="
                    Convert.FromBase64String(padded).Length = 16
                with _ ->
                    false

        if validExisting then
            existing
        else
            let bytes = randomBytes 16

            if bytes.Length <> 16 then
                invalidOp "Statistics session randomness must contain exactly 128 bits."

            let value =
                Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

            let options = CookieOptions()
            options.HttpOnly <- true
            options.SameSite <- SameSiteMode.Strict
            options.Path <- "/"

            let isLoopbackHost =
                String.Equals(context.Request.Host.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || match System.Net.IPAddress.TryParse context.Request.Host.Host with
                   | true, address -> System.Net.IPAddress.IsLoopback address
                   | false, _ -> false

            options.Secure <- not (allowLocalHttp && context.Request.Scheme = Uri.UriSchemeHttp && isLoopbackHost)

            context.Response.Cookies.Append(SessionCookieName, value, options)
            value

    let private contentAllowlist (contentClient: ContentClient) (cancellationToken: CancellationToken) =
        task {
            let! catalogResult = contentClient.GetCatalog cancellationToken
            let! projectsResult = contentClient.GetProjects cancellationToken

            return
                match catalogResult, projectsResult with
                | Ok catalog, Ok projects ->
                    let documents =
                        catalog
                        |> ContentDomain.Catalog.entries
                        |> List.choose ContentDomain.CatalogEntry.documentHandle
                        |> List.map ContentDomain.ContentId.value

                    let projectIds =
                        projects
                        |> ContentDomain.Projects.entries
                        |> List.map (
                            ContentDomain.ProjectReadme.project
                            >> ContentDomain.Project.id
                            >> ContentDomain.ContentId.value
                        )

                    Some(Set.ofList (documents @ projectIds))
                | _ -> None
        }

    let private tryReadContentId (context: HttpContext) (cancellationToken: CancellationToken) =
        task {
            try
                use! document = JsonDocument.ParseAsync(context.Request.Body, cancellationToken = cancellationToken)
                let root = document.RootElement

                let properties =
                    if root.ValueKind = JsonValueKind.Object then
                        root.EnumerateObject() |> Seq.toList
                    else
                        []

                match properties with
                | [ property ] when
                    property.NameEquals("contentId")
                    && property.Value.ValueKind = JsonValueKind.String
                    ->
                    let value = property.Value.GetString()

                    match ContentDomain.ContentId.tryCreate "contentId" value with
                    | Ok _ -> return Some value
                    | Error _ -> return None
                | _ -> return None
            with :? JsonException ->
                return None
        }

    let private getStats
        (store: Store)
        (allowLocalHttp: bool)
        (randomBytes: int -> byte array)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            if not (sameOrigin context false) then
                return
                    problem
                        context
                        StatusCodes.Status403Forbidden
                        "origin-mismatch"
                        "The request origin is not allowed."
            else
                let! current = store.GetSnapshot cancellationToken

                return
                    match current with
                    | Some value ->
                        setSessionCookie allowLocalHttp randomBytes context |> ignore
                        context.Response.Headers.CacheControl <- "no-store"
                        Results.Text(snapshotJson value, "application/json", Encoding.UTF8, StatusCodes.Status200OK)
                    | None ->
                        problem
                            context
                            StatusCodes.Status503ServiceUnavailable
                            "stats-unavailable"
                            "Statistics are unavailable."
        }

    let private postView
        (store: Store)
        (contentClient: ContentClient)
        (allowLocalHttp: bool)
        (randomBytes: int -> byte array)
        (now: unit -> DateTimeOffset)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task<IResult> =
        task {
            if not (sameOrigin context true) then
                return
                    problem
                        context
                        StatusCodes.Status403Forbidden
                        "origin-mismatch"
                        "The request origin is not allowed."
            else
                let! contentId = tryReadContentId context cancellationToken

                match contentId with
                | None ->
                    return
                        problem
                            context
                            StatusCodes.Status400BadRequest
                            "invalid-request"
                            "The statistics request is invalid."
                | Some validContentId ->
                    let sessionId = setSessionCookie allowLocalHttp randomBytes context
                    let! allowed = contentAllowlist contentClient cancellationToken

                    match allowed with
                    | None ->
                        return
                            problem
                                context
                                StatusCodes.Status503ServiceUnavailable
                                "stats-unavailable"
                                "Statistics are unavailable."
                    | Some allowedIds ->
                        let! result = store.RecordView(sessionId, validContentId, allowedIds, now (), cancellationToken)

                        return
                            match result with
                            | Accepted value
                            | Duplicate value ->
                                context.Response.Headers.CacheControl <- "no-store"

                                Results.Text(
                                    snapshotJson value,
                                    "application/json",
                                    Encoding.UTF8,
                                    StatusCodes.Status200OK
                                )
                            | RateLimited ->
                                problem
                                    context
                                    StatusCodes.Status429TooManyRequests
                                    "stats-rate-limited"
                                    "Statistics submissions are rate limited."
                            | InvalidContent ->
                                problem
                                    context
                                    StatusCodes.Status400BadRequest
                                    "invalid-content"
                                    "The content identifier is not countable."
                            | Unavailable ->
                                problem
                                    context
                                    StatusCodes.Status503ServiceUnavailable
                                    "stats-unavailable"
                                    "Statistics are unavailable."
        }

    let private events
        (store: Store)
        (allowLocalHttp: bool)
        (randomBytes: int -> byte array)
        (heartbeatInterval: TimeSpan)
        (context: HttpContext)
        (cancellationToken: CancellationToken)
        : Task =
        task {
            if not (sameOrigin context false) then
                context.Response.StatusCode <- StatusCodes.Status403Forbidden
                context.Response.ContentType <- "application/problem+json"

                do!
                    context.Response.WriteAsync(
                        "{\"title\":\"The request origin is not allowed.\",\"status\":403,\"code\":\"origin-mismatch\"}",
                        cancellationToken
                    )
            else
                let! current = store.GetSnapshot cancellationToken

                match current with
                | None ->
                    context.Response.StatusCode <- StatusCodes.Status503ServiceUnavailable
                    context.Response.ContentType <- "application/problem+json"

                    do!
                        context.Response.WriteAsync(
                            "{\"title\":\"Statistics are unavailable.\",\"status\":503,\"code\":\"stats-unavailable\"}",
                            cancellationToken
                        )
                | Some _ ->
                    setSessionCookie allowLocalHttp randomBytes context |> ignore
                    context.Response.StatusCode <- StatusCodes.Status200OK
                    context.Response.ContentType <- "text/event-stream"
                    context.Response.Headers.CacheControl <- "no-store"
                    context.Response.Headers.Append("X-Accel-Buffering", "no")
                    let! reader, subscriptionId, initial = store.Subscribe(cancellationToken)

                    try
                        try
                            do! context.Response.WriteAsync("retry: 5000\n", cancellationToken)

                            match initial with
                            | Some value ->
                                do! context.Response.WriteAsync($"data: {snapshotJson value}\n\n", cancellationToken)
                            | None -> ()

                            do! context.Response.Body.FlushAsync(cancellationToken)
                            let mutable connected = true

                            while connected && not cancellationToken.IsCancellationRequested do
                                let available = reader.WaitToReadAsync(cancellationToken).AsTask()
                                let heartbeat = Task.Delay(heartbeatInterval, cancellationToken)
                                let! completed = Task.WhenAny(available, heartbeat)

                                if Object.ReferenceEquals(completed, heartbeat) then
                                    do! context.Response.WriteAsync(": heartbeat\n\n", cancellationToken)
                                    do! context.Response.Body.FlushAsync(cancellationToken)
                                elif available.Result then
                                    let mutable payload = Unchecked.defaultof<string>

                                    while reader.TryRead(&payload) do
                                        do! context.Response.WriteAsync($"data: {payload}\n\n", cancellationToken)

                                    do! context.Response.Body.FlushAsync(cancellationToken)
                                else
                                    connected <- false
                        with :? OperationCanceledException ->
                            ()
                    finally
                        store.Unsubscribe subscriptionId
        }
        :> Task

    let mapEndpoints
        (routes: IEndpointRouteBuilder)
        (store: Store)
        (contentClient: ContentClient)
        (allowLocalHttp: bool)
        (randomBytes: int -> byte array)
        (now: unit -> DateTimeOffset)
        (heartbeatInterval: TimeSpan)
        : unit =
        let api = routes.MapGroup("/api/stats")

        api.MapGet("", Func<HttpContext, CancellationToken, Task<IResult>>(getStats store allowLocalHttp randomBytes))
        |> ignore

        api.MapPost(
            "/view",
            Func<HttpContext, CancellationToken, Task<IResult>>(
                postView store contentClient allowLocalHttp randomBytes now
            )
        )
        |> ignore

        api.MapGet(
            "/events",
            Func<HttpContext, CancellationToken, Task>(events store allowLocalHttp randomBytes heartbeatInterval)
        )
        |> ignore

    let createStore (configuration: IConfiguration) (now: unit -> DateTimeOffset) =
        let configuredPath = configuration["Stats:DataPath"]

        let dataPath =
            if String.IsNullOrWhiteSpace configuredPath then
                None
            else
                Some(Path.GetFullPath configuredPath)

        Store.Create(dataPath, now)

    let createStoreAt dataPath now =
        Store.Create(Some(Path.GetFullPath dataPath), now)

    let unavailableStore now = Store.Create(None, now)

    let randomBytes count = RandomNumberGenerator.GetBytes count
