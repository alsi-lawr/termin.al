namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.IO
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Threading.Tasks
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.DataProtection
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.DependencyInjection

[<RequireQualifiedAccess>]
module Cv =
    [<Literal>]
    let private viewerHashConfigurationName = "Cv:ViewerKeyHash"

    [<Literal>]
    let private cvPath = "/run/secrets/termin.al-cv.md"

    [<Literal>]
    let private attemptCookieName = "termin.al.cv-attempt"

    [<Literal>]
    let private attemptPurpose = "termin.al.cv-attempt.v1"

    [<Literal>]
    let private iterations = 600000

    [<Literal>]
    let private maximumCvBytes = 1024 * 1024

    type GeneratedViewerKey =
        { Plaintext: string
          CanonicalHash: string }

    type private ViewerKeyHash =
        { Salt: byte array
          DerivedKey: byte array
          Canonical: string
          Fingerprint: string }

    type private AttemptWindow =
        { StartedAt: DateTimeOffset
          Failures: int }

    type private Runtime =
        { ViewerHash: ViewerKeyHash option
          KeyRingReady: bool
          AllowLocalHttpCookie: bool
          Now: unit -> DateTimeOffset
          RandomBytes: int -> byte array
          Attempts: ConcurrentDictionary<string, AttemptWindow>
          GlobalGate: obj
          mutable GlobalWindow: AttemptWindow }

    type private KeyRequest = { Key: string }

    let private base64UrlEncode (bytes: byte array) =
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

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

    let private canonical (salt: byte array) (derivedKey: byte array) =
        $"pbkdf2-sha256$v=1$i={iterations}${base64UrlEncode salt}${base64UrlEncode derivedKey}"

    let private fingerprint (value: string) =
        value |> Encoding.UTF8.GetBytes |> SHA256.HashData |> base64UrlEncode

    let private derive (key: string) (salt: byte array) =
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(key), salt, iterations, HashAlgorithmName.SHA256, 32)

    let private tryParseViewerHash (value: string) =
        match value.Split('$') with
        | [| "pbkdf2-sha256"; "v=1"; iterationPart; saltPart; hashPart |] when iterationPart = $"i={iterations}" ->
            match tryBase64UrlDecode saltPart, tryBase64UrlDecode hashPart with
            | Some salt, Some derivedKey when salt.Length = 16 && derivedKey.Length = 32 ->
                let exact = canonical salt derivedKey

                if String.Equals(exact, value, StringComparison.Ordinal) then
                    Some
                        { Salt = salt
                          DerivedKey = derivedKey
                          Canonical = exact
                          Fingerprint = fingerprint exact }
                else
                    None
            | _ -> None
        | _ -> None

    let generateViewerKey () =
        let plaintextBytes = RandomNumberGenerator.GetBytes(32)
        let salt = RandomNumberGenerator.GetBytes(16)

        try
            let plaintext = base64UrlEncode plaintextBytes
            let derivedKey = derive plaintext salt

            try
                { Plaintext = plaintext
                  CanonicalHash = canonical salt derivedKey }
            finally
                CryptographicOperations.ZeroMemory(derivedKey)
        finally
            CryptographicOperations.ZeroMemory(plaintextBytes)
            CryptographicOperations.ZeroMemory(salt)

    let verifyViewerKey (canonicalHash: string) (plaintext: string) =
        match tryParseViewerHash canonicalHash with
        | None -> false
        | Some parsed ->
            let actual = derive plaintext parsed.Salt

            try
                CryptographicOperations.FixedTimeEquals(actual, parsed.DerivedKey)
            finally
                CryptographicOperations.ZeroMemory(actual)
                CryptographicOperations.ZeroMemory(parsed.Salt)
                CryptographicOperations.ZeroMemory(parsed.DerivedKey)

    let private genericProblem status =
        Results.Problem(statusCode = Nullable<int>(status), title = "CV access failed.")

    let private runtime (context: HttpContext) =
        context.RequestServices.GetRequiredService<Runtime>()

    let private attemptCookieOptions allowLocalHttp =
        let options = CookieOptions()
        options.HttpOnly <- true
        options.IsEssential <- true
        options.Path <- "/"
        options.SameSite <- SameSiteMode.Lax
        options.Secure <- not allowLocalHttp
        options

    let private protectAttempt (provider: IDataProtectionProvider) (value: string) =
        provider.CreateProtector(attemptPurpose).Protect(Encoding.UTF8.GetBytes($"1\n{value}"))
        |> base64UrlEncode

    let private tryUnprotectAttempt (provider: IDataProtectionProvider) (value: string) =
        try
            value
            |> tryBase64UrlDecode
            |> Option.map (provider.CreateProtector(attemptPurpose).Unprotect)
            |> Option.map Encoding.UTF8.GetString
            |> Option.bind (fun (decoded: string) ->
                match decoded.Split('\n') with
                | [| "1"; attemptId |] when attemptId.Length = 22 -> Some attemptId
                | _ -> None)
        with :? CryptographicException ->
            None

    let private attemptId (context: HttpContext) =
        let state = runtime context
        let provider = context.RequestServices.GetRequiredService<IDataProtectionProvider>()

        match context.Request.Cookies.TryGetValue(attemptCookieName) with
        | true, value ->
            match tryUnprotectAttempt provider value with
            | Some attempt -> attempt
            | None ->
                let created = state.RandomBytes(16) |> base64UrlEncode

                context.Response.Cookies.Append(
                    attemptCookieName,
                    protectAttempt provider created,
                    attemptCookieOptions state.AllowLocalHttpCookie
                )

                created
        | false, _ ->
            let created = state.RandomBytes(16) |> base64UrlEncode

            context.Response.Cookies.Append(
                attemptCookieName,
                protectAttempt provider created,
                attemptCookieOptions state.AllowLocalHttpCookie
            )

            created

    let private currentWindow now existing =
        match existing with
        | Some window when window.StartedAt.AddMinutes(15.0) > now -> window
        | _ -> { StartedAt = now; Failures = 0 }

    let private throttled context attempt =
        let state = runtime context
        let now = state.Now()

        let browser =
            match state.Attempts.TryGetValue(attempt) with
            | true, value -> currentWindow now (Some value)
            | false, _ -> currentWindow now None

        let processWindow =
            lock state.GlobalGate (fun () -> currentWindow now (Some state.GlobalWindow))

        browser.Failures >= 5 || processWindow.Failures >= 100

    let private recordFailure context attempt =
        let state = runtime context
        let now = state.Now()

        state.Attempts.AddOrUpdate(
            attempt,
            (fun _ -> { StartedAt = now; Failures = 1 }),
            (fun _ existing ->
                let current = currentWindow now (Some existing)

                { current with
                    Failures = current.Failures + 1 })
        )
        |> ignore

        lock state.GlobalGate (fun () ->
            let current = currentWindow now (Some state.GlobalWindow)

            state.GlobalWindow <-
                { current with
                    Failures = current.Failures + 1 })

    let private clearAttempt context (attempt: string) =
        let state = runtime context
        let mutable removed = Unchecked.defaultof<AttemptWindow>
        state.Attempts.TryRemove(attempt, &removed) |> ignore

    let private withCvFingerprint session fingerprint =
        match session with
        | Auth.Anonymous -> Auth.CvViewer fingerprint
        | Auth.GitHubViewer viewer -> Auth.GitHubCvViewer(viewer, fingerprint)
        | Auth.CvViewer _ -> Auth.CvViewer fingerprint
        | Auth.GitHubCvViewer(viewer, _) -> Auth.GitHubCvViewer(viewer, fingerprint)
        | Auth.Owner _ -> session

    let private withoutCv session =
        match session with
        | Auth.CvViewer _ -> Auth.Anonymous
        | Auth.GitHubCvViewer(viewer, _) -> Auth.GitHubViewer viewer
        | Auth.Anonymous
        | Auth.GitHubViewer _
        | Auth.Owner _ -> session

    let private hasCvAccess session fingerprint =
        match session with
        | Auth.Owner _ -> true
        | Auth.CvViewer ticketFingerprint
        | Auth.GitHubCvViewer(_, ticketFingerprint) ->
            String.Equals(ticketFingerprint, fingerprint, StringComparison.Ordinal)
        | Auth.Anonymous
        | Auth.GitHubViewer _ -> false

    let private tryReadKeyRequest (context: HttpContext) =
        task {
            try
                use! document =
                    JsonDocument.ParseAsync(context.Request.Body, cancellationToken = context.RequestAborted)

                let root = document.RootElement
                let mutable key = Unchecked.defaultof<JsonElement>

                if root.ValueKind = JsonValueKind.Object && root.TryGetProperty("key", &key) then
                    let value = key.GetString()

                    if not (isNull value) && value.Length >= 32 && value.Length <= 256 then
                        return Some value
                    else
                        return None
                else
                    return None
            with
            | :? JsonException
            | :? InvalidOperationException -> return None
        }

    let private readCv () =
        task {
            let bytes = Array.zeroCreate<byte> (maximumCvBytes + 1)

            try
                try
                    use stream =
                        new FileStream(cvPath, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true)

                    let mutable total = 0
                    let mutable reading = true

                    while reading && total < bytes.Length do
                        let! count = stream.ReadAsync(bytes.AsMemory(total, bytes.Length - total))

                        if count = 0 then
                            reading <- false
                        else
                            total <- total + count

                    if total > maximumCvBytes then
                        return None
                    else
                        let strictUtf8 = UTF8Encoding(false, true)
                        return Some(strictUtf8.GetString(bytes, 0, total))
                with
                | :? IOException
                | :? UnauthorizedAccessException
                | :? DecoderFallbackException -> return None
            finally
                CryptographicOperations.ZeroMemory(bytes)
        }

    let private mapUnlock (application: WebApplication) =
        application.MapPost(
            "/api/auth/cv",
            Func<HttpContext, Task<IResult>>(fun context ->
                task {
                    context.Response.Headers.CacheControl <- "no-store"
                    let state = runtime context
                    let! validMutation = Auth.validateMutation context

                    if not validMutation || not state.KeyRingReady then
                        return genericProblem StatusCodes.Status400BadRequest
                    else
                        match state.ViewerHash with
                        | None -> return genericProblem StatusCodes.Status503ServiceUnavailable
                        | Some configured ->
                            let attempt = attemptId context

                            if throttled context attempt then
                                return genericProblem StatusCodes.Status429TooManyRequests
                            else
                                let! request = tryReadKeyRequest context

                                let accepted =
                                    match request with
                                    | Some key ->
                                        let actual = derive key configured.Salt

                                        try
                                            CryptographicOperations.FixedTimeEquals(actual, configured.DerivedKey)
                                        finally
                                            CryptographicOperations.ZeroMemory(actual)
                                    | None -> false

                                if not accepted then
                                    recordFailure context attempt
                                    return genericProblem StatusCodes.Status403Forbidden
                                else
                                    clearAttempt context attempt

                                    Auth.currentSession context
                                    |> fun session -> withCvFingerprint session configured.Fingerprint
                                    |> Auth.setSession context

                                    return Results.NoContent()
                })
        )
        |> ignore

    let private mapLock (application: WebApplication) =
        application.MapDelete(
            "/api/auth/cv",
            Func<HttpContext, Task<IResult>>(fun context ->
                task {
                    context.Response.Headers.CacheControl <- "no-store"
                    let! validMutation = Auth.validateMutation context

                    if not validMutation then
                        return genericProblem StatusCodes.Status400BadRequest
                    else
                        Auth.currentSession context |> withoutCv |> Auth.setSession context
                        return Results.NoContent()
                })
        )
        |> ignore

    let private mapRead (application: WebApplication) =
        application.MapGet(
            "/api/cv",
            Func<HttpContext, Task<IResult>>(fun context ->
                task {
                    context.Response.Headers.CacheControl <- "no-store"
                    let state = runtime context
                    let session = Auth.currentSession context

                    let authorized =
                        match session, state.ViewerHash with
                        | Auth.Owner _, _ -> true
                        | _, Some configured -> hasCvAccess session configured.Fingerprint
                        | _, None -> false

                    if not authorized then
                        match state.ViewerHash with
                        | None -> return genericProblem StatusCodes.Status503ServiceUnavailable
                        | Some _ -> return genericProblem StatusCodes.Status403Forbidden
                    else
                        let! content = readCv ()

                        match content with
                        | Some markdown -> return Results.Text(markdown, "text/markdown", Encoding.UTF8)
                        | None -> return genericProblem StatusCodes.Status503ServiceUnavailable
                })
        )
        |> ignore

    let configureServices
        (services: IServiceCollection)
        (configuration: IConfiguration)
        (allowLocalHttpCookie: bool)
        (now: unit -> DateTimeOffset)
        (randomBytes: int -> byte array)
        =
        let viewerHash =
            match configuration[viewerHashConfigurationName] with
            | null -> None
            | value -> tryParseViewerHash value

        services.AddSingleton<Runtime>(
            { ViewerHash = viewerHash
              KeyRingReady = Auth.keyRingAvailable () || allowLocalHttpCookie
              AllowLocalHttpCookie = allowLocalHttpCookie
              Now = now
              RandomBytes = randomBytes
              Attempts = ConcurrentDictionary<string, AttemptWindow>(StringComparer.Ordinal)
              GlobalGate = obj ()
              GlobalWindow = { StartedAt = now (); Failures = 0 } }
        )
        |> ignore

    let mapEndpoints application =
        mapUnlock application
        mapLock application
        mapRead application
