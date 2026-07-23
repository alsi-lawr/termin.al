namespace Termin.Al.Host

open System
open System.IO
open System.Net
open System.Net.Http
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.AspNetCore.HttpOverrides
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting

[<RequireQualifiedAccess>]
module HostApplication =
    type private ForwardedHeaderSources =
        { Proxies: IPAddress list
          Networks: System.Net.IPNetwork list }

    let private createOptions (args: string array) : WebApplicationOptions =
        let webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")

        if Directory.Exists(webRootPath) then
            WebApplicationOptions(Args = args, WebRootPath = webRootPath)
        else
            WebApplicationOptions(Args = args)

    let private configuredValues (configuration: IConfiguration) key =
        configuration.GetSection(key).GetChildren()
        |> Seq.choose (fun entry ->
            if String.IsNullOrWhiteSpace(entry.Value) then
                None
            else
                Some entry.Value)
        |> Seq.toList

    let private forwardedHeaderSources (configuration: IConfiguration) =
        match configuration["ForwardedHeaders:Enabled"] with
        | null -> Ok None
        | value when String.Equals(value, "false", StringComparison.OrdinalIgnoreCase) -> Ok None
        | value when not (String.Equals(value, "true", StringComparison.OrdinalIgnoreCase)) ->
            Error "ForwardedHeaders:Enabled must be true or false."
        | _ ->
            let proxyValues = configuredValues configuration "ForwardedHeaders:KnownProxies"
            let networkValues = configuredValues configuration "ForwardedHeaders:KnownNetworks"

            let proxies =
                proxyValues
                |> List.map IPAddress.TryParse
                |> fun parsed ->
                    if parsed |> List.forall fst then
                        parsed |> List.map snd |> Ok
                    else
                        Error "ForwardedHeaders:KnownProxies contains an invalid address."

            let networks =
                networkValues
                |> List.map System.Net.IPNetwork.TryParse
                |> fun parsed ->
                    if parsed |> List.forall fst then
                        parsed |> List.map snd |> Ok
                    else
                        Error "ForwardedHeaders:KnownNetworks contains an invalid network."

            match proxies, networks with
            | Ok [], Ok [] -> Error "Forwarded headers are enabled without a known proxy or network."
            | Ok validProxies, Ok validNetworks ->
                Ok(
                    Some
                        { Proxies = validProxies
                          Networks = validNetworks }
                )
            | Error problem, _
            | _, Error problem -> Error problem

    let private configureForwardedHeaders (builder: WebApplicationBuilder) (sources: ForwardedHeaderSources) =
        builder.Services.Configure<ForwardedHeadersOptions>(fun (options: ForwardedHeadersOptions) ->
            options.ForwardedHeaders <- ForwardedHeaders.XForwardedFor ||| ForwardedHeaders.XForwardedProto
            options.KnownProxies.Clear()
            options.KnownIPNetworks.Clear()
            sources.Proxies |> List.iter options.KnownProxies.Add
            sources.Networks |> List.iter options.KnownIPNetworks.Add)
        |> ignore

    let private configureApplication (processForwardedHeaders: bool) (application: WebApplication) : WebApplication =
        if processForwardedHeaders then
            application.UseForwardedHeaders() |> ignore

        application.Use(fun (context: HttpContext) (next: RequestDelegate) ->
            context.Response.Headers.ContentSecurityPolicy <-
                "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'"

            context.Response.Headers["Permissions-Policy"] <-
                "camera=(), geolocation=(), microphone=(), payment=(), usb=()"

            context.Response.Headers["Referrer-Policy"] <- "no-referrer"
            context.Response.Headers["X-Content-Type-Options"] <- "nosniff"
            context.Response.Headers["X-Frame-Options"] <- "DENY"
            context.Response.Headers["Cross-Origin-Opener-Policy"] <- "same-origin-allow-popups"
            next.Invoke(context))
        |> ignore

        application.UseDefaultFiles() |> ignore
        application.UseStaticFiles() |> ignore
        application.UseGrpcWeb() |> ignore

        application.MapGet(
            "/healthz",
            Func<HttpContext, IResult>(fun context ->
                context.Response.Headers.CacheControl <- "no-store"
                Results.Text("{\"status\":\"ok\"}", "application/json", null, StatusCodes.Status200OK))
        )
        |> ignore

        application.MapGet(
            "/readyz",
            Func<HttpContext, Threading.Tasks.Task<IResult>>(fun context ->
                task {
                    context.Response.Headers.CacheControl <- "no-store"
                    let contentClient = context.RequestServices.GetRequiredService<ContentClient>()
                    let! catalog = contentClient.GetCatalog(context.RequestAborted)

                    return
                        match catalog with
                        | Ok _ -> Results.Text("{\"status\":\"ready\"}", "application/json")
                        | Error _ ->
                            Results.Text(
                                "{\"status\":\"unavailable\"}",
                                "application/json",
                                null,
                                StatusCodes.Status503ServiceUnavailable
                            )
                })
        )
        |> ignore

        Auth.mapOAuthEndpoints application
        application.MapGrpcService<SessionGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<ContentGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<PublicationGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<StatisticsGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<CvGrpcService>().EnableGrpcWeb() |> ignore
        application.MapFallbackToFile("/demo/{*path:nonfile}", "index.html") |> ignore
        application

    let private liveContentClient
        (configuration: IConfiguration)
        : ContentClient * GitHubPublication.Client * HttpClient option * IHostedService option =
        match GitHubContentConfiguration.tryCreate configuration with
        | Error _ -> ContentClient.configurationInvalid (), GitHubPublication.unavailable, None, None
        | Ok githubConfiguration ->
            let httpClient = new HttpClient()
            let generation = ContentCacheGeneration()

            let contentClient =
                GitHubContentClient.createWithGeneration
                    httpClient
                    githubConfiguration
                    (fun () -> DateTimeOffset.UtcNow)
                    generation

            let worker =
                new ContentCacheRefreshWorker(ContentHeadProbe.live httpClient githubConfiguration, generation)

            let publication =
                GitHubPublication.live httpClient githubConfiguration generation (fun () -> DateTimeOffset.UtcNow)

            contentClient, publication, Some httpClient, Some worker

    let createWithContentClientAndStats
        (args: string array)
        (contentClient: ContentClient)
        (statsStore: Stats.Store)
        (allowLocalHttpStatsCookie: bool)
        (randomBytes: int -> byte array)
        (now: unit -> DateTimeOffset)
        : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let authHttpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(10.0))

        builder.Services.AddGrpc() |> ignore
        builder.Services.AddSingleton<ContentClient>(contentClient) |> ignore

        builder.Services.AddSingleton<GitHubPublication.Client>(GitHubPublication.unavailable)
        |> ignore

        let statsRuntime: Stats.BrowserRuntime =
            { Store = statsStore
              ContentClient = contentClient
              AllowLocalHttpCookie = allowLocalHttpStatsCookie
              RandomBytes = randomBytes
              Now = now }

        builder.Services.AddSingleton<Stats.BrowserRuntime>(statsRuntime) |> ignore

        Auth.configureServices
            builder.Services
            builder.Configuration
            allowLocalHttpStatsCookie
            authHttpClient
            now
            Auth.randomBytes

        Cv.configureServices
            builder.Services
            builder.Configuration
            allowLocalHttpStatsCookie
            now
            Auth.randomBytes
            Auth.keyRingAvailable
            Cv.SecretFilePath

        let application = builder.Build()

        application.Lifetime.ApplicationStopping.Register(Action(authHttpClient.Dispose))
        |> ignore

        application.Lifetime.ApplicationStopping.Register(Action(statsStore.Shutdown))
        |> ignore

        configureApplication false application

    let createWithContentClient (args: string array) (contentClient: ContentClient) : WebApplication =
        let now () = DateTimeOffset.UtcNow
        let statsStore = Stats.unavailableStore now

        createWithContentClientAndStats args contentClient statsStore false Stats.randomBytes now

    let create (args: string array) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)

        let forwardedHeaders = forwardedHeaderSources builder.Configuration

        if builder.Environment.IsProduction() then
            [ Auth.validateProductionConfiguration builder.Configuration
              Cv.validateProductionConfiguration builder.Configuration
              forwardedHeaders |> Result.map ignore ]
            |> List.choose (function
                | Error problem -> Some problem
                | Ok _ -> None)
            |> function
                | [] -> ()
                | problems -> raise (InvalidOperationException(String.Join(" ", problems)))

        match forwardedHeaders with
        | Ok(Some sources) -> configureForwardedHeaders builder sources
        | Ok None
        | Error _ -> ()

        let contentClient, publication, httpClient, refreshWorker =
            liveContentClient builder.Configuration

        let now () = DateTimeOffset.UtcNow
        let statsStore = Stats.createStore builder.Configuration now
        let authHttpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(10.0))

        builder.Services.AddGrpc() |> ignore
        builder.Services.AddSingleton<ContentClient>(contentClient) |> ignore
        builder.Services.AddSingleton<GitHubPublication.Client>(publication) |> ignore

        match refreshWorker with
        | Some worker -> builder.Services.AddSingleton<IHostedService>(worker) |> ignore
        | None -> ()

        let statsRuntime: Stats.BrowserRuntime =
            { Store = statsStore
              ContentClient = contentClient
              AllowLocalHttpCookie = builder.Environment.IsDevelopment()
              RandomBytes = Stats.randomBytes
              Now = now }

        builder.Services.AddSingleton<Stats.BrowserRuntime>(statsRuntime) |> ignore

        Auth.configureServices
            builder.Services
            builder.Configuration
            (builder.Environment.IsDevelopment())
            authHttpClient
            now
            Auth.randomBytes

        Cv.configureServices
            builder.Services
            builder.Configuration
            (builder.Environment.IsDevelopment())
            now
            Auth.randomBytes
            Auth.keyRingAvailable
            Cv.SecretFilePath

        let application = builder.Build()

        application.Lifetime.ApplicationStopping.Register(Action(authHttpClient.Dispose))
        |> ignore

        match httpClient with
        | Some value ->
            application.Lifetime.ApplicationStopping.Register(Action(value.Dispose))
            |> ignore
        | None -> ()

        application.Lifetime.ApplicationStopping.Register(Action(statsStore.Shutdown))
        |> ignore

        configureApplication (forwardedHeaders |> Result.toOption |> Option.flatten |> Option.isSome) application
