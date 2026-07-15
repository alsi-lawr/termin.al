namespace Termin.Al.Host.Tests

open System
open System.Net
open System.Net.Http
open Microsoft.AspNetCore.Hosting.Server
open Microsoft.AspNetCore.Hosting.Server.Features
open Microsoft.Extensions.DependencyInjection
open Microsoft.Extensions.Hosting
open Termin.Al.Host

module Program =
    let private runHealthCheck () : int =
        let application = HostApplication.create [||]
        application.Urls.Add("http://127.0.0.1:0")

        try
            application.StartAsync().GetAwaiter().GetResult()

            let server = application.Services.GetRequiredService<IServer>()
            let addresses = server.Features.Get<IServerAddressesFeature>()

            if isNull addresses then
                failwith "The test host did not publish a server address."

            let address = addresses.Addresses |> Seq.exactlyOne
            use client = new HttpClient()
            client.BaseAddress <- Uri(address)
            use response = client.GetAsync("/healthz").GetAwaiter().GetResult()

            if response.StatusCode <> HttpStatusCode.OK then
                failwithf
                    "Expected GET /healthz to return 200 OK, but received %O."
                    response.StatusCode

            0
        finally
            application.StopAsync().GetAwaiter().GetResult()
            application.DisposeAsync().AsTask().GetAwaiter().GetResult()

    [<EntryPoint>]
    let main _ =
        try
            runHealthCheck ()
        with error ->
            eprintfn "Host health check failed: %s" error.Message
            1
