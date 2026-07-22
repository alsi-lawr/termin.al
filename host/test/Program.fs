namespace Termin.Al.Host.Tests

open System
open System.Collections.Concurrent
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
open Microsoft.Extensions.Hosting
open Microsoft.Extensions.Logging
open Google.Protobuf
open Grpc.Core
open Termin.Al.Contracts.V1
open Termin.Al.Host

module Program =
    type private EmptyScope() =
        interface IDisposable with
            member _.Dispose() = ()

    type private CapturingLogger(messages: ConcurrentQueue<string>) =
        interface ILogger with
            member _.BeginScope<'TState>(_: 'TState) : IDisposable = new EmptyScope()
            member _.IsEnabled(_) = true

            member _.Log<'TState>
                (_: LogLevel, _: EventId, state: 'TState, error: exn, formatter: Func<'TState, exn, string>)
                =
                messages.Enqueue(formatter.Invoke(state, error))

                if not (isNull error) then
                    messages.Enqueue(error.ToString())

    type private CapturingLoggerProvider(messages: ConcurrentQueue<string>) =
        interface ILoggerProvider with
            member _.CreateLogger(_) =
                new CapturingLogger(messages) :> ILogger

            member _.Dispose() = ()

    type private GitHubHandler(now: unit -> DateTimeOffset, expiredAccess: bool) =
        inherit HttpMessageHandler()

        let mutable refreshAttempts = 0
        let accessToken = String('a', 48)
        let refreshToken = String('r', 48)

        member _.RefreshAttempts = refreshAttempts
        member _.SensitiveValues = [ accessToken; refreshToken ]

        override _.SendAsync(request, _) =
            let response =
                if request.RequestUri.AbsoluteUri = "https://github.com/login/oauth/access_token" then
                    let body = request.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                    if body.Contains("grant_type=refresh_token", StringComparison.Ordinal) then
                        refreshAttempts <- refreshAttempts + 1
                        new HttpResponseMessage(HttpStatusCode.Unauthorized)
                    else
                        let expiresIn = if expiredAccess then -60 else 3600

                        let json =
                            $"""{{"access_token":"{accessToken}","refresh_token":"{refreshToken}","expires_in":{expiresIn},"refresh_token_expires_in":7200}}"""

                        new HttpResponseMessage(
                            HttpStatusCode.OK,
                            Content = new StringContent(json, Encoding.UTF8, "application/json")
                        )
                elif request.RequestUri.AbsoluteUri = "https://api.github.com/user" then
                    new HttpResponseMessage(
                        HttpStatusCode.OK,
                        Content =
                            new StringContent("{\"id\":17,\"login\":\"owner\"}", Encoding.UTF8, "application/json")
                    )
                else
                    new HttpResponseMessage(HttpStatusCode.NotFound)

            Task.FromResult(response)

    let private withRunningHost (application: WebApplication) (action: HttpClient -> unit) =
        application.Urls.Add("http://127.0.0.1:0")

        try
            application.StartAsync().GetAwaiter().GetResult()

            let server = application.Services.GetRequiredService<IServer>()
            let addresses = server.Features.Get<IServerAddressesFeature>()

            if isNull addresses then
                failwith "The test host did not publish a server address."

            let address = addresses.Addresses |> Seq.exactlyOne
            use handler = new HttpClientHandler(AllowAutoRedirect = false, UseCookies = true)
            use client = new HttpClient(handler)
            client.BaseAddress <- Uri(address)
            action client
        finally
            application.StopAsync().GetAwaiter().GetResult()
            application.DisposeAsync().AsTask().GetAwaiter().GetResult()

    let private grpcWebUnary
        (client: HttpClient)
        (path: string)
        (headers: (string * string) list)
        (parser: MessageParser<'response>)
        =
        use request = new HttpRequestMessage(HttpMethod.Post, path)
        request.Headers.Add("X-Grpc-Web", "1")

        for name, value in headers do
            request.Headers.Add(name, value)

        request.Content <- new ByteArrayContent([| 0uy; 0uy; 0uy; 0uy; 0uy |])

        request.Content.Headers.ContentType <-
            System.Net.Http.Headers.MediaTypeHeaderValue("application/grpc-web+proto")

        use response = client.Send(request)

        if response.StatusCode <> HttpStatusCode.OK then
            failwithf "Expected gRPC-Web HTTP status 200, but received %O." response.StatusCode

        let bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()

        if bytes.Length < 5 || bytes[0] <> 0uy then
            failwith "Expected a binary gRPC-Web unary data frame."

        let length =
            (int bytes[1] <<< 24)
            ||| (int bytes[2] <<< 16)
            ||| (int bytes[3] <<< 8)
            ||| int bytes[4]

        if length < 0 || bytes.Length < length + 5 then
            failwith "The binary gRPC-Web unary data frame length is invalid."

        let payload = bytes[5 .. 4 + length]

        parser.ParseFrom(payload),
        response.Headers
        |> Seq.map (fun pair -> pair.Key, Seq.toList pair.Value)
        |> Map.ofSeq

    let private grpcWebUnaryMessage
        (client: HttpClient)
        (path: string)
        (headers: (string * string) list)
        (message: IMessage)
        (parser: MessageParser<'response>)
        =
        let payload = message.ToByteArray()
        let frame = Array.zeroCreate<byte> (payload.Length + 5)
        frame[1] <- byte (payload.Length >>> 24)
        frame[2] <- byte (payload.Length >>> 16)
        frame[3] <- byte (payload.Length >>> 8)
        frame[4] <- byte payload.Length
        Array.Copy(payload, 0, frame, 5, payload.Length)
        use request = new HttpRequestMessage(HttpMethod.Post, path)
        request.Headers.Add("X-Grpc-Web", "1")

        for name, value in headers do
            request.Headers.Add(name, value)

        request.Content <- new ByteArrayContent(frame)

        request.Content.Headers.ContentType <-
            System.Net.Http.Headers.MediaTypeHeaderValue("application/grpc-web+proto")

        use response = client.Send(request)
        let bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()

        if bytes.Length < 5 || bytes[0] <> 0uy then
            failwith "Expected a binary gRPC-Web unary data frame."

        let length =
            (int bytes[1] <<< 24)
            ||| (int bytes[2] <<< 16)
            ||| (int bytes[3] <<< 8)
            ||| int bytes[4]

        parser.ParseFrom(bytes[5 .. 4 + length])

    let private grpcWebFailureStatus
        (client: HttpClient)
        (path: string)
        (headers: (string * string) list)
        (message: IMessage)
        =
        let payload = message.ToByteArray()
        let frame = Array.zeroCreate<byte> (payload.Length + 5)
        frame[1] <- byte (payload.Length >>> 24)
        frame[2] <- byte (payload.Length >>> 16)
        frame[3] <- byte (payload.Length >>> 8)
        frame[4] <- byte payload.Length
        Array.Copy(payload, 0, frame, 5, payload.Length)
        use request = new HttpRequestMessage(HttpMethod.Post, path)
        request.Headers.Add("X-Grpc-Web", "1")

        for name, value in headers do
            request.Headers.Add(name, value)

        request.Content <- new ByteArrayContent(frame)

        request.Content.Headers.ContentType <-
            System.Net.Http.Headers.MediaTypeHeaderValue("application/grpc-web+proto")

        use response = client.Send(request)

        let headerStatus =
            [ response.Headers :> seq<_>
              response.TrailingHeaders :> seq<_>
              response.Content.Headers :> seq<_> ]
            |> Seq.concat
            |> Seq.tryPick (fun header ->
                if String.Equals(header.Key, "grpc-status", StringComparison.OrdinalIgnoreCase) then
                    header.Value |> Seq.tryHead |> Option.map Int32.Parse
                else
                    None)

        let bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        let text = Encoding.ASCII.GetString(bytes)

        let matched =
            Text.RegularExpressions.Regex.Match(
                text,
                "grpc-status:\\s*(?<status>[0-9]+)",
                Text.RegularExpressions.RegexOptions.IgnoreCase
            )

        match headerStatus with
        | Some status -> status
        | None when matched.Success -> Int32.Parse(matched.Groups["status"].Value)
        | None -> failwithf "Expected a failed gRPC-Web trailer status in %A." bytes

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

    let private requireValid (result: ContentDomain.ValidationResult<'value>) : 'value =
        match result with
        | Ok value -> value
        | Error failure -> failwithf "%s: %s" failure.Field failure.Message

    let private timestamp value =
        ContentDomain.Timestamp.tryCreate "test.timestamp" value |> requireValid

    let private catalogWithCacheState cacheState =

        let source =
            ContentDomain.ContentSource.create
                (ContentDomain.RepositoryName.tryCreate "test.repository" "example-owner/content"
                 |> requireValid)
                (ContentDomain.RepositoryPath.tryCreate "test.path" "content/catalog.json"
                 |> requireValid)
                (ContentDomain.ContentRevision.tryCreate "test.revision" "main" |> requireValid)
                (ContentDomain.ContentUrl.tryCreate
                    "test.url"
                    "https://github.com/example-owner/content/blob/main/content/catalog.json?left=1&right=2"
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
              )
              ContentDomain.File(
                  ContentDomain.CatalogId.tryCreate "test.id" "about-file" |> requireValid,
                  ContentDomain.VirtualPath.tryCreate "test.path" "~/about.md" |> requireValid,
                  timestamp "2026-07-15T00:01:00.000Z",
                  ContentDomain.ByteSize.tryCreate "test.size" 128 |> requireValid,
                  ContentDomain.ContentId.tryCreate "test.handle" "about" |> requireValid
              )
              ContentDomain.LockedFile(
                  ContentDomain.CatalogId.tryCreate "test.id" "locked-file" |> requireValid,
                  ContentDomain.VirtualPath.tryCreate "test.path" "~/locked.md" |> requireValid,
                  timestamp "2026-07-15T00:02:00.000Z",
                  ContentDomain.ByteSize.tryCreate "test.size" 256 |> requireValid
              ) ]
        |> requireValid

    let private contentClientWithCacheState cacheState : ContentClient =
        let catalog = catalogWithCacheState cacheState

        { new ContentClient with
            member _.GetRepositoryBase _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

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

    let private changelogContentClient () : ContentClient =
        let catalog = catalogWithCacheState ContentDomain.Fresh
        let publishedAt = timestamp "2026-07-14T09:30:00.000Z"

        let release =
            ContentDomain.Release.tryCreate
                (ContentDomain.ContentTag.tryCreate "test.tag" "v1.0.0" |> requireValid)
                (ContentDomain.ContentTitle.tryCreate "test.name" "Version 1.0.0" |> requireValid)
                publishedAt
                "Release body"
                (ContentDomain.ContentUrl.tryCreate "test.url" "https://github.com/example/repository/releases/v1.0.0"
                 |> requireValid)
                []
            |> requireValid

        let changelog =
            ContentDomain.Changelog.tryCreate
                (ContentDomain.Catalog.source catalog)
                (ContentDomain.Catalog.cache catalog)
                []
                [ release ]
            |> requireValid

        { new ContentClient with
            member _.GetRepositoryBase _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetCatalog _ = Task.FromResult(Ok catalog)

            member _.GetDocument(_, _) =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetProjects _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetNow _ =
                Task.FromResult(Error(ContentDomain.Problem.create ContentDomain.NotFound "Missing."))

            member _.GetChangelog _ = Task.FromResult(Ok changelog) }

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

                for path in
                    [ "/api/session"
                      "/api/content/catalog"
                      "/api/content/document/about"
                      "/api/content/projects"
                      "/api/content/now"
                      "/api/content/changelog"
                      "/api/stats"
                      "/api/stats/view"
                      "/api/stats/events"
                      "/api/auth/logout"
                      "/api/auth/cv"
                      "/api/cv" ] do
                    use removed = client.GetAsync(path).GetAwaiter().GetResult()

                    if removed.StatusCode <> HttpStatusCode.NotFound then
                        failwithf "Superseded application route %s must be absent." path)

    let private runAuthenticationContractChecks () =
        let now () =
            DateTimeOffset.Parse("2026-07-22T12:00:00Z")

        let statsStore = Stats.unavailableStore now

        HostApplication.createWithContentClientAndStats
            [||]
            (freshContentClient ())
            statsStore
            true
            (fun length -> Array.zeroCreate<byte> length)
            now
        |> fun application ->
            withRunningHost application (fun client ->
                let session, sessionHeaders =
                    grpcWebUnary client "/terminal.v1.SessionApi/ReadSession" [] SessionResponse.Parser

                let cacheControl = sessionHeaders["Cache-Control"] |> List.exactlyOne

                if not (cacheControl.Contains("no-store", StringComparison.Ordinal)) then
                    failwith "Session responses must not be cached."

                if session.Kind <> SessionKind.Anonymous then
                    failwith "A fresh browser must receive the anonymous capability session."

                let csrfToken = session.CsrfToken

                if csrfToken.Length < 16 then
                    failwith "The anonymous session response must issue an antiforgery request token."

                let antiforgeryCookie =
                    sessionHeaders["Set-Cookie"]
                    |> Seq.find (fun value -> value.StartsWith("termin.al.antiforgery=", StringComparison.Ordinal))

                for attribute in [ "path=/"; "samesite=strict"; "httponly" ] do
                    if not (antiforgeryCookie.Contains(attribute, StringComparison.OrdinalIgnoreCase)) then
                        failwithf "Antiforgery cookie is missing %s." attribute

                if antiforgeryCookie.Contains("secure", StringComparison.OrdinalIgnoreCase) then
                    failwith "The explicit local HTTP test exception must omit Secure."

                use unavailableAuth =
                    client.GetAsync("/api/auth/github/start").GetAwaiter().GetResult()

                if unavailableAuth.StatusCode <> HttpStatusCode.ServiceUnavailable then
                    failwith "Missing GitHub configuration must fail auth closed."

                let unavailableBody =
                    unavailableAuth.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                if not (unavailableBody.Contains("Authentication failed.", StringComparison.Ordinal)) then
                    failwith "Auth configuration failures must remain generic."

                let rejectedLogout =
                    grpcWebFailureStatus
                        client
                        "/terminal.v1.SessionApi/Logout"
                        [ Auth.AntiforgeryHeaderName, csrfToken ]
                        (EmptyRequest())

                if rejectedLogout <> int StatusCode.InvalidArgument then
                    failwith "Logout without the exact configured Origin must be rejected."

                let unavailableCv =
                    grpcWebFailureStatus client "/terminal.v1.CvApi/Read" [] (EmptyRequest())

                if unavailableCv <> int StatusCode.Unavailable then
                    failwith "Missing CV hash configuration must fail CV delivery closed.")

    let private runCvCryptographyChecks () =
        let generated = Cv.generateViewerKey ()

        if generated.Plaintext.Length <> 43 then
            failwith "The generated CV viewer key must contain 256 bits encoded as base64url."

        if not (generated.CanonicalHash.StartsWith("pbkdf2-sha256$v=1$i=600000$", StringComparison.Ordinal)) then
            failwith "The generated CV hash must use the approved canonical algorithm version."

        if not (Cv.verifyViewerKey generated.CanonicalHash generated.Plaintext) then
            failwith "The generated CV hash must verify its generated viewer key."

        let wrongKey = String('z', generated.Plaintext.Length)

        if Cv.verifyViewerKey generated.CanonicalHash wrongKey then
            failwith "A different CV viewer key must not verify."

        if Cv.verifyViewerKey "invalid" wrongKey then
            failwith "An invalid configured CV hash must fail closed."

    let private authenticationApplication viewerHash cvKeyRingReady expiredAccess now cvPath =
        let arguments =
            [ "--GitHub:App:ClientId=" + String('c', 24)
              "--GitHub:App:ClientSecret=" + String('s', 32)
              "--GitHub:App:CallbackUrl=http://127.0.0.1/api/auth/github/callback"
              "--GitHub:OwnerId=17"
              "--Application:PublicOrigin=http://127.0.0.1" ]
            |> fun configured ->
                match viewerHash with
                | Some value -> ("--Cv:ViewerKeyHash=" + value) :: configured
                | None -> configured
            |> List.toArray

        let builder = WebApplication.CreateBuilder(WebApplicationOptions(Args = arguments))
        let capturedLogs = ConcurrentQueue<string>()
        builder.Logging.AddProvider(new CapturingLoggerProvider(capturedLogs)) |> ignore
        let githubHandler = new GitHubHandler(now, expiredAccess)
        let githubClient = new HttpClient(githubHandler, true)
        let statsStore = Stats.unavailableStore now
        let contentClient = freshContentClient ()

        builder.Services.AddGrpc() |> ignore
        builder.Services.AddSingleton<ContentClient>(contentClient) |> ignore
        builder.Services.AddSingleton<GitHubPublication.Client>(GitHubPublication.unavailable) |> ignore

        let statsRuntime: Stats.BrowserRuntime =
            { Store = statsStore
              ContentClient = contentClient
              AllowLocalHttpCookie = true
              RandomBytes = Stats.randomBytes
              Now = now }

        builder.Services.AddSingleton<Stats.BrowserRuntime>(statsRuntime) |> ignore
        Auth.configureServices builder.Services builder.Configuration true githubClient now Auth.randomBytes

        Cv.configureServices
            builder.Services
            builder.Configuration
            false
            now
            Auth.randomBytes
            (fun () -> cvKeyRingReady)
            cvPath

        let application = builder.Build()

        application.Lifetime.ApplicationStopping.Register(Action(githubClient.Dispose))
        |> ignore

        application.Lifetime.ApplicationStopping.Register(Action(statsStore.Shutdown))
        |> ignore

        application.UseGrpcWeb() |> ignore
        Auth.mapOAuthEndpoints application
        application.MapGrpcService<SessionGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<CvGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<StatisticsGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<PublicationGrpcService>().EnableGrpcWeb() |> ignore
        application, githubHandler, capturedLogs

    let private runMutationBoundaryChecks () =
        let now () =
            DateTimeOffset.Parse("2026-07-22T12:00:00Z")

        let viewer = Cv.generateViewerKey ()

        authenticationApplication (Some viewer.CanonicalHash) true false now Cv.SecretFilePath
        |> fun (application, _, capturedLogs) ->
            withRunningHost application (fun client ->
                let session, _ =
                    grpcWebUnary client "/terminal.v1.SessionApi/ReadSession" [] SessionResponse.Parser

                let mutations: (string * IMessage * int) list =
                    [ "/terminal.v1.SessionApi/Logout", EmptyRequest(), int StatusCode.InvalidArgument
                      "/terminal.v1.CvApi/Unlock",
                      UnlockCvRequest(Key = String('x', 32)),
                      int StatusCode.PermissionDenied
                      "/terminal.v1.CvApi/Lock", EmptyRequest(), int StatusCode.PermissionDenied
                      "/terminal.v1.StatisticsApi/RecordView",
                      RecordViewRequest(ContentId = "about"),
                      int StatusCode.InvalidArgument
                      "/terminal.v1.PublicationApi/Publish",
                      PublicationRequest(Operation = PublicationOperation.Add),
                      int StatusCode.PermissionDenied ]

                let rejectedHeaders =
                    [ [ Auth.AntiforgeryHeaderName, session.CsrfToken ]
                      [ "Origin", "https://wrong.example"
                        Auth.AntiforgeryHeaderName, session.CsrfToken ]
                      [ "Origin", "http://127.0.0.1" ]
                      [ "Origin", "http://127.0.0.1"; Auth.AntiforgeryHeaderName, String('w', 32) ] ]

                for path, request, expectedStatus in mutations do
                    for headers in rejectedHeaders do
                        let status = grpcWebFailureStatus client path headers request

                        if status <> expectedStatus then
                            failwithf "Mutation boundary %s accepted invalid Origin or antiforgery metadata." path)

            let retained = String.Join("\n", capturedLogs)

            if retained.Contains(String('w', 32), StringComparison.Ordinal) then
                failwith "Rejected antiforgery metadata must not be logged."

    let private establishOwnerSession (client: HttpClient) =
        use start = client.GetAsync("/api/auth/github/start").GetAwaiter().GetResult()

        if start.StatusCode <> HttpStatusCode.Redirect then
            failwithf "Expected GitHub authentication start redirect, but received %O." start.StatusCode

        let state =
            start.Headers.Location.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            |> Seq.map (fun pair -> pair.Split('=', 2))
            |> Seq.find (fun pair -> pair[0] = "state")
            |> fun pair -> Uri.UnescapeDataString(pair[1])

        let callbackCode = String('o', 37)

        use callback =
            client.GetAsync(
                $"/api/auth/github/callback?code={Uri.EscapeDataString(callbackCode)}&state={Uri.EscapeDataString(state)}"
            )
            |> fun pending -> pending.GetAwaiter().GetResult()

        if callback.StatusCode <> HttpStatusCode.OK then
            failwithf "Expected owner callback success, but received %O." callback.StatusCode

        [ callbackCode; state ]

    let private runOwnerCvFailClosedChecks () =
        let now () =
            DateTimeOffset.Parse("2026-07-22T12:00:00Z")

        let viewerHash = (Cv.generateViewerKey ()).CanonicalHash

        authenticationApplication None true false now Cv.SecretFilePath
        |> fun (application, _, _) ->
            withRunningHost application (fun client ->
                establishOwnerSession client |> ignore

                let status =
                    grpcWebFailureStatus client "/terminal.v1.CvApi/Read" [] (EmptyRequest())

                if status <> int StatusCode.Unavailable then
                    failwith "Unavailable CV storage must fail closed.")

        authenticationApplication (Some viewerHash) false false now Cv.SecretFilePath
        |> fun (application, _, _) ->
            withRunningHost application (fun client ->
                establishOwnerSession client |> ignore

                let status =
                    grpcWebFailureStatus client "/terminal.v1.CvApi/Read" [] (EmptyRequest())

                if status <> int StatusCode.Unavailable then
                    failwith "Unavailable CV storage must fail closed.")

        let application, githubHandler, _ =
            authenticationApplication (Some viewerHash) true true now Cv.SecretFilePath

        withRunningHost application (fun client ->
            establishOwnerSession client |> ignore

            let status =
                grpcWebFailureStatus client "/terminal.v1.CvApi/Read" [] (EmptyRequest())

            if status <> int StatusCode.PermissionDenied then
                failwith "Demoted owners must lose CV access."

            if githubHandler.RefreshAttempts <> 1 then
                failwith "Expired owner CV access must attempt one token refresh."

            let session, _ =
                grpcWebUnary client "/terminal.v1.SessionApi/ReadSession" [] SessionResponse.Parser

            if session.Kind <> SessionKind.GithubViewer then
                failwith "Failed owner refresh must atomically demote the browser to GitHub viewer.")

    let private runSensitiveLoggingChecks () =
        let now () =
            DateTimeOffset.Parse("2026-07-22T12:00:00Z")

        let viewerKey = Cv.generateViewerKey ()
        let cvBytes = "# " + String('v', 41)
        let cvPath = Path.GetTempFileName()

        try
            File.WriteAllText(cvPath, cvBytes, UTF8Encoding(false))

            let application, githubHandler, capturedLogs =
                authenticationApplication (Some viewerKey.CanonicalHash) true false now cvPath

            let mutable callbackValues = []

            withRunningHost application (fun client ->
                callbackValues <- establishOwnerSession client

                let session, _ =
                    grpcWebUnary client "/terminal.v1.SessionApi/ReadSession" [] SessionResponse.Parser

                let csrfToken = session.CsrfToken

                grpcWebUnaryMessage
                    client
                    "/terminal.v1.CvApi/Unlock"
                    [ "Origin", "http://127.0.0.1"; Auth.AntiforgeryHeaderName, csrfToken ]
                    (UnlockCvRequest(Key = viewerKey.Plaintext))
                    EmptyRequest.Parser
                |> ignore

                let cv =
                    grpcWebUnary client "/terminal.v1.CvApi/Read" [] CvDocumentResponse.Parser
                    |> fst

                if cv.Markdown <> cvBytes then
                    failwith "Expected logging contract CV bytes to reach the authorized caller.")

            let retained = String.Join("\n", capturedLogs)

            if
                callbackValues
                @ githubHandler.SensitiveValues
                @ [ viewerKey.Plaintext; cvBytes ]
                |> List.exists (fun sensitive -> retained.Contains(sensitive, StringComparison.Ordinal))
            then
                failwith "Host diagnostics retained a protected authentication or CV value."

            if not (retained.Contains("gRPC - /terminal.v1.SessionApi/ReadSession", StringComparison.Ordinal)) then
                failwith "The logging boundary must preserve safe endpoint diagnostics."
        finally
            File.Delete(cvPath)

    let private runFreshCacheEndpointCheck () =
        HostApplication.createWithContentClient [||] (freshContentClient ())
        |> fun application ->
            withRunningHost application (fun client ->
                let response, headers =
                    grpcWebUnary
                        client
                        "/terminal.v1.ContentApi/ReadCatalog"
                        [ Auth.AntiforgeryHeaderName, "generated-antiforgery-metadata" ]
                        CatalogResponse.Parser

                let cacheControl = headers["Cache-Control"] |> List.exactlyOne

                if cacheControl <> "public, max-age=300" then
                    failwithf "Expected fresh content Cache-Control public, max-age=300, but received %s." cacheControl

                let entries = response.Entries
                let directory = entries[0]
                let file = entries[1]
                let lockedFile = entries[2]

                if
                    entries.Count <> 3
                    || directory.Kind <> CatalogEntryKind.Directory
                    || directory.Size <> 0
                    || directory.DocumentHandle <> ""
                    || file.Kind <> CatalogEntryKind.File
                    || file.DocumentHandle <> "about"
                    || lockedFile.Kind <> CatalogEntryKind.LockedFile
                    || lockedFile.DocumentHandle <> ""
                    || response.Source.Url
                       <> "https://github.com/example-owner/content/blob/main/content/catalog.json?left=1&right=2"
                    || response.Cache.FreshUntil <> "2026-07-15T00:05:00.000Z"
                then
                    failwithf "Fresh catalog response shape changed: %O." response)

    let private runStaleCacheEndpointCheck () =
        HostApplication.createWithContentClient [||] (staleContentClient ())
        |> fun application ->
            withRunningHost application (fun client ->
                let response, headers =
                    grpcWebUnary client "/terminal.v1.ContentApi/ReadCatalog" [] CatalogResponse.Parser

                let cacheControl = headers["Cache-Control"] |> List.exactlyOne

                if
                    not (cacheControl.Contains("public", StringComparison.Ordinal))
                    || not (cacheControl.Contains("max-age=0", StringComparison.Ordinal))
                    || not (cacheControl.Contains("must-revalidate", StringComparison.Ordinal))
                then
                    failwith "Stale content must be marked must-revalidate."

                if not (headers.ContainsKey("Warning")) then
                    failwith "Stale content must be marked with a warning header."

                if response.Cache.State <> CacheState.Stale then
                    failwith "Stale content responses must serialize their stale cache state.")

    let private runChangelogReleaseWireCheck () =
        HostApplication.createWithContentClient [||] (changelogContentClient ())
        |> fun application ->
            withRunningHost application (fun client ->
                let response, _ =
                    grpcWebUnary client "/terminal.v1.ContentApi/ReadChangelog" [] ChangelogResponse.Parser

                let release = response.Releases |> Seq.exactlyOne

                if release.Tag <> "v1.0.0" || release.PublishedAt <> "2026-07-14T09:30:00.000Z" then
                    failwithf "Changelog release chronology changed across the generated wire contract: %O." release)

    [<EntryPoint>]
    let main _ =
        try
            PublicationMediaTests.run ()
            GitHubContentClientTests.run ()
            GitHubPublicationTests.run ()
            StatsTests.run ()
            runHostContractChecks ()
            runAuthenticationContractChecks ()
            runCvCryptographyChecks ()
            runMutationBoundaryChecks ()
            runOwnerCvFailClosedChecks ()
            runSensitiveLoggingChecks ()
            runFreshCacheEndpointCheck ()
            runStaleCacheEndpointCheck ()
            runChangelogReleaseWireCheck ()
            0
        with error ->
            eprintfn "Host health check failed: %s" error.Message
            1
