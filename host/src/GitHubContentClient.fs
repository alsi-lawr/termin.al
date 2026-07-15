namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.Collections.Generic
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Configuration

type GitHubContentConfiguration =
    private
        { ConfiguredOwner: string
          ConfiguredContentRepository: ContentDomain.RepositoryName
          ConfiguredApplicationRepository: ContentDomain.RepositoryName
          ConfiguredProfileRepository: ContentDomain.RepositoryName }

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
                              ConfiguredProfileRepository = validProfileRepository }))))

    let owner (configuration: GitHubContentConfiguration) = configuration.ConfiguredOwner

    let contentRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredContentRepository

    let applicationRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredApplicationRepository

    let profileRepository (configuration: GitHubContentConfiguration) =
        configuration.ConfiguredProfileRepository

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

    type private ManifestDocument =
        { ManifestDocumentPath: ContentDomain.RepositoryPath
          ManifestVirtualPath: ContentDomain.VirtualPath }

    type private ManifestData =
        { ManifestCatalogEntries: ContentDomain.CatalogEntry list
          ManifestDocumentsById: Map<string, ManifestDocument> }

    type private CatalogInput =
        { CatalogRepository: GitHubRepositoryData
          CatalogManifest: ManifestData
          CatalogManifestPath: ContentDomain.RepositoryPath
          CatalogManifestPayload: GitHubPayload }

    type private ReleaseData =
        { ReleaseTag: ContentDomain.ContentTag
          ReleaseName: ContentDomain.ContentTitle
          ReleasePublishedAt: DateTimeOffset
          ReleaseBody: string
          ReleaseUrl: ContentDomain.ContentUrl }

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
    let private maximumPaginationPages = 3
    let private maximumPayloadCacheEntries = 512

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

    let create
        (httpClient: HttpClient)
        (configuration: GitHubContentConfiguration)
        (clock: unit -> DateTimeOffset)
        : ContentClient =
        let cache = ConcurrentDictionary<string, CachedPayload>(StringComparer.Ordinal)
        let cacheLock = obj ()

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

        let findCachedPayload now cacheKey =
            lock cacheLock (fun () ->
                removeExpiredCachedPayloads now

                match cache.TryGetValue(cacheKey) with
                | true, value -> Some value
                | false, _ -> None)

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

        let fetch
            (uri: Uri)
            (accept: string)
            (cancellationToken: CancellationToken)
            : Task<Result<GitHubPayload, FetchFailure>> =
            task {
                let now = clock ()
                let cacheKey = $"{accept}|{uri.AbsoluteUri}"

                let cached = findCachedPayload now cacheKey

                match cached with
                | Some value when now <= value.CachedAt.AddMinutes(float ContentDomain.FreshCacheMinutes) ->
                    return
                        Ok
                            { PayloadBody = value.CachedBody
                              PayloadFetchedAt = value.CachedAt
                              PayloadCacheState = ContentDomain.Fresh
                              PayloadNextPage = value.CachedNextPage }
                | _ ->
                    use timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken)
                    timeout.CancelAfter(TimeSpan.FromSeconds(float ContentDomain.GitHubTimeoutSeconds))
                    use request = new HttpRequestMessage(HttpMethod.Get, uri)
                    request.Headers.Accept.ParseAdd(accept)
                    request.Headers.UserAgent.ParseAdd(userAgent)
                    request.Headers.Add("X-GitHub-Api-Version", apiVersion)

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

                            if Encoding.UTF8.GetByteCount(body) > ContentDomain.DocumentByteLimit then
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
                    | :? OperationCanceledException as error when cancellationToken.IsCancellationRequested ->
                        return! Task.FromCanceled<Result<GitHubPayload, FetchFailure>>(error.CancellationToken)
                    | :? OperationCanceledException
                    | :? HttpRequestException ->
                        match cached with
                        | Some value -> return stale now value Unavailable
                        | None -> return Error Unavailable
            }

        let getJson uri cancellationToken =
            fetch uri jsonMediaType cancellationToken

        let getRaw uri cancellationToken =
            fetch uri rawMediaType cancellationToken

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

        let readFile (repository: GitHubRepositoryData) (path: ContentDomain.RepositoryPath) cancellationToken =
            let branch =
                Uri.EscapeDataString(ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch)

            let uri =
                apiUri
                    $"repos/{repositoryName repository.RepositoryFullName}/contents/{encodeRepositoryPath path}?ref={branch}"

            getRaw uri cancellationToken

        let readReadme (repository: GitHubRepositoryData) cancellationToken =
            let branch =
                Uri.EscapeDataString(ContentDomain.ContentRevision.value repository.RepositoryDefaultBranch)

            let uri =
                apiUri $"repos/{repositoryName repository.RepositoryFullName}/readme?ref={branch}"

            getRaw uri cancellationToken

        let invalidProblem () =
            ContentDomain.Problem.create ContentDomain.UpstreamUnavailable "GitHub returned invalid public content."

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
                        | Some expectedName when parsedName <> expectedName ->
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

        let parseManifest (body: string) : Result<ManifestData, string> =
            let parseEntry (element: JsonElement) =
                if element.ValueKind <> JsonValueKind.Object then
                    Error "Catalog entries must be objects."
                else
                    match requiredString "kind" element with
                    | Error message -> Error message
                    | Ok kind ->
                        let expected =
                            match kind with
                            | "directory"
                            | "locked-file" -> [ "kind"; "id"; "path"; "updatedAt"; "size" ]
                            | "file" -> [ "kind"; "id"; "path"; "updatedAt"; "size"; "documentHandle"; "sourcePath" ]
                            | _ -> []

                        if List.isEmpty expected || not (hasOnlyProperties expected element) then
                            Error "Catalog entry fields are invalid."
                        else
                            match
                                requiredString "id" element,
                                requiredString "path" element,
                                requiredString "updatedAt" element,
                                requiredInteger "size" element
                            with
                            | Ok id, Ok path, Ok updatedAt, Ok size ->
                                match
                                    toDomainResult (ContentDomain.CatalogId.tryCreate "catalog.id" id),
                                    toDomainResult (ContentDomain.VirtualPath.tryCreate "catalog.path" path),
                                    toTimestamp "catalog.updatedAt" updatedAt,
                                    toDomainResult (ContentDomain.ByteSize.tryCreate "catalog.size" size)
                                with
                                | Ok parsedId, Ok parsedPath, Ok parsedUpdatedAt, Ok parsedSize ->
                                    match kind with
                                    | "directory" ->
                                        Ok(
                                            ContentDomain.Directory(parsedId, parsedPath, parsedUpdatedAt, parsedSize),
                                            None
                                        )
                                    | "locked-file" ->
                                        Ok(
                                            ContentDomain.LockedFile(parsedId, parsedPath, parsedUpdatedAt, parsedSize),
                                            None
                                        )
                                    | "file" ->
                                        match
                                            requiredString "documentHandle" element, requiredString "sourcePath" element
                                        with
                                        | Ok handle, Ok sourcePath ->
                                            match
                                                toDomainResult (
                                                    ContentDomain.ContentId.tryCreate "catalog.documentHandle" handle
                                                ),
                                                toDomainResult (
                                                    ContentDomain.RepositoryPath.tryCreate
                                                        "catalog.sourcePath"
                                                        sourcePath
                                                )
                                            with
                                            | Ok parsedHandle, Ok parsedSourcePath ->
                                                Ok(
                                                    ContentDomain.File(
                                                        parsedId,
                                                        parsedPath,
                                                        parsedUpdatedAt,
                                                        parsedSize,
                                                        parsedHandle
                                                    ),
                                                    Some(
                                                        ContentDomain.ContentId.value parsedHandle,
                                                        { ManifestDocumentPath = parsedSourcePath
                                                          ManifestVirtualPath = parsedPath }
                                                    )
                                                )
                                            | Error message, _
                                            | _, Error message -> Error message
                                        | Error message, _
                                        | _, Error message -> Error message
                                    | _ -> Error "Catalog entry kind is invalid."
                                | Error message, _, _, _
                                | _, Error message, _, _
                                | _, _, Error message, _
                                | _, _, _, Error message -> Error message
                            | Error message, _, _, _
                            | _, Error message, _, _
                            | _, _, Error message, _
                            | _, _, _, Error message -> Error message

            parseJson body (fun root ->
                match property "entries" root with
                | Some entries when
                    root.ValueKind = JsonValueKind.Object
                    && hasOnlyProperties [ "entries" ] root
                    && entries.ValueKind = JsonValueKind.Array
                    ->
                    let rawEntries = entries.EnumerateArray() |> Seq.toList

                    if List.length rawEntries > ContentDomain.PageItemLimit then
                        Error "Catalog has too many entries."
                    else
                        let rec parseEntries pending parsedEntries documents =
                            match pending with
                            | [] ->
                                Ok
                                    { ManifestCatalogEntries = List.rev parsedEntries
                                      ManifestDocumentsById = documents }
                            | entry :: remaining ->
                                parseEntry entry
                                |> Result.bind (fun (catalogEntry, document) ->
                                    match document with
                                    | None -> parseEntries remaining (catalogEntry :: parsedEntries) documents
                                    | Some(documentId, locator) ->
                                        if Map.containsKey documentId documents then
                                            Error "Catalog document handles are duplicated."
                                        else
                                            parseEntries
                                                remaining
                                                (catalogEntry :: parsedEntries)
                                                (Map.add documentId locator documents))

                        parseEntries rawEntries [] Map.empty
                | _ -> Error "Catalog manifests must contain only entries.")

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
                            match parseManifest manifestPayload.PayloadBody with
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
            (documentPath: ContentDomain.RepositoryPath)
            (virtualPath: ContentDomain.VirtualPath)
            (payload: GitHubPayload)
            (markdown: string)
            =
            match documentUrl repository documentPath, cacheMetadata payload with
            | Ok url, Ok metadata ->
                ContentDomain.ContentDocument.tryCreate
                    virtualPath
                    (repositorySource repository documentPath url)
                    metadata
                    markdown
                |> Result.mapError mapValidationFailure
            | Error problem, _
            | _, Error problem -> Error problem

        let getOptionalReadme (repository: GitHubRepositoryData) cancellationToken =
            task {
                let! payload = readReadme repository cancellationToken

                match payload with
                | Ok value -> return Ok(Some(value.PayloadBody, value))
                | Error Missing -> return Ok None
                | Error failure -> return Error(mapFetchFailure failure)
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
                    | Ok(Some(body, payload)) -> return Ok(Some(profileRepositoryData, body, payload))
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

        let projectFromRepository (repository: GitHubRepositoryData) (readme: string option) =
            let fullName = repositoryName repository.RepositoryFullName
            let repositoryShortName = fullName.Substring(fullName.IndexOf('/') + 1)
            let slugValue = normalizeSlug repositoryShortName

            let summary =
                readme
                |> Option.bind summaryFromMarkdown
                |> Option.orElse repository.RepositoryDescription
                |> Option.defaultValue $"Public repository {repositoryShortName}."

            match
                toDomainResult (ContentDomain.ContentSlug.tryCreate "project.slug" slugValue),
                toDomainResult (ContentDomain.ContentId.tryCreate "project.id" slugValue),
                toDomainResult (ContentDomain.ContentTitle.tryCreate "project.name" repositoryShortName),
                toDomainResult (ContentDomain.ContentSummary.tryCreate "project.summary" summary),
                toDomainResult (ContentDomain.ContentTag.tryCreate "project.tag" "github")
            with
            | Ok slug, Ok id, Ok title, Ok projectSummary, Ok tag ->
                Ok(
                    ContentDomain.Project.create
                        id
                        slug
                        title
                        projectSummary
                        repository.RepositoryUrl
                        repository.RepositoryFullName
                        repository.RepositoryUpdatedAt
                        [ tag ]
                )
            | Error message, _, _, _, _
            | _, Error message, _, _, _
            | _, _, Error message, _, _
            | _, _, _, Error message, _
            | _, _, _, _, Error message -> Error message

        let getProjectReadmes (repositories: GitHubRepositoryData list) cancellationToken =
            task {
                let mutable collected: (GitHubRepositoryData * string option) list = []
                let mutable failure: ContentDomain.Problem option = None

                for repository in repositories do
                    if failure.IsNone then
                        let! readme = getOptionalReadme repository cancellationToken

                        match readme with
                        | Error problem -> failure <- Some problem
                        | Ok value -> collected <- (repository, value |> Option.map fst) :: collected

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
                                let! ownedRepositories = getOwnedRepositories cancellationToken

                                match ownedRepositories with
                                | Error problem -> return Error problem
                                | Ok owned ->
                                    let curatedRepositories =
                                        HashSet<string>(
                                            (curated
                                             |> List.map (
                                                 ContentDomain.Project.repository >> ContentDomain.RepositoryName.value
                                             )),
                                            StringComparer.OrdinalIgnoreCase
                                        )

                                    let remainingCapacity = max 0 (ContentDomain.PageItemLimit - List.length curated)

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
                                                (curated @ generated)
                                            |> Result.mapError mapValidationFailure
                            | Error _, _, _
                            | _, Error _, _
                            | _, _, Error _ -> return Error(invalidProblem ())
            }

        let parseLatestActivity (body: string) : Result<string option, string> =
            parseJson body (fun root ->
                if root.ValueKind <> JsonValueKind.Array then
                    Error "Activity responses must be arrays."
                else
                    root.EnumerateArray()
                    |> Seq.tryPick (fun event ->
                        match property "repo" event with
                        | Some repository when repository.ValueKind = JsonValueKind.Object ->
                            match requiredString "type" event, requiredString "name" repository with
                            | Ok kind, Ok repositoryName ->
                                Some $"Latest public activity: {kind} in {repositoryName}."
                            | _ -> None
                        | _ -> None)
                    |> Ok)

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
                    let! applicationReadme = getOptionalReadme applicationRepositoryData cancellationToken
                    let! profileReadme = getProfileReadme cancellationToken

                    match activityPayload, applicationReadme, profileReadme with
                    | Error failure, _, _ -> return Error(mapFetchFailure failure)
                    | _, Error problem, _
                    | _, _, Error problem -> return Error problem
                    | Ok activityResponse, Ok applicationReadme, Ok profileReadme ->
                        match
                            parseLatestActivity activityResponse.PayloadBody,
                            cacheMetadata activityResponse,
                            ContentDomain.RepositoryPath.tryCreate "now.path" "events",
                            ContentDomain.ContentTitle.tryCreate "now.title" "Now"
                        with
                        | Ok activity, Ok metadata, Ok sourcePath, Ok title ->
                            let activityLine =
                                activity |> Option.defaultValue "No recent public activity is available."

                            let summary =
                                applicationReadme
                                |> Option.bind (fun (body, _) -> summaryFromMarkdown body)
                                |> Option.orElse (
                                    profileReadme |> Option.bind (fun (_, body, _) -> summaryFromMarkdown body)
                                )

                            let body =
                                match summary with
                                | Some value -> $"# Now\n\n{activityLine}\n\n{value}"
                                | None -> $"# Now\n\n{activityLine}"

                            match ContentDomain.MarkdownBody.tryCreate "now.body" body with
                            | Error failure -> return Error(mapValidationFailure failure)
                            | Ok markdown ->
                                return
                                    Ok(
                                        ContentDomain.Now.create
                                            title
                                            markdown
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
                    |> Result.mapError mapValidationFailure)

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
                            | [] -> return buildChangelog applicationRepositoryData [] [] metadata
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
                                                    return
                                                        buildChangelog
                                                            applicationRepositoryData
                                                            ranges
                                                            unreleasedCommits
                                                            metadata
            }

        { new ContentClient with
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
                            let! payload =
                                readFile input.CatalogRepository locator.ManifestDocumentPath cancellationToken

                            match payload with
                            | Ok documentPayload ->
                                return
                                    buildDocument
                                        input.CatalogRepository
                                        locator.ManifestDocumentPath
                                        locator.ManifestVirtualPath
                                        documentPayload
                                        documentPayload.PayloadBody
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
                                | Ok(Some(profileRepository, profileBody, profilePayload)) ->
                                    match ContentDomain.RepositoryPath.tryCreate "profile.path" "README.md" with
                                    | Error failure -> return Error(mapValidationFailure failure)
                                    | Ok profilePath ->
                                        let profileMarkdown =
                                            String.concat
                                                "\n"
                                                [ "---"
                                                  "id: about"
                                                  "title: About"
                                                  $"updatedAt: {ContentDomain.Timestamp.value (ContentDomain.Timestamp.create profilePayload.PayloadFetchedAt)}"
                                                  "---"
                                                  profileBody ]

                                        return
                                            buildDocument
                                                profileRepository
                                                profilePath
                                                locator.ManifestVirtualPath
                                                profilePayload
                                                profileMarkdown
                            | Error failure -> return Error(mapFetchFailure failure)
                }

            member _.GetProjects cancellationToken = getProjectsFromGitHub cancellationToken

            member _.GetNow cancellationToken = getNowFromGitHub cancellationToken

            member _.GetChangelog cancellationToken =
                getChangelogFromGitHub cancellationToken }
