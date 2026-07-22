namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.IO
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Threading.Tasks
open Microsoft.AspNetCore.DataProtection
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.DependencyInjection

[<RequireQualifiedAccess>]
module Cv =
    [<Literal>]
    let private viewerHashConfigurationName = "Cv:ViewerKeyHash"

    [<Literal>]
    let SecretFilePath = "/run/secrets/termin.al-cv.md"

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
          CvPath: string
          AllowLocalHttpCookie: bool
          Now: unit -> DateTimeOffset
          RandomBytes: int -> byte array
          Attempts: ConcurrentDictionary<string, AttemptWindow>
          GlobalGate: obj
          mutable GlobalWindow: AttemptWindow }

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

        let browser =
            state.Attempts.AddOrUpdate(
                attempt,
                (fun _ -> { StartedAt = now; Failures = 1 }),
                (fun _ existing ->
                    let current = currentWindow now (Some existing)

                    { current with
                        Failures = current.Failures + 1 })
            )

        let processWindow =
            lock state.GlobalGate (fun () ->
                let current = currentWindow now (Some state.GlobalWindow)

                let next =
                    { current with
                        Failures = current.Failures + 1 }

                state.GlobalWindow <- next
                next)

        browser.Failures > 5 || processWindow.Failures > 100

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

    let private readCv path =
        task {
            let bytes = Array.zeroCreate<byte> (maximumCvBytes + 1)

            try
                try
                    use stream =
                        new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true)

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

    type AccessResult =
        | Changed
        | Rejected
        | RateLimited
        | Unavailable

    type DocumentResult =
        | Available of string
        | Locked
        | DocumentUnavailable

    let unlock (context: HttpContext) (key: string) =
        task {
            context.Response.Headers.CacheControl <- "no-store, no-cache"
            let! validMutation = Auth.validateMutation context

            if not validMutation then
                return Rejected
            else
                let state = runtime context

                if not state.KeyRingReady then
                    return Unavailable
                else
                    match state.ViewerHash with
                    | None -> return Unavailable
                    | Some configured ->
                        let attempt = attemptId context

                        if throttled context attempt then
                            return RateLimited
                        elif isNull key || key.Length < 32 || key.Length > 256 then
                            if recordFailure context attempt then
                                return RateLimited
                            else
                                return Rejected
                        else
                            let actual = derive key configured.Salt

                            let accepted =
                                try
                                    CryptographicOperations.FixedTimeEquals(actual, configured.DerivedKey)
                                finally
                                    CryptographicOperations.ZeroMemory(actual)

                            if not accepted then
                                if recordFailure context attempt then
                                    return RateLimited
                                else
                                    return Rejected
                            else
                                clearAttempt context attempt

                                Auth.currentSession context
                                |> fun session -> withCvFingerprint session configured.Fingerprint
                                |> Auth.setSession context

                                return Changed
        }

    let lock (context: HttpContext) =
        task {
            context.Response.Headers.CacheControl <- "no-store, no-cache"
            let! validMutation = Auth.validateMutation context

            if not validMutation then
                return Rejected
            else
                Auth.currentSession context |> withoutCv |> Auth.setSession context
                return Changed
        }

    let read (context: HttpContext) =
        task {
            context.Response.Headers.CacheControl <- "no-store, no-cache"
            let state = runtime context

            match state.KeyRingReady, state.ViewerHash with
            | false, _
            | _, None -> return DocumentUnavailable
            | true, Some configured ->
                let! session = Auth.resolveSession context

                if not (hasCvAccess session configured.Fingerprint) then
                    return Locked
                else
                    let! content = readCv state.CvPath
                    return content |> Option.map Available |> Option.defaultValue DocumentUnavailable
        }

    let configureServices
        (services: IServiceCollection)
        (configuration: IConfiguration)
        (allowLocalHttpCookie: bool)
        (now: unit -> DateTimeOffset)
        (randomBytes: int -> byte array)
        (keyRingAvailable: unit -> bool)
        (cvPath: string)
        =
        let viewerHash =
            match configuration[viewerHashConfigurationName] with
            | null -> None
            | value -> tryParseViewerHash value

        services.AddSingleton<Runtime>(
            { ViewerHash = viewerHash
              KeyRingReady = keyRingAvailable () || allowLocalHttpCookie
              CvPath = cvPath
              AllowLocalHttpCookie = allowLocalHttpCookie
              Now = now
              RandomBytes = randomBytes
              Attempts = ConcurrentDictionary<string, AttemptWindow>(StringComparer.Ordinal)
              GlobalGate = obj ()
              GlobalWindow = { StartedAt = now (); Failures = 0 } }
        )
        |> ignore

    let validateProductionConfiguration (configuration: IConfiguration) =
        match configuration[viewerHashConfigurationName] with
        | null -> Ok()
        | value when String.IsNullOrWhiteSpace(value) -> Ok()
        | value when tryParseViewerHash value |> Option.isNone ->
            Error "CV access is enabled but Cv:ViewerKeyHash is invalid."
        | _ when not (Auth.keyRingAvailable ()) ->
            Error "CV access is enabled but the Data Protection key ring is unavailable."
        | _ when not (File.Exists(SecretFilePath)) -> Error $"CV access is enabled but {SecretFilePath} is unavailable."
        | _ -> Ok()
