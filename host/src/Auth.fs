namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.Collections.Generic
open System.IO
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Security.Cryptography
open System.Text
open System.Text.Encodings.Web
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.AspNetCore.Antiforgery
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.DataProtection
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Logging

[<RequireQualifiedAccess>]
module Auth =
    [<Literal>]
    let SessionCookieName = "termin.al.session"

    [<Literal>]
    let AntiforgeryHeaderName = "X-CSRF-TOKEN"

    [<Literal>]
    let private correlationCookieName = "termin.al.github-correlation"

    [<Literal>]
    let private ticketPurpose = "termin.al.session.v1"

    [<Literal>]
    let private correlationPurpose = "termin.al.github-correlation.v1"

    [<Literal>]
    let private keyRingPath = "/var/lib/termin.al/data-protection-keys"

    type ViewerIdentity = private { Id: uint64; Login: string }

    type OwnerTokens =
        private
            { AccessToken: string
              RefreshToken: string
              AccessExpiresAt: DateTimeOffset
              RefreshExpiresAt: DateTimeOffset }

    type Session =
        | Anonymous
        | GitHubViewer of ViewerIdentity
        | CvViewer of fingerprint: string
        | GitHubCvViewer of ViewerIdentity * fingerprint: string
        | Owner of ViewerIdentity * OwnerTokens

    type SessionView =
        | AnonymousView
        | GitHubViewerView of login: string
        | CvViewerView
        | GitHubCvViewerView of login: string
        | OwnerView of login: string

    type GitHubToken =
        { AccessToken: string
          RefreshToken: string
          AccessExpiresAt: DateTimeOffset
          RefreshExpiresAt: DateTimeOffset }

    type GitHubIdentity = { Id: uint64; Login: string }

    type GitHubAuthenticationClient =
        abstract member ExchangeCode: code: string * CancellationToken -> Task<Result<GitHubToken, unit>>
        abstract member Refresh: refreshToken: string * CancellationToken -> Task<Result<GitHubToken, unit>>
        abstract member GetIdentity: accessToken: string * CancellationToken -> Task<Result<GitHubIdentity, unit>>

    type private GitHubConfiguration =
        { ClientId: string
          ClientSecret: string
          CallbackUrl: Uri
          OwnerId: uint64
          PublicOrigin: Uri }

    type private Runtime =
        { Configuration: GitHubConfiguration option
          KeyRingReady: bool
          AllowLocalHttpCookie: bool
          GitHubClient: GitHubAuthenticationClient
          Now: unit -> DateTimeOffset
          RandomBytes: int -> byte array
          Correlations: ConcurrentDictionary<string, DateTimeOffset>
          RefreshGate: SemaphoreSlim
          RefreshResults: ConcurrentDictionary<string, DateTimeOffset * OwnerTokens option> }

    type private Correlation =
        { State: string
          ExpiresAt: DateTimeOffset }

    let private base64UrlEncode (bytes: byte array) =
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

    let private tokenFingerprint (value: string) =
        value |> Encoding.UTF8.GetBytes |> SHA256.HashData |> base64UrlEncode

    let private tryBase64UrlDecode (value: string) =
        try
            let padded =
                match value.Length % 4 with
                | 0 -> value
                | 2 -> value + "=="
                | 3 -> value + "="
                | _ -> ""

            if padded.Length = 0 then
                None
            else
                Some(Convert.FromBase64String(padded.Replace('-', '+').Replace('_', '/')))
        with :? FormatException ->
            None

    let private validLogin (value: string) =
        not (String.IsNullOrWhiteSpace(value)) && value.Length <= 39

    let private identity (source: GitHubIdentity) : ViewerIdentity option =
        if validLogin source.Login then
            Some({ Id = source.Id; Login = source.Login }: ViewerIdentity)
        else
            None

    let private ownerTokens (source: GitHubToken) : OwnerTokens option =
        if
            String.IsNullOrWhiteSpace(source.AccessToken)
            || String.IsNullOrWhiteSpace(source.RefreshToken)
            || source.AccessExpiresAt >= source.RefreshExpiresAt
        then
            None
        else
            let value: OwnerTokens =
                { AccessToken = source.AccessToken
                  RefreshToken = source.RefreshToken
                  AccessExpiresAt = source.AccessExpiresAt
                  RefreshExpiresAt = source.RefreshExpiresAt }

            Some value

    let private writeString (writer: BinaryWriter) (value: string) =
        let bytes = Encoding.UTF8.GetBytes(value)
        writer.Write(bytes.Length)
        writer.Write(bytes)

    let private readString (reader: BinaryReader) maximumLength =
        let length = reader.ReadInt32()

        if length < 0 || length > maximumLength then
            raise (InvalidDataException("Protected ticket field length is invalid."))

        let bytes = reader.ReadBytes(length)

        if bytes.Length <> length then
            raise (EndOfStreamException())

        Encoding.UTF8.GetString(bytes)

    let private serializeSession (session: Session) =
        use stream = new MemoryStream()
        use writer = new BinaryWriter(stream, Encoding.UTF8, true)
        writer.Write(1uy)

        let writeIdentity (viewer: ViewerIdentity) =
            writer.Write(viewer.Id)
            writeString writer viewer.Login

        match session with
        | Anonymous -> writer.Write(0uy)
        | GitHubViewer viewer ->
            writer.Write(1uy)
            writeIdentity viewer
        | CvViewer fingerprint ->
            writer.Write(2uy)
            writeString writer fingerprint
        | GitHubCvViewer(viewer, fingerprint) ->
            writer.Write(3uy)
            writeIdentity viewer
            writeString writer fingerprint
        | Owner(viewer, tokens) ->
            writer.Write(4uy)
            writeIdentity viewer
            writeString writer tokens.AccessToken
            writeString writer tokens.RefreshToken
            writer.Write(tokens.AccessExpiresAt.ToUnixTimeSeconds())
            writer.Write(tokens.RefreshExpiresAt.ToUnixTimeSeconds())

        writer.Flush()
        stream.ToArray()

    let private tryDeserializeSession (bytes: byte array) =
        try
            use stream = new MemoryStream(bytes, false)
            use reader = new BinaryReader(stream, Encoding.UTF8, true)

            if reader.ReadByte() <> 1uy then
                None
            else
                let readIdentity () : ViewerIdentity =
                    let value: ViewerIdentity =
                        { Id = reader.ReadUInt64()
                          Login = readString reader 39 }

                    if validLogin value.Login then
                        value
                    else
                        raise (InvalidDataException("Protected identity is invalid."))

                let session =
                    match reader.ReadByte() with
                    | 0uy -> Anonymous
                    | 1uy -> GitHubViewer(readIdentity ())
                    | 2uy -> CvViewer(readString reader 128)
                    | 3uy -> GitHubCvViewer(readIdentity (), readString reader 128)
                    | 4uy ->
                        let viewer = readIdentity ()
                        let accessToken = readString reader 4096
                        let refreshToken = readString reader 4096
                        let accessExpiresAt = DateTimeOffset.FromUnixTimeSeconds(reader.ReadInt64())
                        let refreshExpiresAt = DateTimeOffset.FromUnixTimeSeconds(reader.ReadInt64())

                        if accessExpiresAt >= refreshExpiresAt then
                            raise (InvalidDataException("Protected owner token lifetime is invalid."))

                        let tokens: OwnerTokens =
                            { AccessToken = accessToken
                              RefreshToken = refreshToken
                              AccessExpiresAt = accessExpiresAt
                              RefreshExpiresAt = refreshExpiresAt }

                        Owner(viewer, tokens)
                    | _ -> raise (InvalidDataException("Protected ticket capability is invalid."))

                if stream.Position <> stream.Length then
                    None
                else
                    Some session
        with
        | :? IOException
        | :? ArgumentException -> None

    let private protectSession (provider: IDataProtectionProvider) session =
        provider.CreateProtector(ticketPurpose).Protect(serializeSession session)
        |> base64UrlEncode

    let private tryUnprotectSession (provider: IDataProtectionProvider) (value: string) =
        try
            value
            |> tryBase64UrlDecode
            |> Option.map (provider.CreateProtector(ticketPurpose).Unprotect)
            |> Option.bind tryDeserializeSession
        with :? CryptographicException ->
            None

    let private cookieOptions allowLocalHttp =
        let options = CookieOptions()
        options.HttpOnly <- true
        options.IsEssential <- true
        options.Path <- "/"
        options.SameSite <- SameSiteMode.Lax
        options.Secure <- not allowLocalHttp
        options

    let private expireCookie (context: HttpContext) name allowLocalHttp =
        context.Response.Cookies.Delete(name, cookieOptions allowLocalHttp)

    let private readSession (context: HttpContext) =
        match context.Request.Cookies.TryGetValue(SessionCookieName) with
        | true, value ->
            let provider = context.RequestServices.GetRequiredService<IDataProtectionProvider>()
            tryUnprotectSession provider value |> Option.defaultValue Anonymous
        | false, _ -> Anonymous

    let private writeSession (context: HttpContext) session =
        let runtime = context.RequestServices.GetRequiredService<Runtime>()
        let provider = context.RequestServices.GetRequiredService<IDataProtectionProvider>()
        let value = protectSession provider session
        context.Response.Cookies.Append(SessionCookieName, value, cookieOptions runtime.AllowLocalHttpCookie)

    let private configurationValue (configuration: IConfiguration) name =
        match configuration[name] with
        | null -> None
        | value when String.IsNullOrWhiteSpace(value) -> None
        | value -> Some value

    let private tryConfiguration (configuration: IConfiguration) =
        match
            configurationValue configuration "GitHub:App:ClientId",
            configurationValue configuration "GitHub:App:ClientSecret",
            configurationValue configuration "GitHub:App:CallbackUrl",
            configurationValue configuration "GitHub:OwnerId",
            configurationValue configuration "Application:PublicOrigin"
        with
        | Some clientId, Some clientSecret, Some callback, Some ownerId, Some publicOrigin ->
            match
                Uri.TryCreate(callback, UriKind.Absolute),
                UInt64.TryParse(ownerId),
                Uri.TryCreate(publicOrigin, UriKind.Absolute)
            with
            | (true, callbackUrl), (true, numericOwnerId), (true, origin) when
                (callbackUrl.Scheme = Uri.UriSchemeHttps || callbackUrl.IsLoopback)
                && (origin.Scheme = Uri.UriSchemeHttps || origin.IsLoopback)
                && origin.PathAndQuery = "/"
                ->
                Some
                    { ClientId = clientId
                      ClientSecret = clientSecret
                      CallbackUrl = callbackUrl
                      OwnerId = numericOwnerId
                      PublicOrigin = Uri(origin.GetLeftPart(UriPartial.Authority)) }
            | _ -> None
        | _ -> None

    let keyRingAvailable () =
        if not (Directory.Exists(keyRingPath)) then
            false
        else
            try
                let probe = Path.Combine(keyRingPath, $".termin-al-write-probe-{Guid.NewGuid():N}")

                use stream =
                    new FileStream(
                        probe,
                        FileMode.CreateNew,
                        FileAccess.Write,
                        FileShare.None,
                        1,
                        FileOptions.DeleteOnClose
                    )

                stream.WriteByte(0uy)
                true
            with
            | :? IOException
            | :? UnauthorizedAccessException -> false

    let private parseToken (now: DateTimeOffset) (json: Stream) =
        task {
            try
                use! document = JsonDocument.ParseAsync(json)
                let root = document.RootElement
                let mutable accessToken = Unchecked.defaultof<JsonElement>
                let mutable refreshToken = Unchecked.defaultof<JsonElement>
                let mutable expiresIn = Unchecked.defaultof<JsonElement>
                let mutable refreshExpiresIn = Unchecked.defaultof<JsonElement>

                if
                    root.TryGetProperty("access_token", &accessToken)
                    && root.TryGetProperty("refresh_token", &refreshToken)
                    && root.TryGetProperty("expires_in", &expiresIn)
                    && root.TryGetProperty("refresh_token_expires_in", &refreshExpiresIn)
                then
                    let access = accessToken.GetString()
                    let refresh = refreshToken.GetString()

                    if not (isNull access) && not (isNull refresh) then
                        return
                            Ok
                                { AccessToken = access
                                  RefreshToken = refresh
                                  AccessExpiresAt = now.AddSeconds(float (expiresIn.GetInt32()))
                                  RefreshExpiresAt = now.AddSeconds(float (refreshExpiresIn.GetInt32())) }
                    else
                        return Error()
                else
                    return Error()
            with
            | :? JsonException
            | :? InvalidOperationException -> return Error()
        }

    type private LiveGitHubAuthenticationClient
        (httpClient: HttpClient, configuration: GitHubConfiguration, now: unit -> DateTimeOffset) =
        let postToken fields cancellationToken =
            task {
                try
                    use content = new FormUrlEncodedContent(fields)

                    use request =
                        new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")

                    request.Headers.Accept.Add(MediaTypeWithQualityHeaderValue("application/json"))
                    request.Content <- content

                    use! response =
                        httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)

                    if response.StatusCode <> HttpStatusCode.OK then
                        return Error()
                    else
                        use! stream = response.Content.ReadAsStreamAsync(cancellationToken)
                        return! parseToken (now ()) stream
                with
                | :? HttpRequestException
                | :? TaskCanceledException -> return Error()
            }

        interface GitHubAuthenticationClient with
            member _.ExchangeCode(code, cancellationToken) =
                postToken
                    [ KeyValuePair("client_id", configuration.ClientId)
                      KeyValuePair("client_secret", configuration.ClientSecret)
                      KeyValuePair("code", code)
                      KeyValuePair("redirect_uri", configuration.CallbackUrl.AbsoluteUri) ]
                    cancellationToken

            member _.Refresh(refreshToken, cancellationToken) =
                postToken
                    [ KeyValuePair("client_id", configuration.ClientId)
                      KeyValuePair("client_secret", configuration.ClientSecret)
                      KeyValuePair("grant_type", "refresh_token")
                      KeyValuePair("refresh_token", refreshToken) ]
                    cancellationToken

            member _.GetIdentity(accessToken, cancellationToken) =
                task {
                    try
                        use request = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com/user")
                        request.Headers.Authorization <- AuthenticationHeaderValue("Bearer", accessToken)
                        request.Headers.Accept.Add(MediaTypeWithQualityHeaderValue("application/vnd.github+json"))
                        request.Headers.UserAgent.ParseAdd("termin.al")
                        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28")

                        use! response =
                            httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)

                        if response.StatusCode <> HttpStatusCode.OK then
                            return Error()
                        else
                            use! stream = response.Content.ReadAsStreamAsync(cancellationToken)
                            use! document = JsonDocument.ParseAsync(stream, cancellationToken = cancellationToken)
                            let root = document.RootElement
                            let mutable id = Unchecked.defaultof<JsonElement>
                            let mutable login = Unchecked.defaultof<JsonElement>

                            if root.TryGetProperty("id", &id) && root.TryGetProperty("login", &login) then
                                let name = login.GetString()

                                if isNull name then
                                    return Error()
                                else
                                    return Ok { Id = id.GetUInt64(); Login = name }
                            else
                                return Error()
                    with
                    | :? HttpRequestException
                    | :? TaskCanceledException
                    | :? JsonException
                    | :? InvalidOperationException -> return Error()
                }

    type private UnavailableGitHubAuthenticationClient() =
        interface GitHubAuthenticationClient with
            member _.ExchangeCode(_, _) = Task.FromResult(Error())
            member _.Refresh(_, _) = Task.FromResult(Error())
            member _.GetIdentity(_, _) = Task.FromResult(Error())

    let private genericProblem (status: int) =
        Results.Problem(statusCode = Nullable<int>(status), title = "Authentication failed.")

    let private exactOrigin (runtime: Runtime) (context: HttpContext) =
        match runtime.Configuration with
        | None -> false
        | Some configuration ->
            match context.Request.Headers.Origin |> Seq.tryExactlyOne with
            | None -> false
            | Some value ->
                String.Equals(value, configuration.PublicOrigin.AbsoluteUri.TrimEnd('/'), StringComparison.Ordinal)

    let validateMutation (context: HttpContext) =
        task {
            let runtime = context.RequestServices.GetRequiredService<Runtime>()

            if not (exactOrigin runtime context) then
                return false
            else
                let antiforgery = context.RequestServices.GetRequiredService<IAntiforgery>()

                try
                    do! antiforgery.ValidateRequestAsync(context)
                    return true
                with :? AntiforgeryValidationException ->
                    return false
        }

    let currentSession (context: HttpContext) = readSession context
    let setSession (context: HttpContext) session = writeSession context session

    let clearSession (context: HttpContext) =
        let runtime = context.RequestServices.GetRequiredService<Runtime>()
        expireCookie context SessionCookieName runtime.AllowLocalHttpCookie

    let private refreshOwner (context: HttpContext) (session: Session) =
        task {
            match session with
            | Owner(viewer, tokens) when
                tokens.AccessExpiresAt
                <= context.RequestServices.GetRequiredService<Runtime>().Now().AddMinutes(1.0)
                ->
                let runtime = context.RequestServices.GetRequiredService<Runtime>()
                let fingerprint = tokenFingerprint tokens.RefreshToken
                do! runtime.RefreshGate.WaitAsync(context.RequestAborted)

                try
                    let now = runtime.Now()
                    let mutable cached = Unchecked.defaultof<DateTimeOffset * OwnerTokens option>

                    let! nextTokens =
                        if runtime.RefreshResults.TryGetValue(fingerprint, &cached) && fst cached >= now then
                            Task.FromResult(snd cached)
                        else
                            task {
                                let! refreshed =
                                    runtime.GitHubClient.Refresh(tokens.RefreshToken, context.RequestAborted)

                                let value = refreshed |> Result.toOption |> Option.bind ownerTokens
                                runtime.RefreshResults[fingerprint] <- (now.AddMinutes(1.0), value)
                                return value
                            }

                    let next =
                        match nextTokens with
                        | Some value -> Owner(viewer, value)
                        | None -> GitHubViewer viewer

                    writeSession context next
                    return next
                finally
                    runtime.RefreshGate.Release() |> ignore
            | _ -> return session
        }

    let resolveSession (context: HttpContext) =
        readSession context |> refreshOwner context

    let sessionView =
        function
        | Anonymous -> AnonymousView
        | GitHubViewer viewer -> GitHubViewerView viewer.Login
        | CvViewer _ -> CvViewerView
        | GitHubCvViewer(viewer, _) -> GitHubCvViewerView viewer.Login
        | Owner(viewer, _) -> OwnerView viewer.Login

    let private serializeCorrelation (correlation: Correlation) =
        Encoding.UTF8.GetBytes($"1\n{correlation.ExpiresAt.ToUnixTimeSeconds()}\n{correlation.State}")

    let private tryDeserializeCorrelation (bytes: byte array) =
        let parts = Encoding.UTF8.GetString(bytes).Split('\n')

        match parts with
        | [| "1"; expires; state |] ->
            match Int64.TryParse(expires) with
            | true, seconds when state.Length >= 43 && state.Length <= 128 ->
                Some
                    { State = state
                      ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(seconds) }
            | _ -> None
        | _ -> None

    let private protectCorrelation (provider: IDataProtectionProvider) correlation =
        provider.CreateProtector(correlationPurpose).Protect(serializeCorrelation correlation)
        |> base64UrlEncode

    let private tryUnprotectCorrelation (provider: IDataProtectionProvider) value =
        try
            value
            |> tryBase64UrlDecode
            |> Option.map (provider.CreateProtector(correlationPurpose).Unprotect)
            |> Option.bind tryDeserializeCorrelation
        with :? CryptographicException ->
            None

    let private fixedTimeEqualsText (left: string) (right: string) =
        let leftBytes = Encoding.UTF8.GetBytes(left)
        let rightBytes = Encoding.UTF8.GetBytes(right)
        CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes)

    let private popupPage (configuration: GitHubConfiguration) ok =
        let origin = configuration.PublicOrigin.AbsoluteUri.TrimEnd('/')
        let jsonOrigin = JsonSerializer.Serialize(origin)
        let jsonOk = if ok then "true" else "false"
        let link = HtmlEncoder.Default.Encode(origin)
        $"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Authentication</title></head><body><p>Authentication complete.</p><p><a href=\"{link}\">Return to termin.al</a></p><script>history.replaceState(null,'',location.pathname);if(window.opener){{window.opener.postMessage({{type:'termin.al.auth.complete',ok:{jsonOk}}},{jsonOrigin});window.close();}}</script></body></html>"

    let private mapStart (application: WebApplication) =
        application.MapGet(
            "/api/auth/github/start",
            Func<HttpContext, IResult>(fun context ->
                context.Response.Headers.CacheControl <- "no-store"
                let runtime = context.RequestServices.GetRequiredService<Runtime>()

                match runtime.Configuration with
                | None -> genericProblem StatusCodes.Status503ServiceUnavailable
                | Some configuration when not runtime.KeyRingReady ->
                    genericProblem StatusCodes.Status503ServiceUnavailable
                | Some configuration ->
                    let state = runtime.RandomBytes(32) |> base64UrlEncode

                    let correlation =
                        { State = state
                          ExpiresAt = runtime.Now().AddMinutes(10.0) }

                    for entry in runtime.Correlations do
                        if entry.Value < runtime.Now() then
                            runtime.Correlations.TryRemove(entry.Key) |> ignore

                    runtime.Correlations[state] <- correlation.ExpiresAt
                    let provider = context.RequestServices.GetRequiredService<IDataProtectionProvider>()
                    let options = cookieOptions runtime.AllowLocalHttpCookie
                    options.MaxAge <- Nullable(TimeSpan.FromMinutes(10.0))

                    context.Response.Cookies.Append(
                        correlationCookieName,
                        protectCorrelation provider correlation,
                        options
                    )

                    let query =
                        $"client_id={Uri.EscapeDataString(configuration.ClientId)}&redirect_uri={Uri.EscapeDataString(configuration.CallbackUrl.AbsoluteUri)}&state={Uri.EscapeDataString(state)}"

                    Results.Redirect($"https://github.com/login/oauth/authorize?{query}"))
        )
        |> ignore

    let private mapCallback (application: WebApplication) =
        application.MapGet(
            "/api/auth/github/callback",
            Func<HttpContext, Task<IResult>>(fun context ->
                task {
                    context.Response.Headers.CacheControl <- "no-store"
                    let runtime = context.RequestServices.GetRequiredService<Runtime>()

                    match runtime.Configuration with
                    | None -> return genericProblem StatusCodes.Status503ServiceUnavailable
                    | Some configuration ->
                        expireCookie context correlationCookieName runtime.AllowLocalHttpCookie
                        let provider = context.RequestServices.GetRequiredService<IDataProtectionProvider>()
                        let code = context.Request.Query["code"] |> Seq.tryExactlyOne
                        let state = context.Request.Query["state"] |> Seq.tryExactlyOne

                        let correlation =
                            match context.Request.Cookies.TryGetValue(correlationCookieName) with
                            | true, value -> tryUnprotectCorrelation provider value
                            | false, _ -> None

                        let validCorrelation =
                            match state, correlation with
                            | Some returnedState, Some expected ->
                                let mutable storedExpiry = DateTimeOffset.MinValue
                                let consumed = runtime.Correlations.TryRemove(returnedState, &storedExpiry)

                                consumed
                                && storedExpiry >= runtime.Now()
                                && expected.ExpiresAt = storedExpiry
                                && fixedTimeEqualsText expected.State returnedState
                            | _ -> false

                        if not runtime.KeyRingReady || not validCorrelation then
                            return
                                Results.Content(
                                    popupPage configuration false,
                                    "text/html",
                                    Encoding.UTF8,
                                    Nullable<int>(StatusCodes.Status400BadRequest)
                                )
                        else
                            match code with
                            | None ->
                                return
                                    Results.Content(
                                        popupPage configuration false,
                                        "text/html",
                                        Encoding.UTF8,
                                        Nullable<int>(StatusCodes.Status400BadRequest)
                                    )
                            | Some authorizationCode ->
                                let! exchanged =
                                    runtime.GitHubClient.ExchangeCode(authorizationCode, context.RequestAborted)

                                match exchanged with
                                | Error _ ->
                                    return
                                        Results.Content(
                                            popupPage configuration false,
                                            "text/html",
                                            Encoding.UTF8,
                                            Nullable<int>(StatusCodes.Status400BadRequest)
                                        )
                                | Ok token ->
                                    let! resolved =
                                        runtime.GitHubClient.GetIdentity(token.AccessToken, context.RequestAborted)

                                    match resolved |> Result.toOption |> Option.bind identity with
                                    | None ->
                                        return
                                            Results.Content(
                                                popupPage configuration false,
                                                "text/html",
                                                Encoding.UTF8,
                                                Nullable<int>(StatusCodes.Status400BadRequest)
                                            )
                                    | Some viewer ->
                                        let session =
                                            if viewer.Id = configuration.OwnerId then
                                                match ownerTokens token with
                                                | Some tokens -> Owner(viewer, tokens)
                                                | None -> GitHubViewer viewer
                                            else
                                                GitHubViewer viewer

                                        writeSession context session

                                        return
                                            Results.Content(
                                                popupPage configuration true,
                                                "text/html",
                                                Encoding.UTF8,
                                                Nullable<int>(StatusCodes.Status200OK)
                                            )
                })
        )
        |> ignore

    let configureServices
        (services: IServiceCollection)
        (configuration: IConfiguration)
        (allowLocalHttpCookie: bool)
        (httpClient: HttpClient)
        (now: unit -> DateTimeOffset)
        (randomBytes: int -> byte array)
        =
        let ready = keyRingAvailable ()

        services.AddLogging(fun logging ->
            logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.None)
            |> ignore

            logging.AddFilter("Microsoft.AspNetCore.Http.Result.RedirectResult", LogLevel.None)
            |> ignore)
        |> ignore

        let dataProtection = services.AddDataProtection().SetApplicationName("termin.al")

        if ready then
            dataProtection.PersistKeysToFileSystem(DirectoryInfo(keyRingPath)) |> ignore

        services.AddAntiforgery(fun options ->
            options.HeaderName <- AntiforgeryHeaderName
            options.Cookie.Name <- "termin.al.antiforgery"
            options.Cookie.HttpOnly <- true
            options.Cookie.IsEssential <- true
            options.Cookie.Path <- "/"
            options.Cookie.SameSite <- SameSiteMode.Strict

            options.Cookie.SecurePolicy <-
                if allowLocalHttpCookie then
                    CookieSecurePolicy.None
                else
                    CookieSecurePolicy.Always)
        |> ignore

        let parsed = tryConfiguration configuration

        let client: GitHubAuthenticationClient =
            match parsed with
            | Some value -> LiveGitHubAuthenticationClient(httpClient, value, now)
            | None -> UnavailableGitHubAuthenticationClient()

        services.AddSingleton<Runtime>(
            { Configuration = parsed
              KeyRingReady = ready || allowLocalHttpCookie
              AllowLocalHttpCookie = allowLocalHttpCookie
              GitHubClient = client
              Now = now
              RandomBytes = randomBytes
              Correlations = ConcurrentDictionary<string, DateTimeOffset>(StringComparer.Ordinal)
              RefreshGate = new SemaphoreSlim(1, 1)
              RefreshResults = ConcurrentDictionary<string, DateTimeOffset * OwnerTokens option>(StringComparer.Ordinal) }
        )
        |> ignore

    let mapOAuthEndpoints (application: WebApplication) =
        mapStart application
        mapCallback application

    let randomBytes length = RandomNumberGenerator.GetBytes(length)
