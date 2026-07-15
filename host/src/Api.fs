namespace Termin.Al.Host

open Microsoft.AspNetCore.Builder
open Microsoft.AspNetCore.Routing

[<RequireQualifiedAccess>]
module Api =
    let mapEndpoints (routes: IEndpointRouteBuilder) : unit = routes.MapGroup("/api") |> ignore
