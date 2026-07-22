namespace Termin.Al.Host

open System
open System.Text.Json

[<RequireQualifiedAccess>]
module CatalogManifest =
    type Document =
        { ManifestDocumentPath: ContentDomain.RepositoryPath
          ManifestVirtualPath: ContentDomain.VirtualPath
          ManifestUpdatedAt: ContentDomain.Timestamp }

    type Data =
        { ManifestCatalogEntries: ContentDomain.CatalogEntry list
          ManifestDocumentsById: Map<string, Document>
          ManifestRawEntries: JsonElement list }

    let private validation (result: ContentDomain.ValidationResult<'value>) =
        result |> Result.mapError (fun failure -> $"{failure.Field}: {failure.Message}")

    let private requiredString (name: string) (element: JsonElement) =
        let mutable value = Unchecked.defaultof<JsonElement>

        if element.TryGetProperty(name, &value) && value.ValueKind = JsonValueKind.String then
            match value.GetString() with
            | null -> Error $"{name} is required."
            | text -> Ok text
        else
            Error $"{name} is required."

    let private requiredInteger (name: string) (element: JsonElement) =
        let mutable value = Unchecked.defaultof<JsonElement>
        let mutable number = 0

        if
            element.TryGetProperty(name, &value)
            && value.ValueKind = JsonValueKind.Number
            && value.TryGetInt32(&number)
        then
            Ok number
        else
            Error $"{name} must be an integer."

    let private hasOnlyProperties names (element: JsonElement) =
        let expected = names |> Set.ofList

        let actual =
            element.EnumerateObject()
            |> Seq.map (fun property -> property.Name)
            |> Set.ofSeq

        expected = actual

    let private parseEntry (element: JsonElement) =
        if element.ValueKind <> JsonValueKind.Object then
            Error "Catalog entries must be objects."
        else
            match requiredString "kind" element with
            | Error message -> Error message
            | Ok kind ->
                let expected =
                    match kind with
                    | "directory"
                    | "locked-file" -> [ "kind"; "id"; "path"; "updatedAt"; "size" ]
                    | "file" -> [ "kind"; "id"; "path"; "updatedAt"; "size"; "documentHandle"; "sourcePath" ]
                    | _ -> []

                if List.isEmpty expected || not (hasOnlyProperties expected element) then
                    Error "Catalog entry fields are invalid."
                else
                    match
                        requiredString "id" element,
                        requiredString "path" element,
                        requiredString "updatedAt" element,
                        requiredInteger "size" element
                    with
                    | Ok id, Ok path, Ok updatedAt, Ok size ->
                        match
                            validation (ContentDomain.CatalogId.tryCreate "catalog.id" id),
                            validation (ContentDomain.VirtualPath.tryCreate "catalog.path" path),
                            validation (ContentDomain.Timestamp.tryCreate "catalog.updatedAt" updatedAt),
                            validation (ContentDomain.ByteSize.tryCreate "catalog.size" size)
                        with
                        | Ok parsedId, Ok parsedPath, Ok parsedUpdatedAt, Ok parsedSize ->
                            match kind with
                            | "directory" ->
                                Ok(ContentDomain.Directory(parsedId, parsedPath, parsedUpdatedAt, parsedSize), None)
                            | "locked-file" ->
                                Ok(ContentDomain.LockedFile(parsedId, parsedPath, parsedUpdatedAt, parsedSize), None)
                            | "file" ->
                                match requiredString "documentHandle" element, requiredString "sourcePath" element with
                                | Ok handle, Ok sourcePath ->
                                    match
                                        validation (ContentDomain.ContentId.tryCreate "catalog.documentHandle" handle),
                                        validation (
                                            ContentDomain.RepositoryPath.tryCreate "catalog.sourcePath" sourcePath
                                        )
                                    with
                                    | Ok parsedHandle, Ok parsedSourcePath ->
                                        Ok(
                                            ContentDomain.File(
                                                parsedId,
                                                parsedPath,
                                                parsedUpdatedAt,
                                                parsedSize,
                                                parsedHandle
                                            ),
                                            Some(
                                                ContentDomain.ContentId.value parsedHandle,
                                                { ManifestDocumentPath = parsedSourcePath
                                                  ManifestVirtualPath = parsedPath
                                                  ManifestUpdatedAt = parsedUpdatedAt }
                                            )
                                        )
                                    | Error message, _
                                    | _, Error message -> Error message
                                | Error message, _
                                | _, Error message -> Error message
                            | _ -> Error "Catalog entry kind is invalid."
                        | Error message, _, _, _
                        | _, Error message, _, _
                        | _, _, Error message, _
                        | _, _, _, Error message -> Error message
                    | Error message, _, _, _
                    | _, Error message, _, _
                    | _, _, Error message, _
                    | _, _, _, Error message -> Error message

    let private hasValidStructure entries =
        match
            ContentDomain.RepositoryName.tryCreate "catalog.repository" "validation/catalog",
            ContentDomain.RepositoryPath.tryCreate "catalog.source.path" "content/catalog.json",
            ContentDomain.ContentRevision.tryCreate "catalog.source.revision" "validation",
            ContentDomain.ContentUrl.tryCreate "catalog.source.url" "https://example.invalid/catalog",
            ContentDomain.Timestamp.tryCreate "catalog.cache.fetched" "2026-01-01T00:00:00.000Z",
            ContentDomain.Timestamp.tryCreate "catalog.cache.fresh" "2026-01-01T00:01:00.000Z",
            ContentDomain.Timestamp.tryCreate "catalog.cache.stale" "2026-01-01T00:02:00.000Z"
        with
        | Ok repository, Ok path, Ok revision, Ok url, Ok fetched, Ok fresh, Ok stale ->
            match ContentDomain.CacheMetadata.tryCreate ContentDomain.Fresh fetched fresh stale with
            | Error _ -> false
            | Ok cache ->
                let source = ContentDomain.ContentSource.create repository path revision url
                ContentDomain.Catalog.tryCreate source cache entries |> Result.isOk
        | _ -> false

    let tryParse (body: string) : Result<Data, string> =
        try
            use document = JsonDocument.Parse body
            let root = document.RootElement
            let mutable entries = Unchecked.defaultof<JsonElement>

            if
                root.ValueKind <> JsonValueKind.Object
                || not (hasOnlyProperties [ "entries" ] root)
                || not (root.TryGetProperty("entries", &entries))
                || entries.ValueKind <> JsonValueKind.Array
            then
                Error "Catalog manifests must contain only entries."
            else
                let rawEntries =
                    entries.EnumerateArray() |> Seq.map (fun entry -> entry.Clone()) |> Seq.toList

                if List.length rawEntries > ContentDomain.PageItemLimit then
                    Error "Catalog has too many entries."
                else
                    let rec parse pending parsedEntries documents (sourcePaths: Set<string>) =
                        match pending with
                        | [] ->
                            let catalogEntries = List.rev parsedEntries

                            if not (hasValidStructure catalogEntries) then
                                Error "Catalog entry structure is invalid."
                            else
                                Ok
                                    { ManifestCatalogEntries = catalogEntries
                                      ManifestDocumentsById = documents
                                      ManifestRawEntries = rawEntries }
                        | entry :: remaining ->
                            parseEntry entry
                            |> Result.bind (fun (catalogEntry, parsedDocument) ->
                                match parsedDocument with
                                | None -> parse remaining (catalogEntry :: parsedEntries) documents sourcePaths
                                | Some(documentId, locator) when Map.containsKey documentId documents ->
                                    Error "Catalog document handles are duplicated."
                                | Some(_, locator) when
                                    sourcePaths.Contains(
                                        ContentDomain.RepositoryPath.value locator.ManifestDocumentPath
                                    )
                                    ->
                                    Error "Catalog document source paths are duplicated."
                                | Some(documentId, locator) ->
                                    parse
                                        remaining
                                        (catalogEntry :: parsedEntries)
                                        (Map.add documentId locator documents)
                                        (sourcePaths.Add(
                                            ContentDomain.RepositoryPath.value locator.ManifestDocumentPath
                                        )))

                    parse rawEntries [] Map.empty Set.empty
        with :? JsonException ->
            Error "Catalog manifest JSON is invalid."
