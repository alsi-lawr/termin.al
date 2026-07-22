namespace Termin.Al.Host

open Microsoft.Extensions.Hosting

module Program =
    [<EntryPoint>]
    let main args =
        match args with
        | [| "generate-cv-key" |] ->
            let generated = Cv.generateViewerKey ()
            printfn "Viewer key (shown once): %s" generated.Plaintext
            printfn "Cv:ViewerKeyHash: %s" generated.CanonicalHash
            0
        | _ ->
            let application = HostApplication.create args
            application.Run()
            0
