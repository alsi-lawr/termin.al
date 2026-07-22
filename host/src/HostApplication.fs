namespace Termin.Al.Host

open System
open System.IO
open System.Net.Http
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration
open Microsoft.Extensions.Hosting

[<RequireQualifiedAccess>]
module HostApplication =
    let private createOptions (args: string array) : WebApplicationOptions =
        let webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")

        if Directory.Exists(webRootPath) then
            WebApplicationOptions(Args = args, WebRootPath = webRootPath)
        else
            WebApplicationOptions(Args = args)

    let private configureApplication
        (application: WebApplication)
        (contentClient: ContentClient)
        (statsStore: Stats.Store)
        (allowLocalHttpStatsCookie: bool)
        (randomBytes: int -> byte array)
        (now: unit -> DateTimeOffset)
        (statsHeartbeatInterval: TimeSpan)
        : WebApplication =
        application.UseDefaultFiles() |> ignore
        application.UseStaticFiles() |> ignore

        application.MapGet(
            "/healthz",
            Func<HttpContext, IResult>(fun context ->
                context.Response.Headers.CacheControl <- "no-store"
                Results.Text("{\"status\":\"ok\"}", "application/json", null, StatusCodes.Status200OK))
        )
        |> ignore

        Stats.mapEndpoints
            application
            statsStore
            contentClient
            allowLocalHttpStatsCookie
            randomBytes
            now
            statsHeartbeatInterval

        Auth.mapEndpoints application
        Cv.mapEndpoints application

        Api.mapEndpoints application contentClient

        application.MapFallbackToFile("/demo/{*path:nonfile}", "index.html") |> ignore

        application

    let private liveContentClient (configuration: IConfiguration) : ContentClient * HttpClient option =
        match GitHubContentConfiguration.tryCreate configuration with
        | Error _ -> ContentClient.configurationInvalid (), None
        | Ok githubConfiguration ->
            let httpClient = new HttpClient()

            let contentClient =
                GitHubContentClient.create httpClient githubConfiguration (fun () -> DateTimeOffset.UtcNow)

            contentClient, Some httpClient

    let createWithContentClientAndStats
        (args: string array)
        (contentClient: ContentClient)
        (statsStore: Stats.Store)
        (allowLocalHttpStatsCookie: bool)
        (randomBytes: int -> byte array)
        (now: unit -> DateTimeOffset)
        (statsHeartbeatInterval: TimeSpan)
        : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let authHttpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(10.0))

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

        let application = builder.Build()

        application.Lifetime.ApplicationStopping.Register(Action(authHttpClient.Dispose))
        |> ignore

        application.Lifetime.ApplicationStopping.Register(Action(statsStore.Shutdown))
        |> ignore

        configureApplication
            application
            contentClient
            statsStore
            allowLocalHttpStatsCookie
            randomBytes
            now
            statsHeartbeatInterval

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
            (TimeSpan.FromSeconds(30.0))

    let create (args: string array) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let contentClient, httpClient = liveContentClient builder.Configuration
        let now () = DateTimeOffset.UtcNow
        let statsStore = Stats.createStore builder.Configuration now
        let authHttpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(10.0))

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

        configureApplication
            application
            contentClient
            statsStore
            (builder.Environment.IsDevelopment())
            Stats.randomBytes
            now
            (TimeSpan.FromSeconds(30.0))
