namespace Termin.Al.Host.Tests

open Termin.Al.Host

[<RequireQualifiedAccess>]
module PublicationMediaTests =
    let private candidate destinationPath mediaType bytes : PublicationMedia.Candidate =
        { DestinationPath = destinationPath
          DeclaredMediaType = mediaType
          Bytes = bytes }

    let private requireValid
        (result: Result<PublicationMedia.Validated list, PublicationMedia.ValidationFailure list>)
        =
        match result with
        | Ok value -> value
        | Error failures ->
            failures
            |> List.map (fun failure -> $"{failure.Field}: {failure.Message}")
            |> String.concat "; "
            |> failwith

    let private requireInvalid
        (result: Result<PublicationMedia.Validated list, PublicationMedia.ValidationFailure list>)
        =
        match result with
        | Error failures when not (List.isEmpty failures) -> ()
        | Error _ -> failwith "Expected a publication-media validation failure."
        | Ok _ -> failwith "Expected publication media to be rejected."

    let private png trailingLength =
        Array.concat
            [ [| 0x89uy; 0x50uy; 0x4euy; 0x47uy; 0x0duy; 0x0auy; 0x1auy; 0x0auy |]
              Array.zeroCreate trailingLength ]

    let private jpeg = [| 0xffuy; 0xd8uy; 0xffuy |]

    let private webp =
        [| 0x52uy
           0x49uy
           0x46uy
           0x46uy
           0uy
           0uy
           0uy
           0uy
           0x57uy
           0x45uy
           0x42uy
           0x50uy |]

    let private gif = [| 0x47uy; 0x49uy; 0x46uy; 0x38uy; 0x39uy; 0x61uy |]

    let run () =
        let documentPath = "blog/engineering/interfaces/example.md"
        let prefix = "assets/blog/engineering/interfaces/example/"

        let accepted =
            PublicationMedia.validate
                documentPath
                [ candidate (prefix + "image.png") "image/png" (png 0)
                  candidate (prefix + "photo.jpg") "image/jpeg" jpeg
                  candidate (prefix + "photo.jpeg") "image/jpeg" jpeg
                  candidate (prefix + "diagram.webp") "image/webp" webp
                  candidate (prefix + "animation.gif") "image/gif" gif ]
            |> requireValid

        if accepted.Length <> 5 || accepted[0].DestinationPath <> prefix + "image.png" then
            failwith "Recursive publication-media destinations changed."

        [ [ candidate (prefix + "image.png") "image/jpeg" (png 0) ]
          [ candidate (prefix + "image.jpg") "image/jpeg" (png 0) ]
          [ candidate (prefix + "image.jpg") "image/jpg" jpeg ]
          [ candidate (prefix + "image.PNG") "image/png" (png 0) ]
          [ candidate (prefix + "../image.png") "image/png" (png 0) ]
          [ candidate "assets/blog/example/image.png" "image/png" (png 0) ]
          [ candidate (prefix + "same.png") "image/png" (png 0)
            candidate (prefix + "same.png") "image/png" (png 0) ] ]
        |> List.iter (PublicationMedia.validate documentPath >> requireInvalid)

        PublicationMedia.validate
            "notes/runtime/deep/example.md"
            [ candidate "assets/notes/runtime/deep/example/image.png" "image/png" (png 0) ]
        |> requireValid
        |> ignore

        let beyondFormerByteLimit = png (6 * 1024 * 1024)

        let beyondFormerAggregateAndCountLimits =
            [ candidate (prefix + "large-a.png") "image/png" beyondFormerByteLimit
              candidate (prefix + "large-b.png") "image/png" beyondFormerByteLimit ]
            @ ([ 0..100 ]
               |> List.map (fun index -> candidate (prefix + $"image-{index}.png") "image/png" (png 0)))

        let unlimited =
            PublicationMedia.validate documentPath beyondFormerAggregateAndCountLimits
            |> requireValid

        if unlimited.Length <> 103 then
            failwith "Publication media must not impose application-owned byte, aggregate, or count limits."
