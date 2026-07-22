namespace Termin.Al.Host

open System
open System.IO
open System.Net.Http
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting

[<RequireQualifiedAccess>]
module HostApplication =
    let private createOptions (args: string array) : WebApplicationOptions =
        let webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")

        if Directory.Exists(webRootPath) then
            WebApplicationOptions(Args = args, WebRootPath = webRootPath)
        else
            WebApplicationOptions(Args = args)

    let private configureApplication (application: WebApplication) : WebApplication =
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

        Auth.mapOAuthEndpoints application
        application.MapGrpcService<SessionGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<ContentGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<StatisticsGrpcService>().EnableGrpcWeb() |> ignore
        application.MapGrpcService<CvGrpcService>().EnableGrpcWeb() |> ignore
        application.MapFallbackToFile("/demo/{*path:nonfile}", "index.html") |> ignore
        application

    let private liveContentClient
        (configuration: IConfiguration)
        : ContentClient * HttpClient option * IHostedService option =
        match GitHubContentConfiguration.tryCreate configuration with
        | Error _ -> ContentClient.configurationInvalid (), None, None
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
                new ContentCacheRefreshWorker(
                    ContentHeadProbe.live httpClient githubConfiguration,
                    generation,
                    ContentCacheRefresh.liveDelay
                )

            contentClient, Some httpClient, Some worker

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

        configureApplication application

    let createWithContentClient (args: string array) (contentClient: ContentClient) : WebApplication =
        let now () = DateTimeOffset.UtcNow
        let statsStore = Stats.unavailableStore now

        createWithContentClientAndStats
            args
            contentClient
            statsStore
            false
            Stats.randomBytes
            now

    let create (args: string array) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)

        let contentClient, httpClient, refreshWorker =
            liveContentClient builder.Configuration

        let now () = DateTimeOffset.UtcNow
        let statsStore = Stats.createStore builder.Configuration now
        let authHttpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(10.0))

        builder.Services.AddGrpc() |> ignore
        builder.Services.AddSingleton<ContentClient>(contentClient) |> ignore

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

        configureApplication application
