namespace Termin.Al.Host

open System
open System.IO
open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Http

[<RequireQualifiedAccess>]
module HostApplication =
    let private createOptions (args: string array) : WebApplicationOptions =
        let webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")

        if Directory.Exists(webRootPath) then
            WebApplicationOptions(Args = args, WebRootPath = webRootPath)
        else
            WebApplicationOptions(Args = args)

    let create (args: string array) : WebApplication =
        let builder = WebApplication.CreateBuilder(createOptions args)
        let application = builder.Build()

        application.UseDefaultFiles() |> ignore
        application.UseStaticFiles() |> ignore

        application.MapGet("/healthz", Func<IResult>(fun () -> Results.Ok()))
        |> ignore

        Api.mapEndpoints application
        application
