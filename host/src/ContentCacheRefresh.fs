namespace Termin.Al.Host

open System
open System.Net.Http
open System.Text.Json
open System.Threading
open System.Threading.Tasks
open Microsoft.Extensions.Hosting

type ContentHeadProbe =
    abstract Read: CancellationToken -> Task<string option>

[<RequireQualifiedAccess>]
module ContentHeadProbe =
    let private apiBase = Uri("https://api.github.com/")

    let live (httpClient: HttpClient) (configuration: GitHubContentConfiguration) : ContentHeadProbe =
        let repository =
            configuration
            |> GitHubContentConfiguration.contentRepository
            |> ContentDomain.RepositoryName.value

        let send (path: string) cancellationToken =
            task {
                use request = new HttpRequestMessage(HttpMethod.Get, Uri(apiBase, path))
                request.Headers.Accept.ParseAdd("application/vnd.github+json")
                request.Headers.UserAgent.ParseAdd("termin.al-content-head")
                request.Headers.Add("X-GitHub-Api-Version", "2026-03-10")

                use! response =
                    httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)

                if not response.IsSuccessStatusCode then
                    return None
                else
                    let! body = response.Content.ReadAsStringAsync(cancellationToken)

                    try
                        use document = JsonDocument.Parse body
                        return Some(document.RootElement.Clone())
                    with :? JsonException ->
                        return None
            }

        { new ContentHeadProbe with
            member _.Read cancellationToken =
                task {
                    use timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken)
                    timeout.CancelAfter(TimeSpan.FromSeconds(10.0))

                    try
                        match! send $"repos/{repository}" timeout.Token with
                        | None -> return None
                        | Some repositoryResponse ->
                            let mutable branch = Unchecked.defaultof<JsonElement>

                            if
                                not (repositoryResponse.TryGetProperty("default_branch", &branch))
                                || branch.ValueKind <> JsonValueKind.String
                            then
                                return None
                            else
                                let branchName = branch.GetString()

                                match!
                                    send
                                        $"repos/{repository}/git/ref/heads/{Uri.EscapeDataString(branchName)}"
                                        timeout.Token
                                with
                                | None -> return None
                                | Some reference ->
                                    let mutable gitObject = Unchecked.defaultof<JsonElement>
                                    let mutable sha = Unchecked.defaultof<JsonElement>

                                    if
                                        reference.TryGetProperty("object", &gitObject)
                                        && gitObject.ValueKind = JsonValueKind.Object
                                        && gitObject.TryGetProperty("sha", &sha)
                                        && sha.ValueKind = JsonValueKind.String
                                    then
                                        let value = sha.GetString()

                                        return
                                            if
                                                not (isNull value)
                                                && value.Length >= 40
                                                && value.Length <= 64
                                                && value |> Seq.forall Uri.IsHexDigit
                                            then
                                                Some value
                                            else
                                                None
                                    else
                                        return None
                    with
                    | :? HttpRequestException
                    | :? TaskCanceledException when not cancellationToken.IsCancellationRequested -> return None
                } }

[<RequireQualifiedAccess>]
module ContentCacheRefresh =
    let observe (probe: ContentHeadProbe) (generation: ContentCacheGeneration) cancellationToken =
        task {
            match! probe.Read cancellationToken with
            | Some head -> return generation.Observe head
            | None -> return false
        }

type ContentCacheRefreshWorker(probe: ContentHeadProbe, generation: ContentCacheGeneration) =
    inherit BackgroundService()

    override _.ExecuteAsync(stoppingToken: CancellationToken) =
        task {
            while not stoppingToken.IsCancellationRequested do
                try
                    let! _ = ContentCacheRefresh.observe probe generation stoppingToken
                    do! Task.Delay(TimeSpan.FromMinutes(5.0), stoppingToken)
                with :? OperationCanceledException when stoppingToken.IsCancellationRequested ->
                    ()
        }
