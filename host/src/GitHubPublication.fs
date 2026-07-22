namespace Termin.Al.Host

open System
open System.Collections.Concurrent
open System.Globalization
open System.IO
open System.Net
open System.Net.Http
open System.Net.Http.Headers
open System.Net.Http.Json
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks

[<RequireQualifiedAccess>]
module GitHubPublication =
    [<RequireQualifiedAccess>]
    type Operation =
        | Add
        | Update
        | Remove

    type Asset =
        { DestinationPath: string
          DeclaredMediaType: string
          Bytes: byte array }

    type Request =
        { Operation: Operation
          RepositoryPath: string
          VirtualPath: string
          Markdown: string
          ExpectedDefaultBranch: string
          ExpectedHeadSha: string
          ExpectedBlobSha: string
          Assets: Asset list
          RemovalConfirmation: string }

    type Commit =
        { Sha: string
          Url: string
          DefaultBranch: string
          DocumentBlobSha: string }

    type Conflict =
        { LocalMarkdown: string
          UpstreamMarkdown: string
          DefaultBranch: string
          HeadSha: string
          BlobSha: string }

    [<RequireQualifiedAccess>]
    type Result =
        | Published of Commit
        | Conflict of Conflict
        | Invalid
        | Unavailable

    type Client =
        abstract Publish: Auth.OwnerAccessToken * Request * CancellationToken -> Task<Result>

    type private RepositoryState =
        { DefaultBranch: string
          HeadSha: string
          TreeSha: string }

    type private FileState = { BlobSha: string; Text: string }

    type private CatalogEntry =
        { Element: JsonElement
          Id: string
          Path: string
          DocumentHandle: string option
          SourcePath: string option }

    type private CatalogState =
        { Entries: CatalogEntry list
          BlobSha: string }

    type private TreeEntry =
        { Path: string
          Mode: string
          Type: string
          Sha: string option }

    let private apiBase = Uri("https://api.github.com/")
    let private apiVersion = "2026-03-10"

    let private jsonOptions =
        JsonSerializerOptions(PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower)

    let private writeGates =
        ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal)

    let private escapePath (value: string) =
        value.Split('/') |> Array.map Uri.EscapeDataString |> String.concat "/"

    let private isSha (value: string) =
        not (String.IsNullOrWhiteSpace value)
        && value.Length >= 40
        && value.Length <= 64
        && value |> Seq.forall Uri.IsHexDigit

    let private tryString (name: string) (element: JsonElement) =
        let mutable value = Unchecked.defaultof<JsonElement>

        if
            element.ValueKind = JsonValueKind.Object
            && element.TryGetProperty(name, &value)
            && value.ValueKind = JsonValueKind.String
        then
            match value.GetString() with
            | null -> None
            | text -> Some text
        else
            None

    let private parseJson (body: string) =
        try
            use document = JsonDocument.Parse body
            Some(document.RootElement.Clone())
        with :? JsonException ->
            None

    let private requestMessage (token: string) (method: HttpMethod) (path: string) payload =
        let request = new HttpRequestMessage(method, Uri(apiBase, path))
        request.Headers.Accept.ParseAdd("application/vnd.github+json")
        request.Headers.UserAgent.ParseAdd("termin.al-publication")
        request.Headers.Add("X-GitHub-Api-Version", apiVersion)
        request.Headers.Authorization <- AuthenticationHeaderValue("Bearer", token)

        match payload with
        | Some value -> request.Content <- JsonContent.Create(value, options = jsonOptions)
        | None -> ()

        request

    let private send (httpClient: HttpClient) token method path payload cancellationToken =
        task {
            use request = requestMessage token method path payload
            use! response = httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            let! body = response.Content.ReadAsStringAsync(cancellationToken)
            return response.StatusCode, body
        }

    let private readRepositoryState httpClient token repository cancellationToken =
        task {
            let! repositoryStatus, repositoryBody =
                send httpClient token HttpMethod.Get $"repos/{repository}" None cancellationToken

            match repositoryStatus, parseJson repositoryBody with
            | HttpStatusCode.OK, Some repositoryJson ->
                match tryString "default_branch" repositoryJson with
                | None -> return None
                | Some defaultBranch ->
                    let! referenceStatus, referenceBody =
                        send
                            httpClient
                            token
                            HttpMethod.Get
                            $"repos/{repository}/git/ref/heads/{Uri.EscapeDataString(defaultBranch)}"
                            None
                            cancellationToken

                    match referenceStatus, parseJson referenceBody with
                    | HttpStatusCode.OK, Some referenceJson ->
                        let mutable gitObject = Unchecked.defaultof<JsonElement>

                        let headSha =
                            if referenceJson.TryGetProperty("object", &gitObject) then
                                tryString "sha" gitObject
                            else
                                None

                        match headSha with
                        | Some head when isSha head ->
                            let! commitStatus, commitBody =
                                send
                                    httpClient
                                    token
                                    HttpMethod.Get
                                    $"repos/{repository}/git/commits/{head}"
                                    None
                                    cancellationToken

                            match commitStatus, parseJson commitBody with
                            | HttpStatusCode.OK, Some commitJson ->
                                let mutable tree = Unchecked.defaultof<JsonElement>

                                let treeSha =
                                    if commitJson.TryGetProperty("tree", &tree) then
                                        tryString "sha" tree
                                    else
                                        None

                                match treeSha with
                                | Some value when isSha value ->
                                    return
                                        Some
                                            { DefaultBranch = defaultBranch
                                              HeadSha = head
                                              TreeSha = value }
                                | _ -> return None
                            | _ -> return None
                        | _ -> return None
                    | _ -> return None
            | _ -> return None
        }

    let private readFile httpClient token repository path (head: string) cancellationToken =
        task {
            let! status, body =
                send
                    httpClient
                    token
                    HttpMethod.Get
                    $"repos/{repository}/contents/{escapePath path}?ref={Uri.EscapeDataString(head)}"
                    None
                    cancellationToken

            match status, parseJson body with
            | HttpStatusCode.NotFound, _ -> return Some None
            | HttpStatusCode.OK, Some json ->
                match tryString "sha" json, tryString "encoding" json, tryString "content" json with
                | Some sha, Some "base64", Some encoded when isSha sha ->
                    try
                        let bytes =
                            Convert.FromBase64String(encoded.Replace("\n", "", StringComparison.Ordinal))

                        return
                            Some(
                                Some
                                    { BlobSha = sha
                                      Text = Encoding.UTF8.GetString bytes }
                            )
                    with :? FormatException ->
                        return None
                | _ -> return None
            | _ -> return None
        }

    let private parseCatalogBody body blobSha =
        match CatalogManifest.tryParse body with
        | Error _ -> None
        | Ok manifest ->
            let entries =
                (manifest.ManifestRawEntries, manifest.ManifestCatalogEntries)
                ||> List.map2 (fun element domainEntry ->
                    { Element = element
                      Id = domainEntry |> ContentDomain.CatalogEntry.id |> ContentDomain.CatalogId.value
                      Path =
                        domainEntry
                        |> ContentDomain.CatalogEntry.path
                        |> ContentDomain.VirtualPath.value
                      DocumentHandle =
                        domainEntry
                        |> ContentDomain.CatalogEntry.documentHandle
                        |> Option.map ContentDomain.ContentId.value
                      SourcePath = tryString "sourcePath" element })

            Some { Entries = entries; BlobSha = blobSha }

    let private readCatalog httpClient token repository head cancellationToken =
        task {
            match! readFile httpClient token repository "content/catalog.json" head cancellationToken with
            | Some(Some file) -> return parseCatalogBody file.Text file.BlobSha
            | _ -> return None
        }

    let private hashIdentifier (prefix: string) (value: string) =
        let hash = SHA256.HashData(Encoding.UTF8.GetBytes value)

        let encoded =
            Convert.ToBase64String(hash).TrimEnd('=').Replace('+', '-').Replace('/', '_')

        prefix + encoded

    let private publicationIdentity path = hashIdentifier "publication-" path
    let private directoryIdentity path = hashIdentifier "directory-" path

    let private directoryPaths (virtualPath: string) =
        let segments = virtualPath.Substring(2).Split('/')

        [ yield "~"
          for count in 1 .. segments.Length - 1 do
              yield "~/" + (segments |> Array.take count |> String.concat "/") ]

    let private writeCatalogEntry
        (writer: Utf8JsonWriter)
        (kind: string)
        (id: string)
        (path: string)
        (updatedAt: string)
        (size: int)
        (handle: string option)
        (sourcePath: string option)
        =
        writer.WriteStartObject()
        writer.WriteString("kind", kind)
        writer.WriteString("id", id)
        writer.WriteString("path", path)
        writer.WriteString("updatedAt", updatedAt)
        writer.WriteNumber("size", size)

        match handle, sourcePath with
        | Some documentHandle, Some repositoryPath ->
            writer.WriteString("documentHandle", documentHandle)
            writer.WriteString("sourcePath", repositoryPath)
        | _ -> ()

        writer.WriteEndObject()

    let private catalogBytes operation request now (catalog: CatalogState) =
        let matching =
            catalog.Entries
            |> List.filter (fun entry -> entry.SourcePath = Some request.RepositoryPath)

        if List.length matching > 1 then
            None
        else
            let existing = matching |> List.tryHead

            match operation, existing with
            | Operation.Add, Some _ -> None
            | (Operation.Update | Operation.Remove), None -> None
            | _ ->
                use stream = new MemoryStream()
                use writer = new Utf8JsonWriter(stream, JsonWriterOptions(Indented = false))
                writer.WriteStartObject()
                writer.WritePropertyName("entries")
                writer.WriteStartArray()

                let timestamp = ContentDomain.Timestamp.create now |> ContentDomain.Timestamp.value

                let documentSize = Encoding.UTF8.GetByteCount request.Markdown

                let existingDirectories =
                    catalog.Entries |> List.map (fun entry -> entry.Path) |> Set.ofList

                let missingDirectories =
                    if operation = Operation.Add then
                        directoryPaths request.VirtualPath
                        |> List.filter (fun path -> not (existingDirectories.Contains path))
                    else
                        []

                for entry in catalog.Entries do
                    if entry.SourcePath <> Some request.RepositoryPath then
                        entry.Element.WriteTo writer
                    elif operation = Operation.Update then
                        writeCatalogEntry
                            writer
                            "file"
                            entry.Id
                            request.VirtualPath
                            timestamp
                            documentSize
                            entry.DocumentHandle
                            (Some request.RepositoryPath)

                for directoryPath in missingDirectories do
                    writeCatalogEntry
                        writer
                        "directory"
                        (directoryIdentity directoryPath)
                        directoryPath
                        timestamp
                        0
                        None
                        None

                if operation = Operation.Add then
                    let identity = publicationIdentity request.RepositoryPath

                    writeCatalogEntry
                        writer
                        "file"
                        identity
                        request.VirtualPath
                        timestamp
                        documentSize
                        (Some identity)
                        (Some request.RepositoryPath)

                writer.WriteEndArray()
                writer.WriteEndObject()
                writer.Flush()
                let bytes = stream.ToArray()
                let generated = Encoding.UTF8.GetString bytes

                if parseCatalogBody generated catalog.BlobSha |> Option.isSome then
                    Some bytes
                else
                    None

    let private createBlob httpClient token repository bytes cancellationToken =
        task {
            let payload =
                {| content = Convert.ToBase64String bytes
                   encoding = "base64" |}

            let! status, body =
                send httpClient token HttpMethod.Post $"repos/{repository}/git/blobs" (Some payload) cancellationToken

            match status, parseJson body with
            | HttpStatusCode.Created, Some json ->
                match tryString "sha" json with
                | Some sha when isSha sha -> return Some sha
                | _ -> return None
            | _ -> return None
        }

    let private createTree httpClient token repository baseTree entries cancellationToken =
        task {
            let tree =
                entries
                |> List.map (fun entry ->
                    {| path = entry.Path
                       mode = entry.Mode
                       ``type`` = entry.Type
                       sha = entry.Sha |})

            let payload = {| baseTree = baseTree; tree = tree |}

            let! status, body =
                send httpClient token HttpMethod.Post $"repos/{repository}/git/trees" (Some payload) cancellationToken

            match status, parseJson body with
            | HttpStatusCode.Created, Some json ->
                match tryString "sha" json with
                | Some sha when isSha sha -> return Some sha
                | _ -> return None
            | _ -> return None
        }

    let private createCommit httpClient token repository subject tree head cancellationToken =
        task {
            let payload =
                {| message = subject
                   tree = tree
                   parents = [| head |] |}

            let! status, body =
                send httpClient token HttpMethod.Post $"repos/{repository}/git/commits" (Some payload) cancellationToken

            match status, parseJson body with
            | HttpStatusCode.Created, Some json ->
                match tryString "sha" json with
                | Some sha when isSha sha -> return Some sha
                | _ -> return None
            | _ -> return None
        }

    let private updateReference httpClient token repository (branch: string) commit cancellationToken =
        task {
            let payload = {| sha = commit; force = false |}

            let! status, _ =
                send
                    httpClient
                    token
                    (HttpMethod("PATCH"))
                    $"repos/{repository}/git/refs/heads/{Uri.EscapeDataString(branch)}"
                    (Some payload)
                    cancellationToken

            return status
        }

    let private subject operation (repositoryPath: string) =
        let separator = repositoryPath.IndexOf('/')
        let root = repositoryPath.Substring(0, separator)
        let relativePath = repositoryPath.Substring(separator + 1)
        let collection = if root = "blog" then "blogs" else "notes"

        let verb =
            match operation with
            | Operation.Add -> "add"
            | Operation.Update -> "update"
            | Operation.Remove -> "remove"

        $"{collection}: {verb} {relativePath}"

    let private conflict (request: Request) (state: RepositoryState) (document: FileState option) =
        Result.Conflict
            { LocalMarkdown = request.Markdown
              UpstreamMarkdown = document |> Option.map (fun value -> value.Text) |> Option.defaultValue ""
              DefaultBranch = state.DefaultBranch
              HeadSha = state.HeadSha
              BlobSha = document |> Option.map (fun value -> value.BlobSha) |> Option.defaultValue "" }

    let private validate (request: Request) =
        match ContentDomain.RepositoryPath.tryCreate "publication.repository_path" request.RepositoryPath with
        | Error _ -> Error()
        | Ok repositoryPath ->
            let expectedVirtualPath = "~/" + request.RepositoryPath

            let validOperation =
                match request.Operation with
                | Operation.Add ->
                    String.IsNullOrEmpty request.ExpectedBlobSha
                    && String.IsNullOrEmpty request.RemovalConfirmation
                | Operation.Update ->
                    isSha request.ExpectedBlobSha
                    && String.IsNullOrEmpty request.RemovalConfirmation
                | Operation.Remove ->
                    isSha request.ExpectedBlobSha
                    && request.RemovalConfirmation = request.RepositoryPath
                    && List.isEmpty request.Assets

            let media =
                request.Assets
                |> List.map (fun (asset: Asset) ->
                    { DestinationPath = asset.DestinationPath
                      DeclaredMediaType = asset.DeclaredMediaType
                      Bytes = asset.Bytes }
                    : PublicationMedia.Candidate)
                |> PublicationMedia.validate request.RepositoryPath

            if
                request.VirtualPath <> expectedVirtualPath
                || not validOperation
                || String.IsNullOrWhiteSpace request.ExpectedDefaultBranch
                || not (isSha request.ExpectedHeadSha)
            then
                Error()
            else
                match ContentDomain.FrontMatter.tryParse repositoryPath request.Markdown, media with
                | Ok _, Ok assets -> Ok(repositoryPath, assets)
                | _ -> Error()

    let private createPublicationTreeEntries
        httpClient
        token
        repository
        (request: Request)
        (assets: PublicationMedia.Validated list)
        cancellationToken
        =
        let rec createAssets (pending: PublicationMedia.Validated list) (entries: TreeEntry list) =
            task {
                match pending with
                | [] -> return Some(List.rev entries)
                | asset :: remaining ->
                    match! createBlob httpClient token repository asset.Bytes cancellationToken with
                    | None -> return None
                    | Some sha ->
                        return!
                            createAssets
                                remaining
                                ({ Path = asset.DestinationPath
                                   Mode = "100644"
                                   Type = "blob"
                                   Sha = Some sha }
                                 :: entries)
            }

        task {
            if request.Operation = Operation.Remove then
                return
                    Some(
                        "",
                        [ { Path = request.RepositoryPath
                            Mode = "100644"
                            Type = "blob"
                            Sha = None } ]
                    )
            else
                match!
                    createBlob httpClient token repository (Encoding.UTF8.GetBytes request.Markdown) cancellationToken
                with
                | None -> return None
                | Some documentSha ->
                    let documentEntry =
                        { Path = request.RepositoryPath
                          Mode = "100644"
                          Type = "blob"
                          Sha = Some documentSha }

                    match! createAssets (assets |> List.sortBy (fun value -> value.DestinationPath)) [] with
                    | None -> return None
                    | Some assetEntries -> return Some(documentSha, documentEntry :: assetEntries)
        }

    let live
        (httpClient: HttpClient)
        (configuration: GitHubContentConfiguration)
        (generation: ContentCacheGeneration)
        (now: unit -> DateTimeOffset)
        : Client =
        let repository =
            configuration
            |> GitHubContentConfiguration.contentRepository
            |> ContentDomain.RepositoryName.value

        { new Client with
            member _.Publish(ownerToken, request, cancellationToken) =
                task {
                    match validate request with
                    | Error _ -> return Result.Invalid
                    | Ok(_, validatedAssets) ->
                        let token = Auth.ownerAccessTokenValue ownerToken

                        let gate = writeGates.GetOrAdd(repository, fun _ -> new SemaphoreSlim(1, 1))

                        try
                            do! gate.WaitAsync(cancellationToken)

                            try
                                match! readRepositoryState httpClient token repository cancellationToken with
                                | None -> return Result.Unavailable
                                | Some state ->
                                    match!
                                        readFile
                                            httpClient
                                            token
                                            repository
                                            request.RepositoryPath
                                            state.HeadSha
                                            cancellationToken
                                    with
                                    | None -> return Result.Unavailable
                                    | Some document ->
                                        let baseConflict =
                                            state.DefaultBranch <> request.ExpectedDefaultBranch
                                            || state.HeadSha <> request.ExpectedHeadSha

                                        let documentConflict =
                                            match request.Operation, document with
                                            | Operation.Add, Some _ -> true
                                            | Operation.Add, None -> false
                                            | (Operation.Update | Operation.Remove), Some value ->
                                                value.BlobSha <> request.ExpectedBlobSha
                                            | (Operation.Update | Operation.Remove), None -> true

                                        if baseConflict || documentConflict then
                                            return conflict request state document
                                        else
                                            match!
                                                readCatalog httpClient token repository state.HeadSha cancellationToken
                                            with
                                            | None -> return Result.Unavailable
                                            | Some catalog ->
                                                match catalogBytes request.Operation request (now ()) catalog with
                                                | None -> return Result.Unavailable
                                                | Some catalogContent ->
                                                    match!
                                                        createPublicationTreeEntries
                                                            httpClient
                                                            token
                                                            repository
                                                            request
                                                            validatedAssets
                                                            cancellationToken
                                                    with
                                                    | None -> return Result.Unavailable
                                                    | Some(documentBlobSha, contentTreeEntries) ->
                                                        match!
                                                            createBlob
                                                                httpClient
                                                                token
                                                                repository
                                                                catalogContent
                                                                cancellationToken
                                                        with
                                                        | None -> return Result.Unavailable
                                                        | Some catalogBlobSha ->
                                                            let treeEntries =
                                                                contentTreeEntries
                                                                @ [ { Path = "content/catalog.json"
                                                                      Mode = "100644"
                                                                      Type = "blob"
                                                                      Sha = Some catalogBlobSha } ]

                                                            match!
                                                                createTree
                                                                    httpClient
                                                                    token
                                                                    repository
                                                                    state.TreeSha
                                                                    treeEntries
                                                                    cancellationToken
                                                            with
                                                            | None -> return Result.Unavailable
                                                            | Some treeSha ->
                                                                match!
                                                                    createCommit
                                                                        httpClient
                                                                        token
                                                                        repository
                                                                        (subject
                                                                            request.Operation
                                                                            request.RepositoryPath)
                                                                        treeSha
                                                                        state.HeadSha
                                                                        cancellationToken
                                                                with
                                                                | None -> return Result.Unavailable
                                                                | Some commitSha ->
                                                                    match!
                                                                        updateReference
                                                                            httpClient
                                                                            token
                                                                            repository
                                                                            state.DefaultBranch
                                                                            commitSha
                                                                            cancellationToken
                                                                    with
                                                                    | HttpStatusCode.OK ->
                                                                        generation.Advance commitSha |> ignore

                                                                        return
                                                                            Result.Published
                                                                                { Sha = commitSha
                                                                                  Url =
                                                                                    $"https://github.com/{repository}/commit/{commitSha}"
                                                                                  DefaultBranch = state.DefaultBranch
                                                                                  DocumentBlobSha = documentBlobSha }
                                                                    | HttpStatusCode.Conflict
                                                                    | HttpStatusCode.UnprocessableEntity ->
                                                                        match!
                                                                            readRepositoryState
                                                                                httpClient
                                                                                token
                                                                                repository
                                                                                cancellationToken
                                                                        with
                                                                        | None -> return Result.Unavailable
                                                                        | Some latest ->
                                                                            match!
                                                                                readFile
                                                                                    httpClient
                                                                                    token
                                                                                    repository
                                                                                    request.RepositoryPath
                                                                                    latest.HeadSha
                                                                                    cancellationToken
                                                                            with
                                                                            | None -> return Result.Unavailable
                                                                            | Some latestDocument ->
                                                                                let fileChanged =
                                                                                    match document, latestDocument with
                                                                                    | None, None -> false
                                                                                    | Some before, Some after ->
                                                                                        before.BlobSha <> after.BlobSha
                                                                                    | _ -> true

                                                                                if
                                                                                    latest.DefaultBranch
                                                                                    <> state.DefaultBranch
                                                                                    || latest.HeadSha <> state.HeadSha
                                                                                    || fileChanged
                                                                                then
                                                                                    return
                                                                                        conflict
                                                                                            request
                                                                                            latest
                                                                                            latestDocument
                                                                                else
                                                                                    return Result.Unavailable
                                                                    | _ -> return Result.Unavailable
                            finally
                                gate.Release() |> ignore
                        with
                        | :? OperationCanceledException when cancellationToken.IsCancellationRequested ->
                            return raise (OperationCanceledException(cancellationToken))
                        | :? OperationCanceledException -> return Result.Unavailable
                        | :? HttpRequestException
                        | :? JsonException
                        | :? InvalidOperationException -> return Result.Unavailable
                } }

    let unavailable: Client =
        { new Client with
            member _.Publish(_, _, _) = Task.FromResult(Result.Unavailable) }
