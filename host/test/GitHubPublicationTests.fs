namespace Termin.Al.Host.Tests

open System
open System.Collections.Generic
open System.Net
open System.Net.Http
open System.Security.Cryptography
open System.Text
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Configuration
open Termin.Al.Host

[<RequireQualifiedAccess>]
module GitHubPublicationTests =
    type private Captured =
        { Method: string
          Path: string
          Authorization: string
          Body: string }

    type private FakeHandler(respond: Captured -> HttpResponseMessage) =
        inherit HttpMessageHandler()

        let requests = ResizeArray<Captured>()
        member _.Requests = requests |> Seq.toList

        override _.SendAsync(request: HttpRequestMessage, cancellationToken: CancellationToken) =
            task {
                let! body =
                    if isNull request.Content then Task.FromResult ""
                    else request.Content.ReadAsStringAsync(cancellationToken)

                let captured =
                    { Method = request.Method.Method
                      Path = request.RequestUri.PathAndQuery
                      Authorization =
                        if isNull request.Headers.Authorization then ""
                        else request.Headers.Authorization.ToString()
                      Body = body }

                requests.Add captured
                return respond captured
            }

    let private sha character = String(character, 40)

    let private response status body =
        new HttpResponseMessage(
            status,
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        )

    let private contentResponse (blob: string) (text: string) =
        let encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes text)
        $"{{\"sha\":\"{blob}\",\"encoding\":\"base64\",\"content\":\"{encoded}\"}}"

    let private configuration () =
        let values = Dictionary<string, string>()
        values.Add("GitHub:Owner", "example-owner")
        values.Add("GitHub:ContentRepository", "content")
        values.Add("GitHub:ApplicationRepository", "application")
        values.Add("GitHub:ProfileRepository", "profile")

        ConfigurationBuilder().AddInMemoryCollection(values).Build()
        |> GitHubContentConfiguration.tryCreate
        |> function
            | Ok value -> value
            | Error problem -> failwith (ContentDomain.Problem.detail problem)

    let private token () =
        Auth.tryOwnerAccessToken "owner-user-token"
        |> Option.defaultWith (fun () -> failwith "The test owner token must be valid.")

    let private markdown title =
        $"---\ntitle = \"{title}\"\nsummary = \"Summary.\"\ntags = [\"fsharp\"]\n---\n# {title}\n"

    let private identifier (prefix: string) (value: string) =
        let encoded =
            SHA256.HashData(Encoding.UTF8.GetBytes value)
            |> Convert.ToBase64String
            |> fun text -> text.TrimEnd('=').Replace('+', '-').Replace('/', '_')

        prefix + encoded

    let private addRequest: GitHubPublication.Request =
        { Operation = GitHubPublication.Operation.Add
          RepositoryPath = "blog/engineering/interfaces/example.md"
          VirtualPath = "~/blog/engineering/interfaces/example.md"
          Markdown = markdown "Example"
          ExpectedDefaultBranch = "main"
          ExpectedHeadSha = sha 'a'
          ExpectedBlobSha = ""
          Assets =
            [ ({ DestinationPath = "assets/blog/engineering/interfaces/example/image.png"
                 DeclaredMediaType = "image/png"
                 Bytes = [| 0x89uy; 0x50uy; 0x4euy; 0x47uy; 0x0duy; 0x0auy; 0x1auy; 0x0auy |] }:
                GitHubPublication.Asset) ]
          RemovalConfirmation = "" }

    let private baseCatalog =
        """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"blog","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0}]}"""

    let private runSharedCatalogCodecContract () =
        match CatalogManifest.tryParse baseCatalog with
        | Ok manifest when
            manifest.ManifestCatalogEntries.Length = 2
            && manifest.ManifestRawEntries.Length = 2 -> ()
        | result -> failwithf "The shared catalog codec rejected its canonical manifest: %A." result

        let duplicateSource =
            """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"blog","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"file","id":"first","path":"~/blog/first.md","updatedAt":"2026-07-15T00:00:00.000Z","size":1,"documentHandle":"first","sourcePath":"blog/shared.md"},{"kind":"file","id":"second","path":"~/blog/second.md","updatedAt":"2026-07-15T00:00:00.000Z","size":1,"documentHandle":"second","sourcePath":"blog/shared.md"}]}"""

        let invalid =
            [ """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0,"unknown":true}]}"""
              """{"entries":[{"kind":"file","id":"orphan","path":"~/blog/orphan.md","updatedAt":"2026-07-15T00:00:00.000Z","size":1,"documentHandle":"orphan","sourcePath":"blog/orphan.md"}]}"""
              """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"home","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0}]}"""
              duplicateSource ]

        if invalid |> List.exists (CatalogManifest.tryParse >> Result.isOk) then
            failwith "The shared catalog codec accepted invalid fields, structure, identity, or duplicate source paths."

    let private runAtomicAdd () =
        let mutable blob = 0
        let handler =
            new FakeHandler(fun request ->
                match request.Method, request.Path with
                | "GET", "/repos/example-owner/content" ->
                    response HttpStatusCode.OK "{\"default_branch\":\"main\"}"
                | "GET", "/repos/example-owner/content/git/ref/heads/main" ->
                    response HttpStatusCode.OK $"{{\"object\":{{\"sha\":\"{sha 'a'}\"}}}}"
                | "GET", path when path = $"/repos/example-owner/content/git/commits/{sha 'a'}" ->
                    response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/blog/engineering/interfaces/example.md?") ->
                    response HttpStatusCode.NotFound "{}"
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/content/catalog.json?") ->
                    response HttpStatusCode.OK (contentResponse (sha 'c') baseCatalog)
                | "POST", "/repos/example-owner/content/git/blobs" ->
                    blob <- blob + 1
                    let value = [| sha 'd'; sha 'e'; sha 'f' |][blob - 1]
                    response HttpStatusCode.Created $"{{\"sha\":\"{value}\"}}"
                | "POST", "/repos/example-owner/content/git/trees" ->
                    response HttpStatusCode.Created $"{{\"sha\":\"{sha '1'}\"}}"
                | "POST", "/repos/example-owner/content/git/commits" ->
                    response HttpStatusCode.Created $"{{\"sha\":\"{sha '2'}\"}}"
                | "PATCH", "/repos/example-owner/content/git/refs/heads/main" ->
                    response HttpStatusCode.OK "{}"
                | _ -> response HttpStatusCode.BadRequest "{}")

        use httpClient = new HttpClient(handler)
        let generation = ContentCacheGeneration()
        let client =
            GitHubPublication.live
                httpClient
                (configuration ())
                generation
                (fun () -> DateTimeOffset(2026, 7, 22, 12, 0, 0, TimeSpan.Zero))

        match client.Publish(token (), addRequest, CancellationToken.None).GetAwaiter().GetResult() with
        | GitHubPublication.Result.Published commit ->
            if
                commit.Sha <> sha '2'
                || commit.DocumentBlobSha <> sha 'd'
                || generation.Current <> 1L
            then
                failwithf "Publication success or unconditional cache generation changed: %A." commit
        | result -> failwithf "Expected publication success, got %A." result

        let requests = handler.Requests
        let writes = requests |> List.filter (fun request -> request.Method <> "GET")
        let expected = [ "POST"; "POST"; "POST"; "POST"; "POST"; "PATCH" ]
        if writes |> List.map (fun request -> request.Method) <> expected then
            failwithf "Git write order changed: %A." writes
        if requests |> List.exists (fun request -> request.Authorization <> "Bearer owner-user-token") then
            failwith "A GitHub publication request omitted the server-held owner token."

        let blobBodies = writes |> List.filter (fun request -> request.Path.EndsWith("/git/blobs"))
        if blobBodies.Length <> 3 then failwith "Add must create document, media, then catalog blobs."
        use catalogBlob = JsonDocument.Parse(blobBodies[2].Body)
        let catalogBase64 = catalogBlob.RootElement.GetProperty("content").GetString()
        let catalogText = Encoding.UTF8.GetString(Convert.FromBase64String catalogBase64)
        use catalog = JsonDocument.Parse catalogText
        let entries = catalog.RootElement.GetProperty("entries").EnumerateArray() |> Seq.toList
        let publication = entries |> List.find (fun entry -> entry.TryGetProperty("sourcePath") |> fst)
        let expectedPublication = identifier "publication-" addRequest.RepositoryPath
        if
            publication.GetProperty("id").GetString() <> expectedPublication
            || publication.GetProperty("documentHandle").GetString() <> expectedPublication
            || expectedPublication.Length <> 55
            || expectedPublication.Contains('=')
        then
            failwith "New publication identity is not the approved deterministic unpadded path hash."

        for path in [ "~/blog/engineering"; "~/blog/engineering/interfaces" ] do
            let entry = entries |> List.find (fun value -> value.GetProperty("path").GetString() = path)
            let expectedDirectory = identifier "directory-" path
            if entry.GetProperty("id").GetString() <> expectedDirectory || expectedDirectory.Contains('=') then
                failwithf "Missing directory %s did not use its approved identity." path

        let tree = writes |> List.find (fun request -> request.Path.EndsWith("/git/trees"))
        if
            not (tree.Body.Contains("assets/blog/engineering/interfaces/example/image.png", StringComparison.Ordinal))
            || not (tree.Body.Contains("content/catalog.json", StringComparison.Ordinal))
        then
            failwith "The single tree omitted recursive assets or the catalog."
        let commit = writes |> List.find (fun request -> request.Path.EndsWith("/git/commits"))
        if not (commit.Body.Contains("blogs: add engineering/interfaces/example.md", StringComparison.Ordinal)) then
            failwith "The deterministic recursive add subject changed."
        let reference = writes |> List.last
        if not (reference.Body.Contains("\"force\":false", StringComparison.Ordinal)) then
            failwith "Default-branch reference updates must use force=false."

    let private runExpectedBaseConflicts () =
        let upstream = markdown "Upstream"

        let execute expectedHead expectedBlob currentHead currentBlob =
            let handler =
                new FakeHandler(fun request ->
                    match request.Method, request.Path with
                    | "GET", "/repos/example-owner/content" -> response HttpStatusCode.OK "{\"default_branch\":\"main\"}"
                    | "GET", "/repos/example-owner/content/git/ref/heads/main" ->
                        response HttpStatusCode.OK $"{{\"object\":{{\"sha\":\"{currentHead}\"}}}}"
                    | "GET", path when path = $"/repos/example-owner/content/git/commits/{currentHead}" ->
                        response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                    | "GET", path when path.StartsWith("/repos/example-owner/content/contents/blog/engineering/interfaces/example.md?") ->
                        response HttpStatusCode.OK (contentResponse currentBlob upstream)
                    | _ -> response HttpStatusCode.BadRequest "{}")
            use httpClient = new HttpClient(handler)
            let client = GitHubPublication.live httpClient (configuration ()) (ContentCacheGeneration()) (fun () -> DateTimeOffset.UtcNow)
            let request =
                { addRequest with
                    Operation = GitHubPublication.Operation.Update
                    ExpectedHeadSha = expectedHead
                    ExpectedBlobSha = expectedBlob
                    Assets = [] }
            let result = client.Publish(token (), request, CancellationToken.None).GetAwaiter().GetResult()
            match result with
            | GitHubPublication.Result.Conflict conflict when
                conflict.LocalMarkdown = request.Markdown
                && conflict.UpstreamMarkdown = upstream
                && conflict.HeadSha = currentHead
                && conflict.BlobSha = currentBlob -> ()
            | _ -> failwithf "Expected direct latest-base conflict, got %A." result
            if handler.Requests |> List.exists (fun request -> request.Method <> "GET") then
                failwith "Expected base conflicts must occur before Git writes."

        execute (sha '9') (sha '8') (sha 'a') (sha '8')
        execute (sha 'a') (sha '9') (sha 'a') (sha '8')

    let private runRemovalRetainsAssetsAndDirectories () =
        let existingCatalog =
            """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"blog","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"engineering","path":"~/blog/engineering","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"interfaces","path":"~/blog/engineering/interfaces","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"file","id":"retained-id","path":"~/blog/engineering/interfaces/example.md","updatedAt":"2026-07-15T00:00:00.000Z","size":90,"documentHandle":"retained-handle","sourcePath":"blog/engineering/interfaces/example.md"}]}"""
        let handler =
            new FakeHandler(fun request ->
                match request.Method, request.Path with
                | "GET", "/repos/example-owner/content" -> response HttpStatusCode.OK "{\"default_branch\":\"main\"}"
                | "GET", "/repos/example-owner/content/git/ref/heads/main" ->
                    response HttpStatusCode.OK $"{{\"object\":{{\"sha\":\"{sha 'a'}\"}}}}"
                | "GET", path when path = $"/repos/example-owner/content/git/commits/{sha 'a'}" ->
                    response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/blog/engineering/interfaces/example.md?") ->
                    response HttpStatusCode.OK (contentResponse (sha 'c') addRequest.Markdown)
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/content/catalog.json?") ->
                    response HttpStatusCode.OK (contentResponse (sha 'd') existingCatalog)
                | "POST", "/repos/example-owner/content/git/blobs" ->
                    response HttpStatusCode.Created $"{{\"sha\":\"{sha 'e'}\"}}"
                | "POST", "/repos/example-owner/content/git/trees" ->
                    response HttpStatusCode.Created $"{{\"sha\":\"{sha 'f'}\"}}"
                | "POST", "/repos/example-owner/content/git/commits" ->
                    response HttpStatusCode.Created $"{{\"sha\":\"{sha '1'}\"}}"
                | "PATCH", "/repos/example-owner/content/git/refs/heads/main" -> response HttpStatusCode.OK "{}"
                | _ -> response HttpStatusCode.BadRequest "{}")
        use httpClient = new HttpClient(handler)
        let client = GitHubPublication.live httpClient (configuration ()) (ContentCacheGeneration()) (fun () -> DateTimeOffset.UtcNow)
        let request =
            { addRequest with
                Operation = GitHubPublication.Operation.Remove
                ExpectedBlobSha = sha 'c'
                Assets = []
                RemovalConfirmation = addRequest.RepositoryPath }
        match client.Publish(token (), request, CancellationToken.None).GetAwaiter().GetResult() with
        | GitHubPublication.Result.Published _ -> ()
        | result -> failwithf "Expected removal publication, got %A." result
        let writes = handler.Requests |> List.filter (fun value -> value.Method <> "GET")
        if writes |> List.filter (fun value -> value.Path.EndsWith("/git/blobs")) |> List.length <> 1 then
            failwith "Removal must create only its catalog blob before tree/commit/ref."
        let tree = writes |> List.find (fun value -> value.Path.EndsWith("/git/trees"))
        if
            tree.Body.Contains("assets/", StringComparison.Ordinal)
            || not (tree.Body.Contains("\"path\":\"blog/engineering/interfaces/example.md\"", StringComparison.Ordinal))
            || not (tree.Body.Contains("\"sha\":null", StringComparison.Ordinal))
        then
            failwith "Removal must delete only Markdown and never asset paths."
        let catalogBlob = writes |> List.find (fun value -> value.Path.EndsWith("/git/blobs"))
        use payload = JsonDocument.Parse catalogBlob.Body
        let catalogText =
            payload.RootElement.GetProperty("content").GetString()
            |> Convert.FromBase64String
            |> Encoding.UTF8.GetString
        if catalogText.Contains("sourcePath", StringComparison.Ordinal) || not (catalogText.Contains("~/blog/engineering/interfaces", StringComparison.Ordinal)) then
            failwith "Removal must remove only its file entry and retain recursive directories."
        let commit = writes |> List.find (fun value -> value.Path.EndsWith("/git/commits"))
        if not (commit.Body.Contains("blogs: remove engineering/interfaces/example.md", StringComparison.Ordinal)) then
            failwith "The deterministic recursive remove subject changed."

    let private runUpdateRetainsCatalogIdentity () =
        let existingCatalog =
            """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"blog","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"engineering","path":"~/blog/engineering","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"interfaces","path":"~/blog/engineering/interfaces","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"file","id":"existing-id","path":"~/blog/engineering/interfaces/example.md","updatedAt":"2026-07-15T00:00:00.000Z","size":90,"documentHandle":"existing-handle","sourcePath":"blog/engineering/interfaces/example.md"}]}"""
        let mutable blobs = 0
        let handler =
            new FakeHandler(fun request ->
                match request.Method, request.Path with
                | "GET", "/repos/example-owner/content" -> response HttpStatusCode.OK "{\"default_branch\":\"main\"}"
                | "GET", "/repos/example-owner/content/git/ref/heads/main" -> response HttpStatusCode.OK $"{{\"object\":{{\"sha\":\"{sha 'a'}\"}}}}"
                | "GET", path when path = $"/repos/example-owner/content/git/commits/{sha 'a'}" -> response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/blog/engineering/interfaces/example.md?") -> response HttpStatusCode.OK (contentResponse (sha 'c') (markdown "Old"))
                | "GET", path when path.StartsWith("/repos/example-owner/content/contents/content/catalog.json?") -> response HttpStatusCode.OK (contentResponse (sha 'd') existingCatalog)
                | "POST", "/repos/example-owner/content/git/blobs" ->
                    blobs <- blobs + 1
                    response HttpStatusCode.Created $"{{\"sha\":\"{if blobs = 1 then sha 'e' else sha 'f'}\"}}"
                | "POST", "/repos/example-owner/content/git/trees" -> response HttpStatusCode.Created $"{{\"sha\":\"{sha '1'}\"}}"
                | "POST", "/repos/example-owner/content/git/commits" -> response HttpStatusCode.Created $"{{\"sha\":\"{sha '2'}\"}}"
                | "PATCH", "/repos/example-owner/content/git/refs/heads/main" -> response HttpStatusCode.OK "{}"
                | _ -> response HttpStatusCode.BadRequest "{}")
        use httpClient = new HttpClient(handler)
        let client = GitHubPublication.live httpClient (configuration ()) (ContentCacheGeneration()) (fun () -> DateTimeOffset.UtcNow)
        let request =
            { addRequest with
                Operation = GitHubPublication.Operation.Update
                ExpectedBlobSha = sha 'c'
                Assets = [] }
        match client.Publish(token (), request, CancellationToken.None).GetAwaiter().GetResult() with
        | GitHubPublication.Result.Published _ -> ()
        | result -> failwithf "Expected update publication, got %A." result
        let writes = handler.Requests |> List.filter (fun value -> value.Method <> "GET")
        let catalogBlob = writes |> List.filter (fun value -> value.Path.EndsWith("/git/blobs")) |> List.last
        use payload = JsonDocument.Parse catalogBlob.Body
        let catalogText = payload.RootElement.GetProperty("content").GetString() |> Convert.FromBase64String |> Encoding.UTF8.GetString
        if
            not (catalogText.Contains("\"id\":\"existing-id\"", StringComparison.Ordinal))
            || not (catalogText.Contains("\"documentHandle\":\"existing-handle\"", StringComparison.Ordinal))
        then
            failwith "Updates must retain the existing catalog identity."
        let commit = writes |> List.find (fun value -> value.Path.EndsWith("/git/commits"))
        if not (commit.Body.Contains("blogs: update engineering/interfaces/example.md", StringComparison.Ordinal)) then
            failwith "The deterministic recursive update subject changed."

    let private runReferenceUpdateFailureClassification () =
        let existingCatalog =
            """{"entries":[{"kind":"directory","id":"home","path":"~","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"blog","path":"~/blog","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"engineering","path":"~/blog/engineering","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"directory","id":"interfaces","path":"~/blog/engineering/interfaces","updatedAt":"2026-07-15T00:00:00.000Z","size":0},{"kind":"file","id":"existing-id","path":"~/blog/engineering/interfaces/example.md","updatedAt":"2026-07-15T00:00:00.000Z","size":90,"documentHandle":"existing-handle","sourcePath":"blog/engineering/interfaces/example.md"}]}"""

        let execute updateStatus latestHead latestBlob =
            let mutable referenceReads = 0
            let mutable blobs = 0
            let handler =
                new FakeHandler(fun request ->
                    match request.Method, request.Path with
                    | "GET", "/repos/example-owner/content" ->
                        response HttpStatusCode.OK "{\"default_branch\":\"main\"}"
                    | "GET", "/repos/example-owner/content/git/ref/heads/main" ->
                        referenceReads <- referenceReads + 1
                        let head = if referenceReads = 1 then sha 'a' else latestHead
                        response HttpStatusCode.OK $"{{\"object\":{{\"sha\":\"{head}\"}}}}"
                    | "GET", path when path = $"/repos/example-owner/content/git/commits/{sha 'a'}" ->
                        response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                    | "GET", path when path = $"/repos/example-owner/content/git/commits/{latestHead}" ->
                        response HttpStatusCode.OK $"{{\"tree\":{{\"sha\":\"{sha 'b'}\"}}}}"
                    | "GET", path when path.StartsWith("/repos/example-owner/content/contents/blog/engineering/interfaces/example.md?") ->
                        let blob = if referenceReads = 1 then sha 'c' else latestBlob
                        let text = if referenceReads = 1 then markdown "Old" else markdown "Latest"
                        response HttpStatusCode.OK (contentResponse blob text)
                    | "GET", path when path.StartsWith("/repos/example-owner/content/contents/content/catalog.json?") ->
                        response HttpStatusCode.OK (contentResponse (sha 'd') existingCatalog)
                    | "POST", "/repos/example-owner/content/git/blobs" ->
                        blobs <- blobs + 1
                        response HttpStatusCode.Created $"{{\"sha\":\"{if blobs = 1 then sha 'e' else sha 'f'}\"}}"
                    | "POST", "/repos/example-owner/content/git/trees" ->
                        response HttpStatusCode.Created $"{{\"sha\":\"{sha '1'}\"}}"
                    | "POST", "/repos/example-owner/content/git/commits" ->
                        response HttpStatusCode.Created $"{{\"sha\":\"{sha '2'}\"}}"
                    | "PATCH", "/repos/example-owner/content/git/refs/heads/main" ->
                        response updateStatus "{}"
                    | _ -> response HttpStatusCode.BadRequest "{}")

            use httpClient = new HttpClient(handler)
            let generation = ContentCacheGeneration()
            let client = GitHubPublication.live httpClient (configuration ()) generation (fun () -> DateTimeOffset.UtcNow)
            let request =
                { addRequest with
                    Operation = GitHubPublication.Operation.Update
                    ExpectedBlobSha = sha 'c'
                    Assets = [] }
            let result = client.Publish(token (), request, CancellationToken.None).GetAwaiter().GetResult()

            if generation.Current <> 0L then
                failwith "A failed reference update must not advance the content cache generation."

            result

        match execute HttpStatusCode.Conflict (sha '9') (sha '8') with
        | GitHubPublication.Result.Conflict conflict when
            conflict.HeadSha = sha '9'
            && conflict.BlobSha = sha '8'
            && conflict.UpstreamMarkdown = markdown "Latest" -> ()
        | result -> failwithf "A changed head after reference failure must return the direct latest conflict: %A." result

        match execute HttpStatusCode.UnprocessableEntity (sha 'a') (sha 'c') with
        | GitHubPublication.Result.Unavailable -> ()
        | result ->
            failwithf "An unchanged head and blob after a 422 must remain a generic unavailable failure: %A." result

    let private runCancellationMapping () =
        let timeoutHandler = new FakeHandler(fun _ -> raise (TaskCanceledException("upstream timeout")))
        use timeoutClient = new HttpClient(timeoutHandler)
        let client = GitHubPublication.live timeoutClient (configuration ()) (ContentCacheGeneration()) (fun () -> DateTimeOffset.UtcNow)
        match client.Publish(token (), addRequest, CancellationToken.None).GetAwaiter().GetResult() with
        | GitHubPublication.Result.Unavailable -> ()
        | result -> failwithf "Non-caller timeout must be generic unavailable, got %A." result

        use cancellation = new CancellationTokenSource()
        cancellation.Cancel()
        try
            client.Publish(token (), addRequest, cancellation.Token).GetAwaiter().GetResult() |> ignore
            failwith "Caller cancellation must propagate."
        with :? OperationCanceledException -> ()

    let run () =
        runSharedCatalogCodecContract ()
        runAtomicAdd ()
        runExpectedBaseConflicts ()
        runUpdateRetainsCatalogIdentity ()
        runReferenceUpdateFailureClassification ()
        runRemovalRetainsAssetsAndDirectories ()
        runCancellationMapping ()
