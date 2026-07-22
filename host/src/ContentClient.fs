namespace Termin.Al.Host

open System.Threading
open System.Threading.Tasks

type ContentClient =
    abstract GetRepositoryBase: CancellationToken -> Task<Result<ContentDomain.RepositoryBase, ContentDomain.Problem>>
    abstract GetCatalog: CancellationToken -> Task<Result<ContentDomain.Catalog, ContentDomain.Problem>>

    abstract GetDocument:
        ContentDomain.ContentId * CancellationToken ->
            Task<Result<ContentDomain.ContentDocument, ContentDomain.Problem>>

    abstract GetProjects: CancellationToken -> Task<Result<ContentDomain.Projects, ContentDomain.Problem>>
    abstract GetNow: CancellationToken -> Task<Result<ContentDomain.Now, ContentDomain.Problem>>
    abstract GetChangelog: CancellationToken -> Task<Result<ContentDomain.Changelog, ContentDomain.Problem>>

[<RequireQualifiedAccess>]
module ContentClient =
    let configurationInvalid () : ContentClient =
        { new ContentClient with
            member _.GetRepositoryBase _ =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                )

            member _.GetCatalog _ =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                )

            member _.GetDocument(_, _) =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                )

            member _.GetProjects _ =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                )

            member _.GetNow _ =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                )

            member _.GetChangelog _ =
                Task.FromResult(
                    Error(
                        ContentDomain.Problem.create
                            ContentDomain.ConfigurationInvalid
                            "GitHub content configuration is required."
                    )
                ) }
