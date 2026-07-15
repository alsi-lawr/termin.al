namespace Termin.Al.Host

open Microsoft.Extensions.Hosting

module Program =
    [<EntryPoint>]
    let main args =
        let application = HostApplication.create args
        application.Run()
        0
