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

                use removedCatalogEndpoint =
                    client.GetAsync("/api/content/catalog").GetAwaiter().GetResult()

                assertProblem removedCatalogEndpoint HttpStatusCode.NotFound "not-found"

                use removedSessionEndpoint =
                    client.GetAsync("/api/session").GetAwaiter().GetResult()

                assertProblem removedSessionEndpoint HttpStatusCode.NotFound "not-found"

                use invalidDocument =
                    client.GetAsync("/api/content/document/%21invalid").GetAwaiter().GetResult()

                assertProblem invalidDocument HttpStatusCode.BadRequest "invalid-request"

                use unknownApiRoute = client.GetAsync("/api/not-here").GetAwaiter().GetResult()
                assertProblem unknownApiRoute HttpStatusCode.NotFound "not-found")

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
            (TimeSpan.FromSeconds(30.0))
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

                use logout = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout")
                logout.Headers.Add(Auth.AntiforgeryHeaderName, csrfToken)
                use rejectedLogout = client.Send(logout)

                if rejectedLogout.StatusCode <> HttpStatusCode.BadRequest then
                    failwith "Logout without the exact configured Origin must be rejected."

                use unavailableCv = client.GetAsync("/api/cv").GetAwaiter().GetResult()

                if unavailableCv.StatusCode <> HttpStatusCode.ServiceUnavailable then
                    failwith "Missing CV hash configuration must fail CV delivery closed."

                if not unavailableCv.Headers.CacheControl.NoStore then
                    failwith "CV responses must not be cached."

                let unavailableCvBody =
                    unavailableCv.Content.ReadAsStringAsync().GetAwaiter().GetResult()

                if not (unavailableCvBody.Contains("CV access failed.", StringComparison.Ordinal)) then
                    failwith "CV configuration failures must remain generic.")

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

        builder.Services.AddGrpc() |> ignore
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

        application.UseGrpcWeb() |> ignore
        Auth.mapEndpoints application
        Cv.mapEndpoints application
        application.MapGrpcService<SessionGrpcService>().EnableGrpcWeb() |> ignore
        application, githubHandler, capturedLogs

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

    let private assertGenericCvFailure (response: HttpResponseMessage) expectedStatus =
        if response.StatusCode <> expectedStatus then
            failwithf "Expected CV response %O, but received %O." expectedStatus response.StatusCode

        if
            isNull response.Headers.CacheControl
            || not response.Headers.CacheControl.NoStore
        then
            failwith "Denied CV responses must not be cached."

        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if not (body.Contains("CV access failed.", StringComparison.Ordinal)) then
            failwith "Denied CV responses must remain generic."

        if body.Contains("private CV", StringComparison.OrdinalIgnoreCase) then
            failwith "Denied CV responses must not contain CV bytes."

    let private runOwnerCvFailClosedChecks () =
        let now () =
            DateTimeOffset.Parse("2026-07-22T12:00:00Z")

        let viewerHash = (Cv.generateViewerKey ()).CanonicalHash

        authenticationApplication None true false now Cv.SecretFilePath
        |> fun (application, _, _) ->
            withRunningHost application (fun client ->
                establishOwnerSession client |> ignore
                use response = client.GetAsync("/api/cv").GetAwaiter().GetResult()
                assertGenericCvFailure response HttpStatusCode.ServiceUnavailable)

        authenticationApplication (Some viewerHash) false false now Cv.SecretFilePath
        |> fun (application, _, _) ->
            withRunningHost application (fun client ->
                establishOwnerSession client |> ignore
                use response = client.GetAsync("/api/cv").GetAwaiter().GetResult()
                assertGenericCvFailure response HttpStatusCode.ServiceUnavailable)

        let application, githubHandler, _ =
            authenticationApplication (Some viewerHash) true true now Cv.SecretFilePath

        withRunningHost application (fun client ->
            establishOwnerSession client |> ignore
            use response = client.GetAsync("/api/cv").GetAwaiter().GetResult()
            assertGenericCvFailure response HttpStatusCode.Forbidden

            if githubHandler.RefreshAttempts <> 1 then
                failwith "Expired owner CV access must attempt one token refresh."

            let replacementCookie =
                response.Headers.GetValues("Set-Cookie")
                |> Seq.tryFind (fun value -> value.StartsWith(Auth.SessionCookieName + "=", StringComparison.Ordinal))

            if replacementCookie.IsNone then
                failwith "Failed owner refresh must emit the demoted replacement session."

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
            File.WriteAllText(cvPath, cvBytes, Encoding.UTF8)

            let application, githubHandler, capturedLogs =
                authenticationApplication (Some viewerKey.CanonicalHash) true false now cvPath

            let mutable callbackValues = []

            withRunningHost application (fun client ->
                callbackValues <- establishOwnerSession client

                let session, _ =
                    grpcWebUnary client "/terminal.v1.SessionApi/ReadSession" [] SessionResponse.Parser

                let csrfToken = session.CsrfToken
                use unlock = new HttpRequestMessage(HttpMethod.Post, "/api/auth/cv")
                unlock.Headers.Add("Origin", "http://127.0.0.1")
                unlock.Headers.Add(Auth.AntiforgeryHeaderName, csrfToken)

                unlock.Content <-
                    new StringContent(
                        JsonSerializer.Serialize({| key = viewerKey.Plaintext |}),
                        Encoding.UTF8,
                        "application/json"
                    )

                use unlocked = client.Send(unlock)

                if unlocked.StatusCode <> HttpStatusCode.NoContent then
                    failwith "Expected logging contract CV unlock to succeed."

                use cv = client.GetAsync("/api/cv").GetAwaiter().GetResult()

                if cv.StatusCode <> HttpStatusCode.OK then
                    failwith "Expected logging contract CV read to succeed."

                if cv.Content.ReadAsStringAsync().GetAwaiter().GetResult() <> cvBytes then
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

    [<EntryPoint>]
    let main _ =
        try
            GitHubContentClientTests.run ()
            StatsTests.run ()
            runHostContractChecks ()
            runAuthenticationContractChecks ()
            runCvCryptographyChecks ()
            runOwnerCvFailClosedChecks ()
            runSensitiveLoggingChecks ()
            runFreshCacheEndpointCheck ()
            runStaleCacheEndpointCheck ()
            0
        with error ->
            eprintfn "Host health check failed: %s" error.Message
            1
