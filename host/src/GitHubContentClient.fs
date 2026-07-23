namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.Collections.Generic
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Text.RegularExpressions
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Configuration

type GitHubContentConfiguration =
    private
        { ConfiguredOwner: string
          ConfiguredContentRepository: ContentDomain.RepositoryName
          ConfiguredApplicationRepository: ContentDomain.RepositoryName
          ConfiguredProfileRepository: ContentDomain.RepositoryName
          ConfiguredApiToken: string option }

[<RequireQualifiedAccess>]
module GitHubContentConfiguration =
    let private invalidConfiguration () =
        Error(
            ContentDomain.Problem.create ContentDomain.ConfigurationInvalid "GitHub content configuration is required."
        )

    let private createRepository owner key (value: string) =
        if String.IsNullOrWhiteSpace value || value.Contains('/', StringComparison.Ordinal) then
            Error(ContentDomain.Problem.create ContentDomain.ConfigurationInvalid $"{key} must be a repository name.")
        else
            ContentDomain.RepositoryName.tryCreate key $"{owner}/{value}"
            |> Result.mapError (fun _ ->
                ContentDomain.Problem.create ContentDomain.ConfigurationInvalid $"{key} is invalid.")

    let tryCreate (configuration: IConfiguration) : Result<GitHubContentConfiguration, ContentDomain.Problem> =
        let owner = configuration["GitHub:Owner"]
        let contentRepository = configuration["GitHub:ContentRepository"]
        let applicationRepository = configuration["GitHub:ApplicationRepository"]
        let profileRepository = configuration["GitHub:ProfileRepository"]

        let apiToken =
            match configuration["GitHub:ApiToken"] with
            | null -> None
            | value when String.IsNullOrWhiteSpace value -> None
            | value -> Some value

        if
            String.IsNullOrWhiteSpace owner
            || String.IsNullOrWhiteSpace contentRepository
            || String.IsNullOrWhiteSpace applicationRepository
            || String.IsNullOrWhiteSpace profileRepository
        then
            invalidConfiguration ()
        else
            ContentDomain.RepositoryName.tryCreate "GitHub:Owner" $"{owner}/repository"
            |> Result.mapError (fun _ ->
                ContentDomain.Problem.create ContentDomain.ConfigurationInvalid "GitHub:Owner is invalid.")
            |> Result.bind (fun _ ->
                createRepository owner "GitHub:ContentRepository" contentRepository
                |> Result.bind (fun validContentRepository ->
                    createRepository owner "GitHub:ApplicationRepository" applicationRepository
                    |> Result.bind (fun validApplicationRepository ->
                        createRepository owner "GitHub:ProfileRepository" profileRepository
                        |> Result.map (fun validProfileRepository ->
                            { ConfiguredOwner = owner
                              ConfiguredContentRepository = validContentRepository
                              ConfiguredApplicationRepository = validApplicationRepository
                              ConfiguredProfileRepository = validProfileRepository
                              ConfiguredApiToken = apiToken }))))

    let owner (configuration: GitHubContentConfiguration) = configuration.ConfiguredOwner

    let contentRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredContentRepository

    let applicationRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredApplicationRepository

    let profileRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredProfileRepository

    let apiToken (configuration: GitHubContentConfiguration) = configuration.ConfiguredApiToken

type ContentCacheGeneration() =
    let gate = obj ()
    let mutable generation = 0L
    let mutable observedHead: string option = None

    member _.Current = lock gate (fun () -> generation)

    member _.Observe(head: string) =
        lock gate (fun () ->
            match observedHead with
            | None ->
                observedHead <- Some head
                false
            | Some current when String.Equals(current, head, StringComparison.Ordinal) -> false
            | Some _ ->
                observedHead <- Some head
                generation <- generation + 1L
                true)

    member _.Advance(head: string) =
        lock gate (fun () ->
            observedHead <- Some head
            generation <- generation + 1L
            generation)

