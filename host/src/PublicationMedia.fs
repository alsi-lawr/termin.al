namespace Termin.Al.Host

open System

[<RequireQualifiedAccess>]
module PublicationMedia =
    type Candidate =
        { DestinationPath: string
          DeclaredMediaType: string
          Bytes: byte array }

    type Validated =
        { DestinationPath: string
          MediaType: string
          Bytes: byte array }

    type ValidationFailure = { Field: string; Message: string }

    let private failure field message = { Field = field; Message = message }

    let private isCanonicalSegment (value: string) =
        value.Length > 0
        && value.Length <= 128
        && ((value[0] >= 'A' && value[0] <= 'Z')
            || (value[0] >= 'a' && value[0] <= 'z')
            || (value[0] >= '0' && value[0] <= '9'))
        && value
           |> Seq.forall (fun character ->
               (character >= 'A' && character <= 'Z')
               || (character >= 'a' && character <= 'z')
               || (character >= '0' && character <= '9')
               || character = '_'
               || character = '.'
               || character = '-')

    let private canonicalDocumentStem (documentPath: string) =
        if
            String.IsNullOrEmpty documentPath
            || documentPath.Length > 512
            || documentPath.Contains(char 0)
        then
            None
        else
            let segments = documentPath.Split('/')
            let root = segments |> Array.tryHead
            let fileName = segments |> Array.tryLast

            match root, fileName with
            | Some root, Some fileName when
                segments.Length >= 2
                && (root = "blog" || root = "notes")
                && segments |> Array.forall isCanonicalSegment
                && fileName.EndsWith(".md", StringComparison.Ordinal)
                ->
                let slug = fileName.Substring(0, fileName.Length - 3)

                if
                    slug.Length > 0
                    && slug.Length <= 64
                    && slug[0] >= 'a'
                    && slug[0] <= 'z'
                    && slug
                       |> Seq.forall (fun character ->
                           (character >= 'a' && character <= 'z')
                           || (character >= '0' && character <= '9')
                           || character = '-')
                then
                    Some(documentPath.Substring(0, documentPath.Length - 3))
                else
                    None
            | _ -> None

    let private hasBytes (bytes: byte array) offset (expected: byte array) =
        not (isNull bytes)
        && bytes.Length >= offset + expected.Length
        && expected
           |> Array.mapi (fun index value -> bytes[offset + index] = value)
           |> Array.forall id

    let private signatureMatches mediaType bytes =
        match mediaType with
        | "image/png" -> hasBytes bytes 0 [| 0x89uy; 0x50uy; 0x4euy; 0x47uy; 0x0duy; 0x0auy; 0x1auy; 0x0auy |]
        | "image/jpeg" -> hasBytes bytes 0 [| 0xffuy; 0xd8uy; 0xffuy |]
        | "image/webp" ->
            hasBytes bytes 0 [| 0x52uy; 0x49uy; 0x46uy; 0x46uy |]
            && hasBytes bytes 8 [| 0x57uy; 0x45uy; 0x42uy; 0x50uy |]
        | "image/gif" ->
            hasBytes bytes 0 [| 0x47uy; 0x49uy; 0x46uy; 0x38uy; 0x37uy; 0x61uy |]
            || hasBytes bytes 0 [| 0x47uy; 0x49uy; 0x46uy; 0x38uy; 0x39uy; 0x61uy |]
        | _ -> false

    let private expectedMediaType (fileName: string) =
        if fileName.EndsWith(".png", StringComparison.Ordinal) then
            Some "image/png"
        elif
            fileName.EndsWith(".jpg", StringComparison.Ordinal)
            || fileName.EndsWith(".jpeg", StringComparison.Ordinal)
        then
            Some "image/jpeg"
        elif fileName.EndsWith(".webp", StringComparison.Ordinal) then
            Some "image/webp"
        elif fileName.EndsWith(".gif", StringComparison.Ordinal) then
            Some "image/gif"
        else
            None

    let validate (documentPath: string) (candidates: Candidate list) : Result<Validated list, ValidationFailure list> =
        match canonicalDocumentStem documentPath with
        | None ->
            Error
                [ failure
                      "document.path"
                      "Publication media requires a canonical recursive blog or notes Markdown path." ]
        | Some documentStem ->
            let expectedPrefix = "assets/" + documentStem + "/"

            let duplicateDestinations =
                candidates
                |> List.countBy (fun candidate -> candidate.DestinationPath)
                |> List.filter (fun (_, count) -> count > 1)
                |> List.map fst
                |> Set.ofList

            let validateCandidate index (candidate: Candidate) =
                let field = $"assets[{index}]"

                if duplicateDestinations.Contains candidate.DestinationPath then
                    Error(failure (field + ".destination_path") "Publication media destination paths must be unique.")
                elif
                    String.IsNullOrEmpty candidate.DestinationPath
                    || isNull candidate.Bytes
                    || not (candidate.DestinationPath.StartsWith(expectedPrefix, StringComparison.Ordinal))
                    || candidate.DestinationPath.Length > 512
                then
                    Error(
                        failure
                            (field + ".destination_path")
                            "Publication media must use its complete document-derived recursive destination."
                    )
                else
                    let fileName = candidate.DestinationPath.Substring(expectedPrefix.Length)

                    if not (isCanonicalSegment fileName) then
                        Error(
                            failure
                                (field + ".destination_path")
                                "Publication media filenames must be one traversal-free canonical segment."
                        )
                    else
                        match expectedMediaType fileName with
                        | None ->
                            Error(
                                failure
                                    (field + ".destination_path")
                                    "Publication media requires a canonical PNG, JPEG, WebP, or GIF extension."
                            )
                        | Some expected when candidate.DeclaredMediaType <> expected ->
                            Error(
                                failure
                                    (field + ".declared_media_type")
                                    "Publication media extension and declared media type must match exactly."
                            )
                        | Some expected when not (signatureMatches expected candidate.Bytes) ->
                            Error(
                                failure
                                    (field + ".bytes")
                                    "Publication media signature must match its declared media type and extension."
                            )
                        | Some expected ->
                            Ok
                                { DestinationPath = candidate.DestinationPath
                                  MediaType = expected
                                  Bytes = candidate.Bytes }

            let results = candidates |> List.mapi validateCandidate

            let failures =
                results
                |> List.choose (function
                    | Error value -> Some value
                    | Ok _ -> None)

            if List.isEmpty failures then
                results
                |> List.choose (function
                    | Ok value -> Some value
                    | Error _ -> None)
                |> Ok
            else
                Error failures
