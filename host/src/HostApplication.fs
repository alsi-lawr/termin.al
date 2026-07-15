namespace Termin.Al.Host

open System
open System.IO
open System.Net.Http
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http
open Microsoft.Extensions.Configuration

[<RequireQualifiedAccess>]
module HostApplication =
    let private createOptions (args: string array) : WebApplicationOptions =
        let webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")

        if Directory.Exists(webRootPath) then
            WebApplicationOptions(Args = args, WebRootPath = webRootPath)
        else
            WebApplicationOptions(Args = args)

    let private configureApplication (application: WebApplication) (contentClient: ContentClient) : WebApplication =
        application.UseDefaultFiles() |> ignore
        application.UseStaticFiles() |> ignore

        application.MapGet(
            "/healthz",
            Func<HttpContext, IResult>(fun context ->
                context.Response.Headers.CacheControl <- "no-store"
                Results.Text("{\"status\":\"ok\"}", "application/json", null, StatusCodes.Status200OK))
        )
        |> ignore

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

    let createWithContentClient (args: string array) (contentClient: ContentClient) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let application = builder.Build()
        configureApplication application contentClient

    let create (args: string array) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let contentClient, httpClient = liveContentClient builder.Configuration
        let application = builder.Build()

        match httpClient with
        | Some value ->
            application.Lifetime.ApplicationStopping.Register(Action(value.Dispose))
            |> ignore
        | None -> ()

        configureApplication application contentClient