[<RequireQualifiedAccess>]
module GitHubContentClient =
    type private CachedPayload =
        { CachedEtag: string option
          CachedBody: string
          CachedAt: DateTimeOffset
          CachedNextPage: Uri option }

    type private GitHubPayload =
        { PayloadBody: string
          PayloadFetchedAt: DateTimeOffset
          PayloadCacheState: ContentDomain.CacheState
          PayloadNextPage: Uri option }

    type private FetchFailure =
        | Missing
        | RateLimited
        | Unavailable

    type private GitHubRepositoryData =
        { RepositoryFullName: ContentDomain.RepositoryName
          RepositoryDefaultBranch: ContentDomain.ContentRevision
          RepositoryUrl: ContentDomain.ContentUrl
          RepositoryUpdatedAt: ContentDomain.Timestamp
          RepositoryDescription: string option
          RepositoryOwnerLogin: string
          RepositoryIsFork: bool
          RepositoryIsArchived: bool
          RepositoryIsPrivate: bool }

    type private CatalogInput =
        { CatalogRepository: GitHubRepositoryData
          CatalogManifest: CatalogManifest.Data
          CatalogManifestPath: ContentDomain.RepositoryPath
          CatalogManifestPayload: GitHubPayload }

    type private ReleaseData =
        { ReleaseTag: ContentDomain.ContentTag
          ReleaseName: ContentDomain.ContentTitle
          ReleasePublishedAt: DateTimeOffset
          ReleaseBody: string
          ReleaseUrl: ContentDomain.ContentUrl }

    type private ReadmeData =
        { ReadmeBody: string
          ReadmeRenderedHtml: ContentDomain.RenderedHtml
          ReadmePayload: GitHubPayload
          ReadmeRevision: string }

    type private ReleaseBoundary =
        { BoundaryRelease: ReleaseData
          BoundaryCommit: ContentDomain.CommitSha }

    type private ReleaseHeadComparison =
        { ComparisonBoundary: ReleaseBoundary
          ComparisonAheadBy: int
          ComparisonPayload: GitHubPayload }

    let private apiBase = Uri("https://api.github.com/")
    let private apiVersion = "2026-03-10"
    let private userAgent = "termin.al-content"
    let private jsonMediaType = "application/vnd.github+json"
    let private rawMediaType = "application/vnd.github.raw+json"
    let private htmlMediaType = "application/vnd.github.html+json"
    let private maximumPaginationPages = 3
    let private maximumPayloadCacheEntries = 512
    let private maximumGitHubPayloadBytes = ContentDomain.DocumentByteLimit * 2

    let private mapFetchFailure failure =
        match failure with
        | Missing -> ContentDomain.Problem.create ContentDomain.NotFound "The requested public content was not found."
        | RateLimited ->
            ContentDomain.Problem.create ContentDomain.RateLimited "GitHub rate limited public content retrieval."
        | Unavailable ->
            ContentDomain.Problem.create
                ContentDomain.UpstreamUnavailable
                "GitHub public content is temporarily unavailable."

    let private mapValidationFailure (_: ContentDomain.ValidationFailure) =
        ContentDomain.Problem.create ContentDomain.UpstreamUnavailable "GitHub returned invalid public content."

    let private repositoryName (value: ContentDomain.RepositoryName) =
        ContentDomain.RepositoryName.value value

    let private apiUri (path: string) = Uri(apiBase, path)

    let private encodeRepositoryPath (path: ContentDomain.RepositoryPath) =
        path
        |> ContentDomain.RepositoryPath.value
        |> fun value ->
            value.Split([| '/' |], StringSplitOptions.None)
            |> Array.map Uri.EscapeDataString
            |> String.concat "/"

    let private toDomainResult (result: ContentDomain.ValidationResult<'value>) : Result<'value, string> =
        result |> Result.mapError (fun failure -> failure.Message)

    let private toTimestamp (field: string) (value: string) : Result<ContentDomain.Timestamp, string> =
        match
            DateTimeOffset.TryParse(
                value,
                null,
                Globalization.DateTimeStyles.AssumeUniversal
                ||| Globalization.DateTimeStyles.AdjustToUniversal
            )
        with
        | true, parsed -> Ok(ContentDomain.Timestamp.create parsed)
        | false, _ -> Error $"{field} must be a timestamp."

    let private toDateTimeOffset (field: string) (value: string) : Result<DateTimeOffset, string> =
        match
            DateTimeOffset.TryParse(
                value,
                null,
                Globalization.DateTimeStyles.AssumeUniversal
                ||| Globalization.DateTimeStyles.AdjustToUniversal
            )
        with
        | true, parsed -> Ok(parsed.ToUniversalTime())
        | false, _ -> Error $"{field} must be a timestamp."

    let private parseJson (body: string) (parser: JsonElement -> Result<'value, string>) : Result<'value, string> =
        try
            use document = JsonDocument.Parse(body)
            parser document.RootElement
        with :? JsonException ->
            Error "GitHub returned malformed JSON."

    let private property (name: string) (element: JsonElement) : JsonElement option =
        element.EnumerateObject()
        |> Seq.tryFind (fun (item: JsonProperty) -> item.NameEquals(name))
        |> Option.map (fun item -> item.Value)

    let private requiredString (name: string) (element: JsonElement) : Result<string, string> =
        match property name element with
        | Some value when value.ValueKind = JsonValueKind.String ->
            let text = value.GetString()

            if String.IsNullOrWhiteSpace text then
                Error $"{name} must be a non-empty string."
            else
                Ok text
        | _ -> Error $"{name} must be a string."

    let private optionalString (name: string) (element: JsonElement) : Result<string option, string> =
        match property name element with
        | None -> Ok None
        | Some value when value.ValueKind = JsonValueKind.Null -> Ok None
        | Some value when value.ValueKind = JsonValueKind.String ->
            let text = value.GetString()
            Ok(if String.IsNullOrWhiteSpace text then None else Some text)
        | _ -> Error $"{name} must be a string or null."

    let private requiredBoolean (name: string) (element: JsonElement) : Result<bool, string> =
        match property name element with
        | Some value when value.ValueKind = JsonValueKind.True -> Ok true
        | Some value when value.ValueKind = JsonValueKind.False -> Ok false
        | _ -> Error $"{name} must be a boolean."

    let private requiredInteger (name: string) (element: JsonElement) : Result<int, string> =
        match property name element with
        | Some value when value.ValueKind = JsonValueKind.Number ->
            let mutable parsed = 0

            if value.TryGetInt32(&parsed) then
                Ok parsed
            else
                Error $"{name} must be an integer."
        | _ -> Error $"{name} must be a number."

    let private hasOnlyProperties (names: string list) (element: JsonElement) =
        let actual =
            element.EnumerateObject() |> Seq.map (fun item -> item.Name) |> Set.ofSeq

        actual = (names |> Set.ofList)

    let private nextPage (headers: HttpResponseHeaders) : Uri option =
        match headers.TryGetValues("Link") with
        | true, values ->
            values
            |> Seq.collect (fun value -> value.Split([| ',' |], StringSplitOptions.RemoveEmptyEntries))
            |> Seq.tryPick (fun value ->
                let part = value.Trim()

                if part.Contains("rel=\"next\"", StringComparison.Ordinal) then
                    let start = part.IndexOf('<')
                    let ending = part.IndexOf('>')

                    if start = 0 && ending > start then
                        let candidate = part.Substring(start + 1, ending - start - 1)

                        match Uri.TryCreate(candidate, UriKind.Absolute) with
                        | true, uri -> Some uri
                        | false, _ -> None
                    else
                        None
                else
                    None)
        | false, _ -> None

    let private summaryFromMarkdown (markdown: string) =
        markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Split([| '\n' |], StringSplitOptions.None)
        |> Array.map (fun line -> line.Trim())
        |> Array.tryFind (fun line ->
            not (String.IsNullOrWhiteSpace line)
            && not (line.StartsWith("#", StringComparison.Ordinal))
            && not (line.StartsWith("<!--", StringComparison.Ordinal)))
        |> Option.map (fun line -> if line.Length <= 500 then line else line.Substring(0, 500))

    let private missingReadme = "No README found."

    let private firstLine (text: string) =
        text.Replace("\r\n", "\n", StringComparison.Ordinal).Split([| '\n' |], StringSplitOptions.None)
        |> Array.tryFind (String.IsNullOrWhiteSpace >> not)
        |> Option.defaultValue ""
        |> fun line -> line.Trim()

    let private normalizeSlug (value: string) =
        let builder = StringBuilder()
        let mutable previousWasSeparator = false

        for character in value.ToLowerInvariant() do
            if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') then
                builder.Append(character) |> ignore
                previousWasSeparator <- false
            elif builder.Length > 0 && not previousWasSeparator then
                builder.Append('-') |> ignore
                previousWasSeparator <- true

        let result = builder.ToString().Trim('-')

        if result.Length <= 64 then
            result
        else
            result.Substring(0, 64).TrimEnd('-')

    let createWithGeneration
        (httpClient: HttpClient)
        (configuration: GitHubContentConfiguration)
        (clock: unit -> DateTimeOffset)
        (generation: ContentCacheGeneration)
        : ContentClient =
        let cache = ConcurrentDictionary<string, CachedPayload>(StringComparer.Ordinal)
        let cacheLock = obj ()

        let inFlightFetches =
            Dictionary<string, TaskCompletionSource<Result<GitHubPayload, FetchFailure>>>(StringComparer.Ordinal)

        let staleDeadline (cached: CachedPayload) =
            cached.CachedAt.AddMinutes(float (ContentDomain.FreshCacheMinutes + ContentDomain.StaleCacheMinutes))

        let removeCachedPayload key =
            let mutable ignored = Unchecked.defaultof<CachedPayload>
            cache.TryRemove(key, &ignored) |> ignore

        let removeExpiredCachedPayloads now =
            cache
            |> Seq.filter (fun entry -> now > staleDeadline entry.Value)
            |> Seq.iter (fun entry -> removeCachedPayload entry.Key)

        let removeOldestCachedPayloads count =
            if count > 0 then
                cache
                |> Seq.sortWith (fun left right ->
                    let cachedAtOrder = compare left.Value.CachedAt right.Value.CachedAt

                    if cachedAtOrder <> 0 then
                        cachedAtOrder
                    else
                        StringComparer.Ordinal.Compare(left.Key, right.Key))
                |> Seq.truncate count
                |> Seq.iter (fun entry -> removeCachedPayload entry.Key)

        let findCachedPayloadOrStartFetch now cacheKey =
            lock cacheLock (fun () ->
                removeExpiredCachedPayloads now

                let cached =
                    match cache.TryGetValue(cacheKey) with
                    | true, value -> Some value
                    | false, _ -> None

                match cached with
                | Some value when now <= value.CachedAt.AddMinutes(float ContentDomain.FreshCacheMinutes) ->
                    Some value, None, false
                | _ ->
                    let completion, shouldStart =
                        match inFlightFetches.TryGetValue(cacheKey) with
                        | true, current -> current, false
                        | false, _ ->
                            let created =
                                TaskCompletionSource<Result<GitHubPayload, FetchFailure>>(
                                    TaskCreationOptions.RunContinuationsAsynchronously
                                )

                            inFlightFetches.Add(cacheKey, created)
                            created, true

                    None, Some(completion, cached), shouldStart)

        let storeCachedPayload now cacheKey payload =
            lock cacheLock (fun () ->
                removeExpiredCachedPayloads now

                if not (cache.ContainsKey cacheKey) then
                    removeOldestCachedPayloads (cache.Count - maximumPayloadCacheEntries + 1)

                cache[cacheKey] <- payload)

        let cacheMetadata (payload: GitHubPayload) : Result<ContentDomain.CacheMetadata, ContentDomain.Problem> =
            let fetchedAt = ContentDomain.Timestamp.create payload.PayloadFetchedAt

            let freshUntil =
                ContentDomain.Timestamp.create (
                    payload.PayloadFetchedAt.AddMinutes(float ContentDomain.FreshCacheMinutes)
                )

            let staleUntil =
                ContentDomain.Timestamp.create (
                    payload.PayloadFetchedAt.AddMinutes(
                        float (ContentDomain.FreshCacheMinutes + ContentDomain.StaleCacheMinutes)
                    )
                )

            ContentDomain.CacheMetadata.tryCreate payload.PayloadCacheState fetchedAt freshUntil staleUntil
            |> Result.mapError mapValidationFailure

        let stale now (cached: CachedPayload) failure =
            if now <= staleDeadline cached then
                Ok
                    { PayloadBody = cached.CachedBody
                      PayloadFetchedAt = cached.CachedAt
                      PayloadCacheState = ContentDomain.Stale
                      PayloadNextPage = cached.CachedNextPage }
            else
                Error failure

        let fetchFromGitHub
            now
            cacheKey
            cached
            (method: HttpMethod)
            (uri: Uri)
            (accept: string)
            (body: string option)
            : Task<Result<GitHubPayload, FetchFailure>> =
            task {
                use timeout = new CancellationTokenSource()
                timeout.CancelAfter(TimeSpan.FromSeconds(float ContentDomain.GitHubTimeoutSeconds))
                use request = new HttpRequestMessage(method, uri)
                request.Headers.Accept.ParseAdd(accept)
                request.Headers.UserAgent.ParseAdd(userAgent)
                request.Headers.Add("X-GitHub-Api-Version", apiVersion)

                match GitHubContentConfiguration.apiToken configuration with
                | Some token -> request.Headers.Authorization <- AuthenticationHeaderValue("Bearer", token)
                | None -> ()

                match body with
                | Some value -> request.Content <- new StringContent(value, Encoding.UTF8, "application/json")
                | None -> ()

                match cached with
                | Some { CachedEtag = Some etag } ->
                    request.Headers.TryAddWithoutValidation("If-None-Match", etag) |> ignore
                | Some { CachedEtag = None }
                | None -> ()

                try
                    let! response =
                        httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token)

                    use response = response

                    let failure =
                        if response.StatusCode = HttpStatusCode.NotFound then
                            Some Missing
                        elif response.StatusCode = HttpStatusCode.TooManyRequests then
                            Some RateLimited
                        elif
                            response.StatusCode = HttpStatusCode.Forbidden
                            && (match response.Headers.TryGetValues("X-RateLimit-Remaining") with
                                | true, values -> values |> Seq.exists (fun value -> value = "0")
                                | false, _ -> false)
                        then
                            Some RateLimited
                        elif response.IsSuccessStatusCode || response.StatusCode = HttpStatusCode.NotModified then
                            None
                        else
                            Some Unavailable

                    match response.StatusCode, failure, cached with
                    | HttpStatusCode.NotModified, None, Some value ->
                        let refreshed = { value with CachedAt = now }

                        storeCachedPayload now cacheKey refreshed

                        return
                            Ok
                                { PayloadBody = refreshed.CachedBody
                                  PayloadFetchedAt = refreshed.CachedAt
                                  PayloadCacheState = ContentDomain.Fresh
                                  PayloadNextPage = refreshed.CachedNextPage }
                    | _, Some fetchFailure, Some value -> return stale now value fetchFailure
                    | _, Some fetchFailure, None -> return Error fetchFailure
                    | HttpStatusCode.NotModified, None, None -> return Error Unavailable
                    | _, None, _ ->
                        let! body = response.Content.ReadAsStringAsync(timeout.Token)

                        if Encoding.UTF8.GetByteCount(body) > maximumGitHubPayloadBytes then
                            match cached with
                            | Some value -> return stale now value Unavailable
                            | None -> return Error Unavailable
                        else
                            let etag =
                                if isNull response.Headers.ETag then
                                    None
                                else
                                    Some response.Headers.ETag.Tag

                            let stored =
                                { CachedEtag = etag
                                  CachedBody = body
                                  CachedAt = now
                                  CachedNextPage = nextPage response.Headers }

                            storeCachedPayload now cacheKey stored

                            return
                                Ok
                                    { PayloadBody = body
                                      PayloadFetchedAt = now
                                      PayloadCacheState = ContentDomain.Fresh
                                      PayloadNextPage = stored.CachedNextPage }
                with
                | :? OperationCanceledException
                | :? HttpRequestException ->
                    match cached with
                    | Some value -> return stale now value Unavailable
                    | None -> return Error Unavailable
            }

        let removeInFlightFetch cacheKey (completion: TaskCompletionSource<Result<GitHubPayload, FetchFailure>>) =
            lock cacheLock (fun () ->
                match inFlightFetches.TryGetValue(cacheKey) with
                | true, current when Object.ReferenceEquals(current, completion) ->
                    inFlightFetches.Remove(cacheKey) |> ignore
                | _ -> ())

        let startSharedFetch
            now
            cacheKey
            cached
            method
            uri
            accept
            body
            (completion: TaskCompletionSource<Result<GitHubPayload, FetchFailure>>)
            =
            task {
                try
                    let! result = fetchFromGitHub now cacheKey cached method uri accept body
                    removeInFlightFetch cacheKey completion
                    completion.TrySetResult(result) |> ignore
                with
                | :? OperationCanceledException as error ->
                    removeInFlightFetch cacheKey completion
                    completion.TrySetCanceled(error.CancellationToken) |> ignore
                | error ->
                    removeInFlightFetch cacheKey completion
                    completion.TrySetException(error) |> ignore
            }
            |> ignore

        let fetch
            (method: HttpMethod)
            (uri: Uri)
            (accept: string)
            (body: string option)
            (cancellationToken: CancellationToken)
            : Task<Result<GitHubPayload, FetchFailure>> =
            task {
                let now = clock ()

                let bodyIdentity =
                    body
                    |> Option.map (Encoding.UTF8.GetBytes >> SHA256.HashData >> Convert.ToHexString)
                    |> Option.defaultValue ""

                let cacheKey = $"{generation.Current}|{method.Method}|{accept}|{uri.AbsoluteUri}|{bodyIdentity}"

                let cached, sharedFetch, shouldStart = findCachedPayloadOrStartFetch now cacheKey

                match cached, sharedFetch with
                | Some value, _ ->
                    return
                        Ok
                            { PayloadBody = value.CachedBody
                              PayloadFetchedAt = value.CachedAt
                              PayloadCacheState = ContentDomain.Fresh
                              PayloadNextPage = value.CachedNextPage }
                | None, Some(completion, staleCached) ->
                    if shouldStart then
                        startSharedFetch now cacheKey staleCached method uri accept body completion

                    return! completion.Task.WaitAsync(cancellationToken)
                | None, None -> return Error Unavailable
            }

        let getJson uri cancellationToken =
            fetch HttpMethod.Get uri jsonMediaType None cancellationToken

        let getRaw uri cancellationToken =
            fetch HttpMethod.Get uri rawMediaType None cancellationToken

        let getHtml uri cancellationToken =
            fetch HttpMethod.Get uri htmlMediaType None cancellationToken

        let renderMarkdown markdown context cancellationToken =
            let requestBody =
                JsonSerializer.Serialize(
                    {| text = markdown
                       mode = "gfm"
                       context = context |}
                )

            fetch HttpMethod.Post (apiUri "markdown") "text/html" (Some requestBody) cancellationToken

        let repositorySource
            (repository: GitHubRepositoryData)
            (path: ContentDomain.RepositoryPath)
            (url: ContentDomain.ContentUrl)
            =
            ContentDomain.ContentSource.create repository.RepositoryFullName path repository.RepositoryDefaultBranch url

        let documentUrl (repository: GitHubRepositoryData) (path: ContentDomain.RepositoryPath) =
            ContentDomain.ContentUrl.tryCreate
                "source.url"
                $"https://github.com/{repositoryName repository.RepositoryFullName}/blob/{ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch}/{encodeRepositoryPath path}"
            |> Result.mapError mapValidationFailure

        let repositoryRootUrl (repository: GitHubRepositoryData) = repository.RepositoryUrl

        let repositoryRelativePath (sourcePath: ContentDomain.RepositoryPath) (target: string) =
            let suffixIndex =
                [ target.IndexOf('?'); target.IndexOf('#') ]
                |> List.filter (fun index -> index >= 0)
                |> function
                    | [] -> target.Length
                    | indexes -> List.min indexes

            let targetPath = target.Substring(0, suffixIndex)
            let suffix = target.Substring(suffixIndex)
            let source = ContentDomain.RepositoryPath.value sourcePath
            let sourceDirectoryEnd = source.LastIndexOf('/')

            let initialSegments =
                if sourceDirectoryEnd < 0 then
                    []
                else
                    source.Substring(0, sourceDirectoryEnd).Split('/') |> Array.toList

            let rec normalize segments pending =
                match pending with
                | [] -> List.rev segments
                | "" :: remaining
                | "." :: remaining -> normalize segments remaining
                | ".." :: remaining ->
                    match segments with
                    | [] -> normalize [] remaining
                    | _ :: parent -> normalize parent remaining
                | segment :: remaining -> normalize (segment :: segments) remaining

            let relativeSegments = targetPath.Split('/') |> Array.toList
            let normalized = normalize (List.rev initialSegments) relativeSegments |> String.concat "/"
            normalized + suffix

        let resolveRenderedHtmlUrls
            (repository: GitHubRepositoryData)
            (sourcePath: ContentDomain.RepositoryPath)
            (revision: string)
            (html: string)
            =
            let fullName = repositoryName repository.RepositoryFullName
            let escapedRevision = Uri.EscapeDataString revision

            let resolve attribute value =
                if
                    String.IsNullOrWhiteSpace value
                    || value.StartsWith("#", StringComparison.Ordinal)
                    || value.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
                    || value.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)
                then
                    value
                elif value.StartsWith("//", StringComparison.Ordinal) then
                    "https:" + value
                else
                    match Uri.TryCreate(value, UriKind.Absolute) with
                    | true, _ -> value
                    | false, _ when value.StartsWith("/", StringComparison.Ordinal) -> "https://github.com" + value
                    | false, _ ->
                        let path = repositoryRelativePath sourcePath value

                        if attribute = "src" then
                            $"https://raw.githubusercontent.com/{fullName}/{escapedRevision}/{path}"
                        else
                            $"https://github.com/{fullName}/blob/{escapedRevision}/{path}"

            Regex.Replace(
                html,
                "(?<![A-Za-z0-9_-])(?<attribute>href|src)=\"(?<value>[^\"]*)\"",
                MatchEvaluator(fun matched ->
                    let attribute = matched.Groups["attribute"].Value
                    let value = matched.Groups["value"].Value
                    $"{attribute}=\"{resolve attribute value}\"")
            )

        let renderedHtml
            repository
            sourcePath
            revision
            (payload: GitHubPayload)
            : Result<ContentDomain.RenderedHtml, ContentDomain.Problem> =
            resolveRenderedHtmlUrls repository sourcePath revision payload.PayloadBody
            |> ContentDomain.RenderedHtml.tryCreate "rendered_html"
            |> Result.mapError mapValidationFailure

        let renderMarkdownPreview repository sourcePath revision markdown cancellationToken =
            task {
                let context = repositoryName repository.RepositoryFullName
                let! payload = renderMarkdown markdown context cancellationToken

                return
                    match payload with
                    | Error failure -> Error(mapFetchFailure failure)
                    | Ok response -> renderedHtml repository sourcePath revision response
            }

        let contentUri
            (repository: GitHubRepositoryData)
            (path: ContentDomain.RepositoryPath)
            (revision: string)
            =
            let reference = Uri.EscapeDataString revision

            apiUri
                $"repos/{repositoryName repository.RepositoryFullName}/contents/{encodeRepositoryPath path}?ref={reference}"

        let invalidProblem () =
            ContentDomain.Problem.create ContentDomain.UpstreamUnavailable "GitHub returned invalid public content."

        let parseGitObjectReference (body: string) : Result<string * ContentDomain.CommitSha, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Object then
                    Error "Git reference responses must be objects."
                else
                    match property "object" root with
                    | Some reference when reference.ValueKind = JsonValueKind.Object ->
                        match requiredString "type" reference, requiredString "sha" reference with
                        | Ok objectType, Ok sha ->
                            toDomainResult (ContentDomain.CommitSha.tryCreate "git.object.sha" sha)
                            |> Result.map (fun parsedSha -> objectType, parsedSha)
                        | Error message, _
                        | _, Error message -> Error message
                    | _ -> Error "Git reference object must be an object.")

        let getDefaultBranchHead (repository: GitHubRepositoryData) cancellationToken =
            task {
                let fullName = repositoryName repository.RepositoryFullName

                let branch =
                    Uri.EscapeDataString(ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch)

                let! reference = getJson (apiUri $"repos/{fullName}/git/ref/heads/{branch}") cancellationToken

                match reference with
                | Error failure -> return Error(mapFetchFailure failure)
                | Ok response ->
                    match parseGitObjectReference response.PayloadBody with
                    | Ok("commit", commit) -> return Ok commit
                    | Error _
                    | Ok _ -> return Error(invalidProblem ())
            }

        let readFile (repository: GitHubRepositoryData) (path: ContentDomain.RepositoryPath) cancellationToken =
            let revision = ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch
            getRaw (contentUri repository path revision) cancellationToken

        let readFileAtRevision repository path revision cancellationToken =
            getRaw (contentUri repository path revision) cancellationToken

        let readFileHtml
            (repository: GitHubRepositoryData)
            (path: ContentDomain.RepositoryPath)
            (revision: string)
            cancellationToken
            =
            task {
                let! payload = getHtml (contentUri repository path revision) cancellationToken

                return
                    match payload with
                    | Error failure -> Error(mapFetchFailure failure)
                    | Ok response -> renderedHtml repository path revision response
            }

        let readReadmeAtRevision
            (repository: GitHubRepositoryData)
            (revision: string)
            accept
            cancellationToken
            =
            let reference = Uri.EscapeDataString revision

            let uri =
                apiUri $"repos/{repositoryName repository.RepositoryFullName}/readme?ref={reference}"

            fetch HttpMethod.Get uri accept None cancellationToken

        let readReadme (repository: GitHubRepositoryData) cancellationToken =
            readReadmeAtRevision
                repository
                (ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch)
                rawMediaType
                cancellationToken

        let parseRepositoryElement
            (expected: ContentDomain.RepositoryName option)
            (element: JsonElement)
            : Result<GitHubRepositoryData, string> =
            if element.ValueKind <> JsonValueKind.Object then
                Error "Repository response must be an object."
            else
                let owner =
                    match property "owner" element with
                    | Some value when value.ValueKind = JsonValueKind.Object -> requiredString "login" value
                    | _ -> Error "Repository owner must be an object."

                match
                    requiredString "full_name" element,
                    requiredString "default_branch" element,
                    requiredString "html_url" element,
                    requiredString "updated_at" element,
                    optionalString "description" element,
                    requiredBoolean "fork" element,
                    requiredBoolean "archived" element,
                    requiredBoolean "private" element,
                    owner
                with
                | Ok fullName,
                  Ok branch,
                  Ok url,
                  Ok updatedAt,
                  Ok description,
                  Ok isFork,
                  Ok isArchived,
                  Ok isPrivate,
                  Ok ownerLogin ->
                    match
                        toDomainResult (ContentDomain.RepositoryName.tryCreate "repository.full_name" fullName),
                        toDomainResult (ContentDomain.ContentRevision.tryCreate "repository.default_branch" branch),
                        toDomainResult (ContentDomain.ContentUrl.tryCreate "repository.html_url" url),
                        toTimestamp "repository.updated_at" updatedAt
                    with
                    | Ok parsedName, Ok parsedBranch, Ok parsedUrl, Ok parsedUpdatedAt ->
                        match expected with
                        | Some expectedName when
                            not (
                                String.Equals(
                                    ContentDomain.RepositoryName.value parsedName,
                                    ContentDomain.RepositoryName.value expectedName,
                                    StringComparison.OrdinalIgnoreCase
                                )
                            )
                            ->
                            Error "Repository response did not match the requested repository."
                        | _ ->
                            Ok
                                { RepositoryFullName = parsedName
                                  RepositoryDefaultBranch = parsedBranch
                                  RepositoryUrl = parsedUrl
                                  RepositoryUpdatedAt = parsedUpdatedAt
                                  RepositoryDescription = description
                                  RepositoryOwnerLogin = ownerLogin
                                  RepositoryIsFork = isFork
                                  RepositoryIsArchived = isArchived
                                  RepositoryIsPrivate = isPrivate }
                    | Error message, _, _, _
                    | _, Error message, _, _
                    | _, _, Error message, _
                    | _, _, _, Error message -> Error message
                | Error message, _, _, _, _, _, _, _, _
                | _, Error message, _, _, _, _, _, _, _
                | _, _, Error message, _, _, _, _, _, _
                | _, _, _, Error message, _, _, _, _, _
                | _, _, _, _, Error message, _, _, _, _
                | _, _, _, _, _, Error message, _, _, _
                | _, _, _, _, _, _, Error message, _, _
                | _, _, _, _, _, _, _, Error message, _
                | _, _, _, _, _, _, _, _, Error message -> Error message

        let getRepository (repository: ContentDomain.RepositoryName) cancellationToken =
            task {
                let! payload = getJson (apiUri $"repos/{repositoryName repository}") cancellationToken

                match payload with
                | Error failure -> return Error(mapFetchFailure failure)
                | Ok response ->
                    return
                        parseJson response.PayloadBody (parseRepositoryElement (Some repository))
                        |> Result.mapError (fun _ -> invalidProblem ())
            }

        let getCatalogInput cancellationToken =
            task {
                let contentRepository = GitHubContentConfiguration.contentRepository configuration
                let! repository = getRepository contentRepository cancellationToken

                match repository with
                | Error problem -> return Error problem
                | Ok contentRepositoryData ->
                    match ContentDomain.RepositoryPath.tryCreate "catalog.path" "content/catalog.json" with
                    | Error failure -> return Error(mapValidationFailure failure)
                    | Ok manifestPath ->
                        let! payload = readFile contentRepositoryData manifestPath cancellationToken

                        match payload with
                        | Error failure -> return Error(mapFetchFailure failure)
                        | Ok manifestPayload ->
                            match CatalogManifest.tryParse manifestPayload.PayloadBody with
                            | Error _ -> return Error(invalidProblem ())
                            | Ok manifest ->
                                return
                                    Ok
                                        { CatalogRepository = contentRepositoryData
                                          CatalogManifest = manifest
                                          CatalogManifestPath = manifestPath
                                          CatalogManifestPayload = manifestPayload }
            }

        let catalogFromInput (input: CatalogInput) =
            match
                documentUrl input.CatalogRepository input.CatalogManifestPath,
                cacheMetadata input.CatalogManifestPayload
            with
            | Ok url, Ok cacheMetadata ->
                ContentDomain.Catalog.tryCreate
                    (repositorySource input.CatalogRepository input.CatalogManifestPath url)
                    cacheMetadata
                    input.CatalogManifest.ManifestCatalogEntries
                |> Result.mapError mapValidationFailure
            | Error problem, _
            | _, Error problem -> Error problem

        let buildDocument
            (repository: GitHubRepositoryData)
            (documentId: ContentDomain.ContentId)
            (documentPath: ContentDomain.RepositoryPath)
            (virtualPath: ContentDomain.VirtualPath)
            (updatedAt: ContentDomain.Timestamp)
            (payload: GitHubPayload)
            (baseRevisions: (ContentDomain.ContentRevision * ContentDomain.ContentRevision) option)
            (markdown: string)
            (preview: ContentDomain.RenderedHtml)
            =
            match documentUrl repository documentPath, cacheMetadata payload with
            | Ok url, Ok metadata ->
                ContentDomain.ContentDocument.tryCreate
                    documentId
                    virtualPath
                    updatedAt
                    (repositorySource repository documentPath url)
                    baseRevisions
                    metadata
                    markdown
                    preview
                |> Result.mapError mapValidationFailure
            | Error problem, _
            | _, Error problem -> Error problem

        let getOptionalReadme (repository: GitHubRepositoryData) cancellationToken =
            task {
                let! head = getDefaultBranchHead repository cancellationToken

                match head with
                | Error problem -> return Error problem
                | Ok headSha ->
                    let revision = ContentDomain.CommitSha.value headSha
                    let! markdown = readReadmeAtRevision repository revision rawMediaType cancellationToken

                    match markdown with
                    | Error Missing -> return Ok None
                    | Error failure -> return Error(mapFetchFailure failure)
                    | Ok markdownPayload ->
                        let! html = readReadmeAtRevision repository revision htmlMediaType cancellationToken

                        match html with
                        | Error failure -> return Error(mapFetchFailure failure)
                        | Ok htmlPayload ->
                            match ContentDomain.RepositoryPath.tryCreate "readme.path" "README.md" with
                            | Error failure -> return Error(mapValidationFailure failure)
                            | Ok readmePath ->
                                match renderedHtml repository readmePath revision htmlPayload with
                                | Error problem -> return Error problem
                                | Ok preview ->
                                    return
                                        Ok(
                                            Some
                                                { ReadmeBody = markdownPayload.PayloadBody
                                                  ReadmeRenderedHtml = preview
                                                  ReadmePayload = markdownPayload
                                                  ReadmeRevision = revision }
                                        )
            }

        let getProfileReadme cancellationToken =
            task {
                let profileRepository = GitHubContentConfiguration.profileRepository configuration
                let! repository = getRepository profileRepository cancellationToken

                match repository with
                | Error problem when ContentDomain.Problem.code problem = ContentDomain.NotFound -> return Ok None
                | Error problem -> return Error problem
                | Ok profileRepositoryData ->
                    let! readme = getOptionalReadme profileRepositoryData cancellationToken

                    match readme with
                    | Error problem -> return Error problem
                    | Ok None -> return Ok None
                    | Ok(Some readme) -> return Ok(Some(profileRepositoryData, readme))
            }

        let parseOwnedRepositories (body: string) : Result<GitHubRepositoryData list, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Array then
                    Error "Repository listings must be arrays."
                else
                    let rec parseEntries pending repositories =
                        match pending with
                        | [] -> Ok(List.rev repositories)
                        | entry :: remaining ->
                            parseRepositoryElement None entry
                            |> Result.bind (fun repository -> parseEntries remaining (repository :: repositories))

                    parseEntries (root.EnumerateArray() |> Seq.toList) []
                    |> Result.map (fun repositories ->
                        repositories
                        |> List.filter (fun repository ->
                            repository.RepositoryOwnerLogin = GitHubContentConfiguration.owner configuration
                            && not repository.RepositoryIsFork
                            && not repository.RepositoryIsArchived
                            && not repository.RepositoryIsPrivate)))

        let deduplicateRepositories (repositories: GitHubRepositoryData list) =
            let seen = HashSet<string>(StringComparer.Ordinal)

            repositories
            |> List.filter (fun repository -> seen.Add(repositoryName repository.RepositoryFullName))

        let getOwnedRepositories cancellationToken =
            let firstPage =
                apiUri
                    $"users/{Uri.EscapeDataString(GitHubContentConfiguration.owner configuration)}/repos?type=owner&sort=updated&direction=desc&per_page={ContentDomain.PageItemLimit}"

            let rec getPages (next: Uri option) pageCount collected =
                task {
                    match next with
                    | None ->
                        return
                            collected
                            |> deduplicateRepositories
                            |> List.truncate ContentDomain.PageItemLimit
                            |> Ok
                    | Some _ when pageCount = maximumPaginationPages ->
                        return
                            collected
                            |> deduplicateRepositories
                            |> List.truncate ContentDomain.PageItemLimit
                            |> Ok
                    | Some uri ->
                        let! payload = getJson uri cancellationToken

                        match payload with
                        | Error failure -> return Error(mapFetchFailure failure)
                        | Ok response ->
                            match parseOwnedRepositories response.PayloadBody with
                            | Error _ -> return Error(invalidProblem ())
                            | Ok page -> return! getPages response.PayloadNextPage (pageCount + 1) (collected @ page)
                }

            getPages (Some firstPage) 0 []

        let projectFromRepository (repository: GitHubRepositoryData) (readme: ReadmeData option) =
            let fullName = repositoryName repository.RepositoryFullName
            let repositoryShortName = fullName.Substring(fullName.IndexOf('/') + 1)
            let slugValue = normalizeSlug repositoryShortName

            let readmeBody =
                readme |> Option.map (fun value -> value.ReadmeBody) |> Option.defaultValue missingReadme

            let summary =
                readme
                |> Option.bind (fun value -> summaryFromMarkdown value.ReadmeBody)
                |> Option.orElse repository.RepositoryDescription
                |> Option.defaultValue $"Public repository {repositoryShortName}."

            let preview =
                readme
                |> Option.map (fun value -> value.ReadmeRenderedHtml)
                |> Option.defaultWith (fun () ->
                    ContentDomain.RenderedHtml.tryCreate "project.rendered_html" "<p>No README found.</p>"
                    |> function
                        | Ok value -> value
                        | Error failure -> failwith failure.Message)

            match
                toDomainResult (ContentDomain.ContentSlug.tryCreate "project.slug" slugValue),
                toDomainResult (ContentDomain.ContentId.tryCreate "project.id" slugValue),
                toDomainResult (ContentDomain.ContentTitle.tryCreate "project.name" repositoryShortName),
                toDomainResult (ContentDomain.ContentSummary.tryCreate "project.summary" summary),
                toDomainResult (ContentDomain.ProjectCollectionPath.tryCreate "project.collectionPath" "recent/github"),
                toDomainResult (ContentDomain.ContentTag.tryCreate "project.tag" "github"),
                toDomainResult (ContentDomain.MarkdownBody.tryCreate "project.readme" readmeBody)
            with
            | Ok slug, Ok id, Ok title, Ok projectSummary, Ok collectionPath, Ok tag, Ok projectReadme ->
                Ok(
                    ContentDomain.ProjectReadme.create
                        (ContentDomain.Project.create
                            id
                            slug
                            title
                            projectSummary
                            repository.RepositoryUrl
                            repository.RepositoryFullName
                            collectionPath
                            repository.RepositoryUpdatedAt
                            [ tag ])
                        projectReadme
                        preview
                )
            | Error message, _, _, _, _, _, _
            | _, Error message, _, _, _, _, _
            | _, _, Error message, _, _, _, _
            | _, _, _, Error message, _, _, _
            | _, _, _, _, Error message, _, _
            | _, _, _, _, _, Error message, _
            | _, _, _, _, _, _, Error message -> Error message

        let getProjectReadmes (repositories: GitHubRepositoryData list) cancellationToken =
            task {
                let mutable collected: (GitHubRepositoryData * ReadmeData option) list = []
                let mutable failure: ContentDomain.Problem option = None

                for repository in repositories do
                    if failure.IsNone then
                        let! readme = getOptionalReadme repository cancellationToken

                        match readme with
                        | Error problem -> failure <- Some problem
                        | Ok(Some readme) -> collected <- (repository, Some readme) :: collected
                        | Ok None -> collected <- (repository, None) :: collected

                match failure with
                | Some problem -> return Error problem
                | None -> return Ok(List.rev collected)
            }

        let getCuratedProjectReadmes (projects: ContentDomain.Project list) cancellationToken =
            task {
                let mutable collected: ContentDomain.ProjectReadme list = []
                let mutable failure: ContentDomain.Problem option = None

                for project in projects do
                    if failure.IsNone then
                        let repositoryName = project |> ContentDomain.Project.repository
                        let! repository = getRepository repositoryName cancellationToken

                        match repository with
                        | Error problem -> failure <- Some problem
                        | Ok repository ->
                            let! readme = getOptionalReadme repository cancellationToken

                            match readme with
                            | Error problem -> failure <- Some problem
                            | Ok readme ->
                                let body =
                                    readme
                                    |> Option.map (fun value -> value.ReadmeBody)
                                    |> Option.defaultValue missingReadme

                                let preview =
                                    readme
                                    |> Option.map (fun value -> value.ReadmeRenderedHtml)
                                    |> Option.defaultWith (fun () ->
                                        ContentDomain.RenderedHtml.tryCreate
                                            "project.rendered_html"
                                            "<p>No README found.</p>"
                                        |> function
                                            | Ok value -> value
                                            | Error failure -> failwith failure.Message)

                                match ContentDomain.MarkdownBody.tryCreate "project.readme" body with
                                | Error validationFailure -> failure <- Some(mapValidationFailure validationFailure)
                                | Ok markdown ->
                                    collected <-
                                        ContentDomain.ProjectReadme.create project markdown preview :: collected

                match failure with
                | Some problem -> return Error problem
                | None -> return Ok(List.rev collected)
            }

        let getProjectsFromGitHub cancellationToken =
            task {
                let contentRepository = GitHubContentConfiguration.contentRepository configuration
                let! repository = getRepository contentRepository cancellationToken

                match repository with
                | Error problem -> return Error problem
                | Ok contentRepositoryData ->
                    match ContentDomain.RepositoryPath.tryCreate "projects.path" "content/projects.json" with
                    | Error failure -> return Error(mapValidationFailure failure)
                    | Ok manifestPath ->
                        let! payload = readFile contentRepositoryData manifestPath cancellationToken

                        match payload with
                        | Error failure -> return Error(mapFetchFailure failure)
                        | Ok manifestPayload ->
                            match
                                ContentDomain.ProjectManifest.tryParse manifestPayload.PayloadBody,
                                documentUrl contentRepositoryData manifestPath,
                                cacheMetadata manifestPayload
                            with
                            | Ok curated, Ok sourceUrl, Ok metadata ->
                                let! curatedReadmes = getCuratedProjectReadmes curated cancellationToken

                                match curatedReadmes with
                                | Error problem -> return Error problem
                                | Ok curatedProjects ->
                                    let! ownedRepositories = getOwnedRepositories cancellationToken

                                    match ownedRepositories with
                                    | Error problem -> return Error problem
                                    | Ok owned ->
                                        let curatedRepositories =
                                            HashSet<string>(
                                                (curated
                                                 |> List.map (
                                                     ContentDomain.Project.repository
                                                     >> ContentDomain.RepositoryName.value
                                                 )),
                                                StringComparer.OrdinalIgnoreCase
                                            )

                                        let remainingCapacity =
                                            max 0 (ContentDomain.PageItemLimit - List.length curated)

                                        let candidates =
                                            owned
                                            |> List.filter (fun repository ->
                                                not (
                                                    curatedRepositories.Contains(
                                                        repositoryName repository.RepositoryFullName
                                                    )
                                                ))
                                            |> List.truncate (min 6 remainingCapacity)

                                        let! readmes = getProjectReadmes candidates cancellationToken

                                        match readmes with
                                        | Error problem -> return Error problem
                                        | Ok fetchedReadmes ->
                                            let generated =
                                                fetchedReadmes
                                                |> List.choose (fun (repository, readme) ->
                                                    match projectFromRepository repository readme with
                                                    | Ok project -> Some project
                                                    | Error _ -> None)

                                            return
                                                ContentDomain.Projects.tryCreate
                                                    (repositorySource contentRepositoryData manifestPath sourceUrl)
                                                    metadata
                                                    (curatedProjects @ generated)
                                                |> Result.mapError mapValidationFailure
                            | Error _, _, _
                            | _, Error _, _
                            | _, _, Error _ -> return Error(invalidProblem ())
            }

        let parseRecentActivity (body: string) : Result<(string * string) list, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Array then
                    Error "Activity responses must be arrays."
                else
                    root.EnumerateArray()
                    |> Seq.choose (fun event ->
                        match property "repo" event with
                        | Some repository when repository.ValueKind = JsonValueKind.Object ->
                            match requiredString "type" event, requiredString "name" repository with
                            | Ok kind, Ok repositoryName -> Some(kind, repositoryName)
                            | _ -> None
                        | _ -> None)
                    |> Seq.truncate 6
                    |> Seq.toList
                    |> Ok)

        let parseRelease (element: JsonElement) : Result<ReleaseData option, string> =
            match requiredBoolean "draft" element, requiredBoolean "prerelease" element with
            | Ok true, _
            | _, Ok true -> Ok None
            | Ok false, Ok false ->
                match
                    requiredString "tag_name" element,
                    optionalString "name" element,
                    requiredString "published_at" element,
                    optionalString "body" element,
                    requiredString "html_url" element
                with
                | Ok tag, Ok name, Ok publishedAt, Ok body, Ok url ->
                    match
                        toDomainResult (ContentDomain.ContentTag.tryCreate "release.tag" tag),
                        toDomainResult (
                            ContentDomain.ContentTitle.tryCreate "release.name" (name |> Option.defaultValue tag)
                        ),
                        toDateTimeOffset "release.published_at" publishedAt,
                        toDomainResult (ContentDomain.ContentUrl.tryCreate "release.url" url)
                    with
                    | Ok parsedTag, Ok parsedName, Ok parsedPublishedAt, Ok parsedUrl ->
                        Ok(
                            Some
                                { ReleaseTag = parsedTag
                                  ReleaseName = parsedName
                                  ReleasePublishedAt = parsedPublishedAt
                                  ReleaseBody = body |> Option.defaultValue ""
                                  ReleaseUrl = parsedUrl }
                        )
                    | Error message, _, _, _
                    | _, Error message, _, _
                    | _, _, Error message, _
                    | _, _, _, Error message -> Error message
                | Error message, _, _, _, _
                | _, Error message, _, _, _
                | _, _, Error message, _, _
                | _, _, _, Error message, _
                | _, _, _, _, Error message -> Error message
            | Error message, _
            | _, Error message -> Error message

        let parseReleasePage (body: string) : Result<ReleaseData list, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Array then
                    Error "Release responses must be arrays."
                else
                    let entries = root.EnumerateArray() |> Seq.toList

                    if List.length entries > ContentDomain.PageItemLimit then
                        Error "Release responses cannot contain more than 100 entries."
                    else
                        let rec parseEntries pending releases =
                            match pending with
                            | [] -> Ok(List.rev releases)
                            | entry :: remaining ->
                                parseRelease entry
                                |> Result.bind (fun release ->
                                    match release with
                                    | Some value -> parseEntries remaining (value :: releases)
                                    | None -> parseEntries remaining releases)

                        parseEntries entries [])

        let getPublishedReleases (repository: GitHubRepositoryData) cancellationToken =
            let firstPage =
                apiUri
                    $"repos/{repositoryName repository.RepositoryFullName}/releases?per_page={ContentDomain.PageItemLimit}"

            let rec getPages next pageCount collected =
                task {
                    if List.length collected >= ContentDomain.PageItemLimit then
                        return Ok(List.truncate ContentDomain.PageItemLimit collected)
                    else
                        match next with
                        | None -> return Ok collected
                        | Some _ when pageCount = maximumPaginationPages -> return Ok collected
                        | Some uri ->
                            let! payload = getJson uri cancellationToken

                            match payload with
                            | Error failure -> return Error(mapFetchFailure failure)
                            | Ok response ->
                                match parseReleasePage response.PayloadBody with
                                | Error _ -> return Error(invalidProblem ())
                                | Ok releases ->
                                    return! getPages response.PayloadNextPage (pageCount + 1) (collected @ releases)
                }

            task {
                let! firstPayload = getJson firstPage cancellationToken

                match firstPayload with
                | Error failure -> return Error(mapFetchFailure failure)
                | Ok firstResponse ->
                    match parseReleasePage firstResponse.PayloadBody with
                    | Error _ -> return Error(invalidProblem ())
                    | Ok firstReleases ->
                        let! releases = getPages firstResponse.PayloadNextPage 1 firstReleases

                        return releases |> Result.map (fun values -> values, firstResponse)
            }

        let nowRepositoryLine (repository: GitHubRepositoryData) =
            let name = repositoryName repository.RepositoryFullName
            let url = ContentDomain.ContentUrl.value repository.RepositoryUrl

            match repository.RepositoryDescription |> Option.map firstLine with
            | Some description when not (String.IsNullOrWhiteSpace description) -> $"- [{name}]({url}) — {description}"
            | _ -> $"- [{name}]({url})"

        let nowReleaseLine (release: ReleaseData) =
            let name = ContentDomain.ContentTitle.value release.ReleaseName
            let tag = ContentDomain.ContentTag.value release.ReleaseTag

            let label =
                if String.Equals(name, tag, StringComparison.Ordinal) then
                    tag
                else
                    $"{name} ({tag})"

            let url = ContentDomain.ContentUrl.value release.ReleaseUrl

            let publishedAt =
                release.ReleasePublishedAt.ToString("yyyy-MM-dd", Globalization.CultureInfo.InvariantCulture)

            $"- [{label}]({url}) — {publishedAt}"

        let nowActivityLine (kind: string, repository: string) =
            let url = $"https://github.com/{repository}"

            let action =
                match kind with
                | "CommitCommentEvent" -> "Commented on a commit in"
                | "CreateEvent" -> "Created a branch or tag in"
                | "DeleteEvent" -> "Deleted a branch or tag in"
                | "ForkEvent" -> "Forked"
                | "IssueCommentEvent" -> "Commented on an issue in"
                | "IssuesEvent" -> "Worked on an issue in"
                | "PullRequestEvent" -> "Worked on a pull request in"
                | "PullRequestReviewEvent" -> "Reviewed a pull request in"
                | "PullRequestReviewCommentEvent" -> "Commented on a pull request in"
                | "PushEvent" -> "Pushed commits to"
                | "ReleaseEvent" -> "Published a release in"
                | "WatchEvent" -> "Starred"
                | _ -> $"{kind} in"

            $"- {action} [{repository}]({url})"

        let nowSection heading emptyMessage lines =
            [ ""; $"## {heading}"; "" ]
            @ if List.isEmpty lines then [ emptyMessage ] else lines

        let getNowFromGitHub cancellationToken =
            task {
                let applicationRepository =
                    GitHubContentConfiguration.applicationRepository configuration

                let! repository = getRepository applicationRepository cancellationToken

                match repository with
                | Error problem -> return Error problem
                | Ok applicationRepositoryData ->
                    let activityUri =
                        apiUri
                            $"users/{Uri.EscapeDataString(GitHubContentConfiguration.owner configuration)}/events/public?per_page={ContentDomain.PageItemLimit}"

                    let! activityPayload = getJson activityUri cancellationToken
                    let! profileReadme = getProfileReadme cancellationToken
                    let! repositories = getOwnedRepositories cancellationToken
                    let! releases = getPublishedReleases applicationRepositoryData cancellationToken

                    match activityPayload, profileReadme, repositories, releases with
                    | Error failure, _, _, _ -> return Error(mapFetchFailure failure)
                    | _, Error problem, _, _
                    | _, _, Error problem, _
                    | _, _, _, Error problem -> return Error problem
                    | Ok activityResponse, Ok profileReadme, Ok repositories, Ok(releases, _) ->
                        match
                            parseRecentActivity activityResponse.PayloadBody,
                            cacheMetadata activityResponse,
                            ContentDomain.RepositoryPath.tryCreate "now.path" "events",
                            ContentDomain.ContentTitle.tryCreate "now.title" "Now"
                        with
                        | Ok activity, Ok metadata, Ok sourcePath, Ok title ->
                            let profileLines =
                                match profileReadme with
                                | Some(_, readme) when not (String.IsNullOrWhiteSpace readme.ReadmeBody) ->
                                    [ ""; "## Profile"; ""; readme.ReadmeBody.Trim() ]
                                | _ -> []

                            let repositoryLines = repositories |> List.truncate 6 |> List.map nowRepositoryLine

                            let releaseLines = releases |> List.truncate 6 |> List.map nowReleaseLine
                            let activityLines = activity |> List.map nowActivityLine

                            let body =
                                [ "# Now" ]
                                @ profileLines
                                @ nowSection
                                    "Recent repositories"
                                    "No recent public repositories are available."
                                    repositoryLines
                                @ nowSection "Recent releases" "No recent releases are available." releaseLines
                                @ nowSection
                                    "Recent public activity"
                                    "No recent public activity is available."
                                    activityLines
                                |> String.concat "\n"

                            match ContentDomain.MarkdownBody.tryCreate "now.body" body with
                            | Error failure -> return Error(mapValidationFailure failure)
                            | Ok markdown ->
                                let! preview =
                                    match profileReadme with
                                    | Some(profileRepository, readme) ->
                                        match ContentDomain.RepositoryPath.tryCreate "profile.path" "README.md" with
                                        | Error failure -> Task.FromResult(Error(mapValidationFailure failure))
                                        | Ok profilePath ->
                                            renderMarkdownPreview
                                                profileRepository
                                                profilePath
                                                readme.ReadmeRevision
                                                body
                                                cancellationToken
                                    | None ->
                                        match ContentDomain.RepositoryPath.tryCreate "now.render_path" "README.md" with
                                        | Error failure -> Task.FromResult(Error(mapValidationFailure failure))
                                        | Ok renderPath ->
                                            renderMarkdownPreview
                                                applicationRepositoryData
                                                renderPath
                                                (ContentDomain.ContentRevision.value
                                                    applicationRepositoryData.RepositoryDefaultBranch)
                                                body
                                                cancellationToken

                                match preview with
                                | Error problem -> return Error problem
                                | Ok rendered ->
                                    return
                                        Ok(
                                            ContentDomain.Now.create
                                                title
                                                markdown
                                                rendered
                                                applicationRepositoryData.RepositoryUpdatedAt
                                                (repositorySource
                                                    applicationRepositoryData
                                                    sourcePath
                                                    (repositoryRootUrl applicationRepositoryData))
                                                metadata
                                        )
                        | Error _, _, _, _
                        | _, Error _, _, _
                        | _, _, Error _, _
                        | _, _, _, Error _ -> return Error(invalidProblem ())
            }

        let parseCommit (element: JsonElement) : Result<ContentDomain.Commit, string> =
            if element.ValueKind <> JsonValueKind.Object then
                Error "Commit payload must be an object."
            else
                let commitPayload =
                    match property "commit" element with
                    | Some value when value.ValueKind = JsonValueKind.Object -> Ok value
                    | _ -> Error "Commit payload must be an object."

                match requiredString "sha" element, requiredString "html_url" element, commitPayload with
                | Ok sha, Ok url, Ok commit ->
                    let authorPayload =
                        match property "author" commit with
                        | Some value when value.ValueKind = JsonValueKind.Object -> Ok value
                        | _ -> Error "Commit author must be an object."

                    match requiredString "message" commit, authorPayload with
                    | Ok message, Ok author ->
                        match requiredString "date" author with
                        | Ok authoredAt ->
                            match
                                toDomainResult (ContentDomain.CommitSha.tryCreate "commit.sha" sha),
                                toDomainResult (
                                    ContentDomain.CommitSummary.tryCreate "commit.summary" (firstLine message)
                                ),
                                toDomainResult (ContentDomain.ContentUrl.tryCreate "commit.url" url),
                                toDateTimeOffset "commit.authored_at" authoredAt
                            with
                            | Ok parsedSha, Ok parsedSummary, Ok parsedUrl, Ok parsedAuthoredAt ->
                                Ok(
                                    ContentDomain.Commit.create
                                        parsedSha
                                        parsedSummary
                                        (ContentDomain.Timestamp.create parsedAuthoredAt)
                                        parsedUrl
                                )
                            | Error message, _, _, _
                            | _, Error message, _, _
                            | _, _, Error message, _
                            | _, _, _, Error message -> Error message
                        | Error message -> Error message
                    | Error message, _
                    | _, Error message -> Error message
                | Error message, _, _
                | _, Error message, _
                | _, _, Error message -> Error message

        let parseCommitEntries (entries: JsonElement list) : Result<ContentDomain.Commit list, string> =
            let rec parseEntries pending commits =
                match pending with
                | [] -> Ok(List.rev commits)
                | entry :: remaining ->
                    parseCommit entry
                    |> Result.bind (fun commit -> parseEntries remaining (commit :: commits))

            parseEntries entries []

        let parseCommitReference (field: string) (element: JsonElement) : Result<ContentDomain.CommitSha, string> =
            match property field element with
            | Some reference when reference.ValueKind = JsonValueKind.Object ->
                requiredString "sha" reference
                |> Result.bind (fun sha -> toDomainResult (ContentDomain.CommitSha.tryCreate $"{field}.sha" sha))
            | _ -> Error $"{field} must be an object."

        let getTagCommit (repository: GitHubRepositoryData) (tag: ContentDomain.ContentTag) cancellationToken =
            task {
                let fullName = repositoryName repository.RepositoryFullName
                let tagName = Uri.EscapeDataString(ContentDomain.ContentTag.value tag)
                let! reference = getJson (apiUri $"repos/{fullName}/git/ref/tags/{tagName}") cancellationToken

                match reference with
                | Error failure -> return Error(mapFetchFailure failure)
                | Ok response ->
                    match parseGitObjectReference response.PayloadBody with
                    | Error _ -> return Error(invalidProblem ())
                    | Ok("commit", commit) -> return Ok commit
                    | Ok("tag", tagObject) ->
                        let! objectPayload =
                            getJson
                                (apiUri $"repos/{fullName}/git/tags/{ContentDomain.CommitSha.value tagObject}")
                                cancellationToken

                        match objectPayload with
                        | Error failure -> return Error(mapFetchFailure failure)
                        | Ok tagPayload ->
                            match parseGitObjectReference tagPayload.PayloadBody with
                            | Ok("commit", commit) -> return Ok commit
                            | Error _
                            | Ok _ -> return Error(invalidProblem ())
                    | Ok _ -> return Error(invalidProblem ())
            }

        let parseComparisonMetadata (baseCommit: ContentDomain.CommitSha) (root: JsonElement) : Result<int, string> =
            match
                requiredString "status" root,
                requiredInteger "ahead_by" root,
                requiredInteger "behind_by" root,
                parseCommitReference "base_commit" root,
                parseCommitReference "merge_base_commit" root
            with
            | Ok status, Ok aheadBy, Ok behindBy, Ok responseBase, Ok mergeBase ->
                if status <> "ahead" && status <> "identical" then
                    Error "Comparison does not describe an ancestor range."
                elif aheadBy < 0 || behindBy < 0 then
                    Error "Comparison ancestry metadata cannot be negative."
                elif behindBy <> 0 || responseBase <> baseCommit || mergeBase <> baseCommit then
                    Error "Comparison boundaries do not match the requested ancestor range."
                elif status = "identical" && aheadBy <> 0 then
                    Error "An identical comparison cannot be ahead of its base."
                elif status = "ahead" && aheadBy = 0 then
                    Error "An ahead comparison must have commits after its base."
                else
                    Ok aheadBy
            | Error message, _, _, _, _
            | _, Error message, _, _, _
            | _, _, Error message, _, _
            | _, _, _, Error message, _
            | _, _, _, _, Error message -> Error message

        let parseComparisonAncestry (baseCommit: ContentDomain.CommitSha) (body: string) : Result<int, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Object then
                    Error "Comparison responses must be objects."
                else
                    parseComparisonMetadata baseCommit root)

        let parseComparison
            (baseCommit: ContentDomain.CommitSha)
            (body: string)
            : Result<ContentDomain.Commit list, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Object then
                    Error "Comparison responses must be objects."
                else
                    let commits =
                        match property "commits" root with
                        | Some value when value.ValueKind = JsonValueKind.Array ->
                            Ok(value.EnumerateArray() |> Seq.toList)
                        | _ -> Error "Comparison commits must be an array."

                    match parseComparisonMetadata baseCommit root, requiredInteger "total_commits" root, commits with
                    | Ok _, Ok totalCommits, Ok entries ->
                        if
                            totalCommits < 0
                            || totalCommits > ContentDomain.PageItemLimit
                            || totalCommits <> List.length entries
                            || List.length entries > ContentDomain.PageItemLimit
                        then
                            Error "Comparison exceeds the changelog commit bound."
                        else
                            parseCommitEntries entries
                    | Error message, _, _
                    | _, Error message, _
                    | _, _, Error message -> Error message)

        let getComparison
            (repository: GitHubRepositoryData)
            (baseCommit: ContentDomain.CommitSha)
            (headCommit: ContentDomain.CommitSha)
            cancellationToken
            =
            task {
                let fullName = repositoryName repository.RepositoryFullName

                let comparison =
                    apiUri
                        $"repos/{fullName}/compare/{ContentDomain.CommitSha.value baseCommit}...{ContentDomain.CommitSha.value headCommit}?per_page={ContentDomain.PageItemLimit}"

                let! payload = getJson comparison cancellationToken

                match payload with
                | Error failure -> return Error(mapFetchFailure failure)
                | Ok response -> return Ok response
            }

        let commitRangeFromComparison (baseCommit: ContentDomain.CommitSha) (response: GitHubPayload) =
            match response.PayloadNextPage with
            | Some _ -> Error(invalidProblem ())
            | None ->
                parseComparison baseCommit response.PayloadBody
                |> Result.map List.rev
                |> Result.mapError (fun _ -> invalidProblem ())

        let getCommitRange
            (repository: GitHubRepositoryData)
            (baseCommit: ContentDomain.CommitSha)
            (headCommit: ContentDomain.CommitSha)
            cancellationToken
            =
            task {
                let! payload = getComparison repository baseCommit headCommit cancellationToken

                match payload with
                | Error problem -> return Error problem
                | Ok response -> return commitRangeFromComparison baseCommit response
            }

        let resolveReleaseBoundaries (repository: GitHubRepositoryData) (releases: ReleaseData list) cancellationToken =
            let rec resolve pending collected =
                task {
                    match pending with
                    | [] -> return Ok(List.rev collected)
                    | release :: remaining ->
                        let! commit = getTagCommit repository release.ReleaseTag cancellationToken

                        match commit with
                        | Error problem -> return Error problem
                        | Ok boundary ->
                            return!
                                resolve
                                    remaining
                                    ({ BoundaryRelease = release
                                       BoundaryCommit = boundary }
                                     :: collected)
                }

            resolve releases []

        let getReleaseHeadComparison
            (repository: GitHubRepositoryData)
            (boundary: ReleaseBoundary)
            (head: ContentDomain.CommitSha)
            cancellationToken
            =
            task {
                let! payload = getComparison repository boundary.BoundaryCommit head cancellationToken

                match payload with
                | Error problem -> return Error problem
                | Ok response ->
                    match parseComparisonAncestry boundary.BoundaryCommit response.PayloadBody with
                    | Error _ -> return Error(invalidProblem ())
                    | Ok aheadBy ->
                        return
                            Ok
                                { ComparisonBoundary = boundary
                                  ComparisonAheadBy = aheadBy
                                  ComparisonPayload = response }
            }

        let orderReleaseHeadComparisons (comparisons: ReleaseHeadComparison list) =
            let ordered =
                comparisons
                |> List.sortWith (fun left right ->
                    let ancestryOrder = compare left.ComparisonAheadBy right.ComparisonAheadBy

                    if ancestryOrder <> 0 then
                        ancestryOrder
                    else
                        StringComparer.Ordinal.Compare(
                            ContentDomain.ContentTag.value left.ComparisonBoundary.BoundaryRelease.ReleaseTag,
                            ContentDomain.ContentTag.value right.ComparisonBoundary.BoundaryRelease.ReleaseTag
                        ))

            let rec hasAmbiguousPositions pendingComparisons =
                match pendingComparisons with
                | left :: right :: remaining ->
                    if
                        left.ComparisonAheadBy = right.ComparisonAheadBy
                        && not (
                            StringComparer.Ordinal.Equals(
                                ContentDomain.CommitSha.value left.ComparisonBoundary.BoundaryCommit,
                                ContentDomain.CommitSha.value right.ComparisonBoundary.BoundaryCommit
                            )
                        )
                    then
                        true
                    else
                        hasAmbiguousPositions (right :: remaining)
                | _ -> false

            if hasAmbiguousPositions ordered then
                Error(invalidProblem ())
            else
                Ok ordered

        let orderReleaseBoundariesByHeadAncestry
            (repository: GitHubRepositoryData)
            (head: ContentDomain.CommitSha)
            (boundaries: ReleaseBoundary list)
            cancellationToken
            =
            let rec compareToHead pending comparisons =
                task {
                    match pending with
                    | [] -> return orderReleaseHeadComparisons comparisons
                    | boundary :: remaining ->
                        let! comparison = getReleaseHeadComparison repository boundary head cancellationToken

                        match comparison with
                        | Error problem -> return Error problem
                        | Ok value -> return! compareToHead remaining (value :: comparisons)
                }

            compareToHead boundaries []

        let getReleaseRanges (repository: GitHubRepositoryData) (boundaries: ReleaseBoundary list) cancellationToken =
            let rec getRanges pending =
                task {
                    match pending with
                    | [] -> return Ok []
                    | [ oldest ] -> return Ok [ (oldest.BoundaryRelease, []) ]
                    | newer :: older :: remaining ->
                        let! commits =
                            getCommitRange repository older.BoundaryCommit newer.BoundaryCommit cancellationToken

                        match commits with
                        | Error problem -> return Error problem
                        | Ok range ->
                            let! olderRanges = getRanges (older :: remaining)

                            match olderRanges with
                            | Error problem -> return Error problem
                            | Ok ranges -> return Ok((newer.BoundaryRelease, range) :: ranges)
                }

            getRanges boundaries

        let buildChangelog
            (repository: GitHubRepositoryData)
            (releaseRanges: (ReleaseData * ContentDomain.Commit list) list)
            (unreleased: ContentDomain.Commit list)
            (metadata: ContentDomain.CacheMetadata)
            (preview: ContentDomain.RenderedHtml)
            =
            let createRelease (release: ReleaseData, commits: ContentDomain.Commit list) =
                ContentDomain.Release.tryCreate
                    release.ReleaseTag
                    release.ReleaseName
                    (ContentDomain.Timestamp.create release.ReleasePublishedAt)
                    release.ReleaseBody
                    release.ReleaseUrl
                    commits

            let rec createReleases pending collected =
                match pending with
                | [] -> Ok(List.rev collected)
                | release :: remaining ->
                    createRelease release
                    |> Result.bind (fun validRelease -> createReleases remaining (validRelease :: collected))

            match ContentDomain.RepositoryPath.tryCreate "changelog.path" "releases" with
            | Error failure -> Error(mapValidationFailure failure)
            | Ok sourcePath ->
                createReleases releaseRanges []
                |> Result.mapError mapValidationFailure
                |> Result.bind (fun releaseGroups ->
                    ContentDomain.Changelog.tryCreate
                        (repositorySource repository sourcePath (repositoryRootUrl repository))
                        metadata
                        unreleased
                        releaseGroups
                        preview
                    |> Result.mapError mapValidationFailure)

        let changelogMarkdown
            (releaseRanges: (ReleaseData * ContentDomain.Commit list) list)
            (unreleased: ContentDomain.Commit list)
            =
            let commitLine commit =
                let summary = commit |> ContentDomain.Commit.summary |> ContentDomain.CommitSummary.value
                let sha = commit |> ContentDomain.Commit.sha |> ContentDomain.CommitSha.value
                $"- {summary} ({sha.Substring(0, 7)})"

            let lines = ResizeArray<string>([ "# Changelog"; ""; "## Unreleased" ])

            for commit in unreleased do
                lines.Add(commitLine commit)

            for release, commits in releaseRanges do
                let name = ContentDomain.ContentTitle.value release.ReleaseName
                let tag = ContentDomain.ContentTag.value release.ReleaseTag
                lines.Add("")
                lines.Add($"## {name} ({tag})")

                if not (String.IsNullOrEmpty release.ReleaseBody) then
                    lines.Add("")
                    lines.Add(release.ReleaseBody)

                for commit in commits do
                    lines.Add(commitLine commit)

            String.Join("\n", lines)

        let completeChangelog repository releaseRanges unreleased metadata cancellationToken =
            task {
                match ContentDomain.RepositoryPath.tryCreate "changelog.render_path" "README.md" with
                | Error failure -> return Error(mapValidationFailure failure)
                | Ok renderPath ->
                    let markdown = changelogMarkdown releaseRanges unreleased

                    let! preview =
                        renderMarkdownPreview
                            repository
                            renderPath
                            (ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch)
                            markdown
                            cancellationToken

                    return
                        preview
                        |> Result.bind (fun rendered ->
                            buildChangelog repository releaseRanges unreleased metadata rendered)
            }

        let getChangelogFromGitHub cancellationToken =
            task {
                let applicationRepository =
                    GitHubContentConfiguration.applicationRepository configuration

                let! repository = getRepository applicationRepository cancellationToken

                match repository with
                | Error problem -> return Error problem
                | Ok applicationRepositoryData ->
                    let! releases = getPublishedReleases applicationRepositoryData cancellationToken

                    match releases with
                    | Error problem -> return Error problem
                    | Ok(parsedReleases, releasePayload) ->
                        match cacheMetadata releasePayload with
                        | Error problem -> return Error problem
                        | Ok metadata ->
                            match parsedReleases with
                            | [] ->
                                return!
                                    completeChangelog applicationRepositoryData [] [] metadata cancellationToken
                            | _ ->
                                let! boundaries =
                                    resolveReleaseBoundaries applicationRepositoryData parsedReleases cancellationToken

                                match boundaries with
                                | Error problem -> return Error problem
                                | Ok resolvedBoundaries ->
                                    let! defaultHead = getDefaultBranchHead applicationRepositoryData cancellationToken

                                    match defaultHead with
                                    | Error problem -> return Error problem
                                    | Ok head ->
                                        let! orderedComparisons =
                                            orderReleaseBoundariesByHeadAncestry
                                                applicationRepositoryData
                                                head
                                                resolvedBoundaries
                                                cancellationToken

                                        match orderedComparisons with
                                        | Error problem -> return Error problem
                                        | Ok [] -> return Error(invalidProblem ())
                                        | Ok(newest :: remaining) ->
                                            match
                                                commitRangeFromComparison
                                                    newest.ComparisonBoundary.BoundaryCommit
                                                    newest.ComparisonPayload
                                            with
                                            | Error problem -> return Error problem
                                            | Ok unreleasedCommits ->
                                                let boundaries =
                                                    newest.ComparisonBoundary
                                                    :: (remaining
                                                        |> List.map (fun comparison -> comparison.ComparisonBoundary))

                                                let! releaseRanges =
                                                    getReleaseRanges
                                                        applicationRepositoryData
                                                        boundaries
                                                        cancellationToken

                                                match releaseRanges with
                                                | Error problem -> return Error problem
                                                | Ok ranges ->
                                                    return!
                                                        completeChangelog
                                                            applicationRepositoryData
                                                            ranges
                                                            unreleasedCommits
                                                            metadata
                                                            cancellationToken
            }

        { new ContentClient with
            member _.GetRepositoryBase cancellationToken =
                task {
                    let! repository =
                        getRepository (GitHubContentConfiguration.contentRepository configuration) cancellationToken

                    match repository with
                    | Error problem -> return Error problem
                    | Ok value ->
                        let! head = getDefaultBranchHead value cancellationToken

                        match head with
                        | Error problem -> return Error problem
                        | Ok headSha ->
                            match
                                ContentDomain.ContentRevision.tryCreate
                                    "repository.head_sha"
                                    (ContentDomain.CommitSha.value headSha)
                            with
                            | Error failure -> return Error(mapValidationFailure failure)
                            | Ok revision ->
                                let repositoryBase: ContentDomain.RepositoryBase =
                                    { DefaultBranch = value.RepositoryDefaultBranch
                                      Head = revision }

                                return Ok repositoryBase
                }

            member _.GetCatalog cancellationToken =
                task {
                    let! input = getCatalogInput cancellationToken
                    return input |> Result.bind catalogFromInput
                }

            member _.GetDocument(documentId, cancellationToken) =
                task {
                    let! catalogInput = getCatalogInput cancellationToken

                    match catalogInput with
                    | Error problem -> return Error problem
                    | Ok input ->
                        match
                            Map.tryFind
                                (ContentDomain.ContentId.value documentId)
                                input.CatalogManifest.ManifestDocumentsById
                        with
                        | None ->
                            return
                                Error(
                                    ContentDomain.Problem.create
                                        ContentDomain.NotFound
                                        "The requested document identifier is not in the catalog."
                                )
                        | Some locator ->
                            let repositoryPath = ContentDomain.RepositoryPath.value locator.ManifestDocumentPath

                            let isPublication =
                                repositoryPath.StartsWith("blog/", StringComparison.Ordinal)
                                || repositoryPath.StartsWith("notes/", StringComparison.Ordinal)

                            if isPublication then
                                let! head = getDefaultBranchHead input.CatalogRepository cancellationToken

                                match head with
                                | Error problem -> return Error problem
                                | Ok headSha ->
                                    let fullName = repositoryName input.CatalogRepository.RepositoryFullName
                                    let revision = Uri.EscapeDataString(ContentDomain.CommitSha.value headSha)

                                    let! payload =
                                        getJson
                                            (apiUri
                                                $"repos/{fullName}/contents/{encodeRepositoryPath locator.ManifestDocumentPath}?ref={revision}")
                                            cancellationToken

                                    match payload with
                                    | Error failure -> return Error(mapFetchFailure failure)
                                    | Ok response ->
                                        let parsed =
                                            parseJson response.PayloadBody (fun root ->
                                                match
                                                    requiredString "sha" root,
                                                    requiredString "encoding" root,
                                                    requiredString "content" root
                                                with
                                                | Ok blob, Ok "base64", Ok encoded ->
                                                    try
                                                        Ok(
                                                            blob,
                                                            Encoding.UTF8.GetString(
                                                                Convert.FromBase64String(
                                                                    encoded.Replace("\n", "", StringComparison.Ordinal)
                                                                )
                                                            )
                                                        )
                                                    with :? FormatException ->
                                                        Error "Document content must be valid base64."
                                                | Ok _, Ok _, Ok _ -> Error "Document content encoding must be base64."
                                                | Error message, _, _
                                                | _, Error message, _
                                                | _, _, Error message -> Error message)

                                        match parsed with
                                        | Error _ -> return Error(invalidProblem ())
                                        | Ok(blobValue, markdown) ->
                                            match
                                                ContentDomain.ContentRevision.tryCreate
                                                    "document.head_sha"
                                                    (ContentDomain.CommitSha.value headSha),
                                                ContentDomain.ContentRevision.tryCreate "document.blob_sha" blobValue
                                            with
                                            | Error _, _
                                            | _, Error _ -> return Error(invalidProblem ())
                                            | Ok documentHead, Ok blobSha ->
                                                let! preview =
                                                    readFileHtml
                                                        input.CatalogRepository
                                                        locator.ManifestDocumentPath
                                                        revision
                                                        cancellationToken

                                                match preview with
                                                | Error problem -> return Error problem
                                                | Ok rendered ->
                                                    return
                                                        buildDocument
                                                            input.CatalogRepository
                                                            documentId
                                                            locator.ManifestDocumentPath
                                                            locator.ManifestVirtualPath
                                                            locator.ManifestUpdatedAt
                                                            response
                                                            (Some(documentHead, blobSha))
                                                            markdown
                                                            rendered
                            else
                                let! head = getDefaultBranchHead input.CatalogRepository cancellationToken

                                match head with
                                | Error problem -> return Error problem
                                | Ok headSha ->
                                    let revision = ContentDomain.CommitSha.value headSha

                                    let! payload =
                                        readFileAtRevision
                                            input.CatalogRepository
                                            locator.ManifestDocumentPath
                                            revision
                                            cancellationToken

                                    match payload with
                                    | Ok documentPayload ->
                                        let! preview =
                                            readFileHtml
                                                input.CatalogRepository
                                                locator.ManifestDocumentPath
                                                revision
                                                cancellationToken

                                        match preview with
                                        | Error problem -> return Error problem
                                        | Ok rendered ->
                                            return
                                                buildDocument
                                                    input.CatalogRepository
                                                    documentId
                                                    locator.ManifestDocumentPath
                                                    locator.ManifestVirtualPath
                                                    locator.ManifestUpdatedAt
                                                    documentPayload
                                                    None
                                                    documentPayload.PayloadBody
                                                    rendered
                                    | Error Missing when ContentDomain.ContentId.value documentId = "about" ->
                                        let! profile = getProfileReadme cancellationToken

                                        match profile with
                                        | Error problem -> return Error problem
                                        | Ok None ->
                                            return
                                                Error(
                                                    ContentDomain.Problem.create
                                                        ContentDomain.NotFound
                                                        "The requested document was not found."
                                                )
                                        | Ok(Some(profileRepository, readme)) ->
                                            match ContentDomain.RepositoryPath.tryCreate "profile.path" "README.md" with
                                            | Error failure -> return Error(mapValidationFailure failure)
                                            | Ok profilePath ->
                                                let profileMarkdown =
                                                    String.concat
                                                        "\n"
                                                        [ "---"
                                                          "title = \"About\""
                                                          "---"
                                                          readme.ReadmeBody ]

                                                return
                                                    buildDocument
                                                        profileRepository
                                                        documentId
                                                        profilePath
                                                        locator.ManifestVirtualPath
                                                        locator.ManifestUpdatedAt
                                                        readme.ReadmePayload
                                                        None
                                                        profileMarkdown
                                                        readme.ReadmeRenderedHtml
                                    | Error failure -> return Error(mapFetchFailure failure)
                }

            member _.GetProjects cancellationToken = getProjectsFromGitHub cancellationToken

            member _.GetNow cancellationToken = getNowFromGitHub cancellationToken

            member _.GetChangelog cancellationToken =
                getChangelogFromGitHub cancellationToken }

    let create httpClient configuration clock =
        createWithGeneration httpClient configuration clock (ContentCacheGeneration())
