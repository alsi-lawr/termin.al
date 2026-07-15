namespace Termin.Al.Host

open System
open System.Collections.Generic
open System.Globalization
open System.Text
open System.Text.Json

[<RequireQualifiedAccess>]
module ContentDomain =
    [<Literal>]
    let DocumentByteLimit = 1_048_576

    [<Literal>]
    let PageItemLimit = 100

    [<Literal>]
    let FreshCacheMinutes = 5

    [<Literal>]
    let StaleCacheMinutes = 60

    [<Literal>]
    let GitHubTimeoutSeconds = 10

    type ValidationFailure = { Field: string; Message: string }

    type ValidationResult<'value> = Result<'value, ValidationFailure>

    let private invalid field message : ValidationResult<'value> =
        Error { Field = field; Message = message }

    let private isAsciiLetter value =
        (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')

    let private isAsciiDigit value = value >= '0' && value <= '9'

    let private isStableIdentifierCharacter value =
        isAsciiLetter value || isAsciiDigit value || value = '-' || value = '_'

    let private isSlugCharacter value =
        (value >= 'a' && value <= 'z') || isAsciiDigit value || value = '-'

    let private hasLengthAtMost limit (value: string) = value.Length <= limit

    let private hasText value = not (String.IsNullOrWhiteSpace value)

    type ContentId = private ContentId of string

    [<RequireQualifiedAccess>]
    module ContentId =
        let tryCreate field (value: string) : ValidationResult<ContentId> =
            if not (hasText value) then
                invalid field "A content identifier is required."
            elif value.Length > 64 then
                invalid field "A content identifier must be at most 64 characters."
            elif not (isAsciiLetter value.[0] || isAsciiDigit value.[0]) then
                invalid field "A content identifier must start with an ASCII letter or digit."
            elif value |> Seq.exists (isStableIdentifierCharacter >> not) then
                invalid field "A content identifier may contain only ASCII letters, digits, hyphens, and underscores."
            else
                Ok(ContentId value)

        let value (ContentId value) = value

    type ContentSlug = private ContentSlug of string

    [<RequireQualifiedAccess>]
    module ContentSlug =
        let tryCreate field (value: string) : ValidationResult<ContentSlug> =
            if not (hasText value) then
                invalid field "A slug is required."
            elif value.Length > 64 then
                invalid field "A slug must be at most 64 characters."
            elif not (value.[0] >= 'a' && value.[0] <= 'z' || isAsciiDigit value.[0]) then
                invalid field "A slug must start with a lowercase ASCII letter or digit."
            elif value |> Seq.exists (isSlugCharacter >> not) then
                invalid field "A slug may contain only lowercase ASCII letters, digits, and hyphens."
            else
                Ok(ContentSlug value)

        let value (ContentSlug value) = value

    type CatalogId = private CatalogId of string

    [<RequireQualifiedAccess>]
    module CatalogId =
        let tryCreate field (value: string) : ValidationResult<CatalogId> =
            ContentId.tryCreate field value |> Result.map (ContentId.value >> CatalogId)

        let value (CatalogId value) = value

    type VirtualPath = private VirtualPath of string

    [<RequireQualifiedAccess>]
    module VirtualPath =
        let private isSegment value =
            hasText value
            && value <> "."
            && value <> ".."
            && value.Length <= 128
            && (value
                |> Seq.forall (fun character ->
                    isAsciiLetter character
                    || isAsciiDigit character
                    || character = '-'
                    || character = '_'
                    || character = '.'))

        let tryCreate field (value: string) : ValidationResult<VirtualPath> =
            if value = "~" then
                Ok(VirtualPath value)
            elif not (hasText value) || not (value.StartsWith("~/", StringComparison.Ordinal)) then
                invalid field "A virtual path must be ~ or begin with ~/."
            elif value.IndexOf('\u0000') >= 0 || value.Length > 512 then
                invalid field "A virtual path contains an invalid character or is too long."
            else
                let segments = value.Substring(2).Split([| '/' |], StringSplitOptions.None)

                if segments |> Array.forall isSegment then
                    Ok(VirtualPath value)
                else
                    invalid field "A virtual path must contain canonical, traversal-free segments."

        let value (VirtualPath value) = value

        let parent (VirtualPath value) : string option =
            if value = "~" then
                None
            else
                value.LastIndexOf('/') |> fun index -> Some(value.Substring(0, index))

    type RepositoryPath = private RepositoryPath of string

    [<RequireQualifiedAccess>]
    module RepositoryPath =
        let private isSegment value =
            hasText value
            && value <> "."
            && value <> ".."
            && value.Length <= 128
            && (value
                |> Seq.forall (fun character ->
                    isAsciiLetter character
                    || isAsciiDigit character
                    || character = '-'
                    || character = '_'
                    || character = '.'))

        let tryCreate field (value: string) : ValidationResult<RepositoryPath> =
            if not (hasText value) || value.StartsWith("/", StringComparison.Ordinal) then
                invalid field "A repository path must be a non-empty relative path."
            elif value.IndexOf('\u0000') >= 0 || value.Length > 512 then
                invalid field "A repository path contains an invalid character or is too long."
            else
                let segments = value.Split([| '/' |], StringSplitOptions.None)

                if segments |> Array.forall isSegment then
                    Ok(RepositoryPath value)
                else
                    invalid field "A repository path must contain canonical, traversal-free segments."

        let value (RepositoryPath value) = value

    type RepositoryName = private RepositoryName of string

    [<RequireQualifiedAccess>]
    module RepositoryName =
        let private isSegment value =
            hasText value
            && value.Length <= 100
            && (value
                |> Seq.forall (fun character ->
                    isAsciiLetter character
                    || isAsciiDigit character
                    || character = '-'
                    || character = '_'
                    || character = '.'))

        let tryCreate field (value: string) : ValidationResult<RepositoryName> =
            let parts =
                if isNull value then
                    [||]
                else
                    value.Split([| '/' |], StringSplitOptions.None)

            if parts.Length <> 2 || parts |> Array.exists (isSegment >> not) then
                invalid field "A repository name must be owner/repository with canonical segments."
            else
                Ok(RepositoryName value)

        let value (RepositoryName value) = value

    type ContentRevision = private ContentRevision of string

    [<RequireQualifiedAccess>]
    module ContentRevision =
        let tryCreate field (value: string) : ValidationResult<ContentRevision> =
            let hasInvalidCharacter character =
                not (
                    isAsciiLetter character
                    || isAsciiDigit character
                    || character = '-'
                    || character = '_'
                    || character = '.'
                    || character = '/'
                )

            if
                not (hasText value)
                || value.Length > 128
                || value.StartsWith("/", StringComparison.Ordinal)
            then
                invalid field "A revision must be a non-empty bounded reference."
            elif
                value.Contains("..", StringComparison.Ordinal)
                || value |> Seq.exists hasInvalidCharacter
            then
                invalid field "A revision must not contain traversal or unsupported characters."
            else
                Ok(ContentRevision value)

        let value (ContentRevision value) = value

    type ContentUrl = private ContentUrl of Uri

    [<RequireQualifiedAccess>]
    module ContentUrl =
        let tryCreate field (value: string) : ValidationResult<ContentUrl> =
            match Uri.TryCreate(value, UriKind.Absolute) with
            | true, uri when uri.Scheme = Uri.UriSchemeHttps && String.IsNullOrEmpty uri.UserInfo -> Ok(ContentUrl uri)
            | _ -> invalid field "A source URL must be an absolute HTTPS URL without user information."

        let value (ContentUrl value) = value.AbsoluteUri

    type Timestamp = private Timestamp of DateTimeOffset

    [<RequireQualifiedAccess>]
    module Timestamp =
        let private format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"

        let tryCreate field (value: string) : ValidationResult<Timestamp> =
            match
                DateTimeOffset.TryParseExact(
                    value,
                    format,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal ||| DateTimeStyles.AdjustToUniversal
                )
            with
            | true, timestamp -> Ok(Timestamp timestamp)
            | false, _ -> invalid field "A timestamp must be an ISO-8601 UTC value with millisecond precision."

        let create (value: DateTimeOffset) = Timestamp(value.ToUniversalTime())

        let value (Timestamp value) =
            value.ToUniversalTime().ToString(format, CultureInfo.InvariantCulture)

        let compare (Timestamp left) (Timestamp right) = DateTimeOffset.Compare(left, right)

    type ContentTag = private ContentTag of string

    [<RequireQualifiedAccess>]
    module ContentTag =
        let tryCreate field (value: string) : ValidationResult<ContentTag> =
            let isTagCharacter character =
                isAsciiLetter character
                || isAsciiDigit character
                || character = '-'
                || character = '_'
                || character = '.'

            if not (hasText value) || value.Length > 128 then
                invalid field "A tag must be a non-empty value with at most 128 characters."
            elif value |> Seq.exists (isTagCharacter >> not) then
                invalid field "A tag may contain only ASCII letters, digits, dots, underscores, and hyphens."
            else
                Ok(ContentTag value)

        let value (ContentTag value) = value

    type ByteSize = private ByteSize of int

    [<RequireQualifiedAccess>]
    module ByteSize =
        let tryCreate field (value: int) : ValidationResult<ByteSize> =
            if value < 0 || value > DocumentByteLimit then
                invalid field "A content byte size must be between zero and the document limit."
            else
                Ok(ByteSize value)

        let value (ByteSize value) = value

    type ContentTitle = private ContentTitle of string

    [<RequireQualifiedAccess>]
    module ContentTitle =
        let tryCreate field (value: string) : ValidationResult<ContentTitle> =
            if not (hasText value) || value.Length > 200 then
                invalid field "A title must be non-empty and at most 200 characters."
            elif value.IndexOfAny([| '\r'; '\n'; '\u0000' |]) >= 0 then
                invalid field "A title must be a single line."
            else
                Ok(ContentTitle(value.Trim()))

        let value (ContentTitle value) = value

    type ContentSummary = private ContentSummary of string

    [<RequireQualifiedAccess>]
    module ContentSummary =
        let tryCreate field (value: string) : ValidationResult<ContentSummary> =
            if not (hasText value) || value.Length > 500 then
                invalid field "A summary must be non-empty and at most 500 characters."
            elif value.IndexOf('\u0000') >= 0 then
                invalid field "A summary must not contain a null character."
            else
                Ok(ContentSummary(value.Trim()))

        let value (ContentSummary value) = value

    type MarkdownBody = private MarkdownBody of string

    [<RequireQualifiedAccess>]
    module MarkdownBody =
        let tryCreate field (value: string) : ValidationResult<MarkdownBody> =
            if not (hasText value) then
                invalid field "A document body is required."
            elif value.IndexOf('\u0000') >= 0 then
                invalid field "A document body must not contain a null character."
            elif Encoding.UTF8.GetByteCount value > DocumentByteLimit then
                invalid field "A document body exceeds the 1 MiB limit."
            else
                Ok(MarkdownBody value)

        let value (MarkdownBody value) = value

    type ContentSource =
        { Repository: RepositoryName
          Path: RepositoryPath
          Revision: ContentRevision
          Url: ContentUrl }

    [<RequireQualifiedAccess>]
    module ContentSource =
        let create repository path revision url =
            { Repository = repository
              Path = path
              Revision = revision
              Url = url }

    type CacheState =
        | Fresh
        | Stale

    [<RequireQualifiedAccess>]
    module CacheState =
        let value =
            function
            | Fresh -> "fresh"
            | Stale -> "stale"

    type CacheMetadata =
        private
            { State: CacheState
              FetchedAt: Timestamp
              FreshUntil: Timestamp
              StaleUntil: Timestamp }

    [<RequireQualifiedAccess>]
    module CacheMetadata =
        let tryCreate state fetchedAt freshUntil staleUntil : ValidationResult<CacheMetadata> =
            if Timestamp.compare fetchedAt freshUntil > 0 then
                invalid "cache.freshUntil" "Fresh cache expiry cannot precede the fetch time."
            elif Timestamp.compare freshUntil staleUntil > 0 then
                invalid "cache.staleUntil" "Stale cache expiry cannot precede fresh cache expiry."
            else
                Ok
                    { State = state
                      FetchedAt = fetchedAt
                      FreshUntil = freshUntil
                      StaleUntil = staleUntil }

        let state cache = cache.State
        let fetchedAt cache = cache.FetchedAt
        let freshUntil cache = cache.FreshUntil
        let staleUntil cache = cache.StaleUntil

    type CatalogEntry =
        | Directory of id: CatalogId * path: VirtualPath * updatedAt: Timestamp * size: ByteSize
        | File of id: CatalogId * path: VirtualPath * updatedAt: Timestamp * size: ByteSize * documentHandle: ContentId
        | LockedFile of id: CatalogId * path: VirtualPath * updatedAt: Timestamp * size: ByteSize

    [<RequireQualifiedAccess>]
    module CatalogEntry =
        let id =
            function
            | Directory(id, _, _, _)
            | File(id, _, _, _, _)
            | LockedFile(id, _, _, _) -> id

        let path =
            function
            | Directory(_, path, _, _)
            | File(_, path, _, _, _)
            | LockedFile(_, path, _, _) -> path

        let documentHandle =
            function
            | File(_, _, _, _, handle) -> Some handle
            | Directory _
            | LockedFile _ -> None

    type Catalog =
        private
            { Entries: CatalogEntry list
              Source: ContentSource
              Cache: CacheMetadata }

    [<RequireQualifiedAccess>]
    module Catalog =
        let private directoryPaths entries =
            entries
            |> List.choose (function
                | Directory(_, path, _, _) -> Some(VirtualPath.value path)
                | File _
                | LockedFile _ -> None)
            |> Set.ofList

        let private hasDuplicate selector entries =
            let seen = HashSet<string>(StringComparer.Ordinal)

            entries
            |> List.tryPick (fun entry ->
                let value = selector entry

                if seen.Add value then None else Some value)

        let tryCreate source cache entries : ValidationResult<Catalog> =
            if List.length entries > PageItemLimit then
                invalid "catalog.entries" "A catalog cannot contain more than 100 entries."
            else
                match hasDuplicate (CatalogEntry.id >> CatalogId.value) entries with
                | Some duplicate -> invalid "catalog.entries" $"Catalog identifier '{duplicate}' is duplicated."
                | None ->
                    match hasDuplicate (CatalogEntry.path >> VirtualPath.value) entries with
                    | Some duplicate -> invalid "catalog.entries" $"Catalog path '{duplicate}' is duplicated."
                    | None ->
                        let handles =
                            entries
                            |> List.choose (CatalogEntry.documentHandle >> Option.map ContentId.value)

                        match
                            handles
                            |> List.tryFind (fun handle -> handles |> List.filter ((=) handle) |> List.length > 1)
                        with
                        | Some duplicate -> invalid "catalog.entries" $"Document handle '{duplicate}' is duplicated."
                        | None ->
                            let directories = directoryPaths entries
                            let hasRoot = directories.Contains "~"

                            if not hasRoot then
                                invalid "catalog.entries" "A catalog must contain the ~ root directory."
                            else
                                let missingParent =
                                    entries
                                    |> List.tryPick (fun entry ->
                                        CatalogEntry.path entry
                                        |> VirtualPath.parent
                                        |> Option.bind (fun parent ->
                                            if directories.Contains parent then None else Some parent))

                                match missingParent with
                                | Some parent ->
                                    invalid
                                        "catalog.entries"
                                        $"Catalog parent '{parent}' is missing or not a directory."
                                | None ->
                                    Ok
                                        { Entries = entries
                                          Source = source
                                          Cache = cache }

        let entries catalog = catalog.Entries
        let source catalog = catalog.Source
        let cache catalog = catalog.Cache

    type ParsedFrontMatter =
        { Id: ContentId
          Slug: ContentSlug option
          Title: ContentTitle
          UpdatedAt: Timestamp
          Tags: ContentTag list
          Body: MarkdownBody }

    [<RequireQualifiedAccess>]
    module FrontMatter =
        let private allowedKeys = Set.ofList [ "id"; "slug"; "title"; "updatedAt"; "tags" ]

        let private tryRequired fields key =
            match Map.tryFind key fields with
            | Some value when hasText value -> Ok value
            | _ -> invalid $"frontmatter.{key}" $"Front matter requires '{key}'."

        let private tryTags (value: string) : ValidationResult<ContentTag list> =
            if value = "" then
                Ok []
            else
                let rawTags = value.Split([| ',' |], StringSplitOptions.None) |> Array.toList

                let rec validate (pending: string list) (accumulated: ContentTag list) =
                    match pending with
                    | [] -> Ok(List.rev accumulated)
                    | tag :: remaining ->
                        ContentTag.tryCreate "frontmatter.tags" (tag.Trim())
                        |> Result.bind (fun valid -> validate remaining (valid :: accumulated))

                validate rawTags []
                |> Result.bind (fun tags ->
                    let values = tags |> List.map ContentTag.value

                    if values |> Set.ofList |> Set.count <> List.length values then
                        invalid "frontmatter.tags" "Front matter tags must not contain duplicates."
                    else
                        Ok tags)

        let tryParse (markdown: string) : ValidationResult<ParsedFrontMatter> =
            if
                not (hasText markdown)
                || Encoding.UTF8.GetByteCount markdown > DocumentByteLimit
            then
                invalid "document" "A document must be non-empty and at most 1 MiB."
            else
                let normalized = markdown.Replace("\r\n", "\n", StringComparison.Ordinal)
                let lines = normalized.Split([| '\n' |], StringSplitOptions.None)

                if lines.Length < 3 || lines.[0] <> "---" then
                    invalid "frontmatter" "A document must start with a front matter boundary."
                else
                    let closingIndex =
                        [ 1 .. lines.Length - 1 ] |> List.tryFind (fun index -> lines.[index] = "---")

                    match closingIndex with
                    | None -> invalid "frontmatter" "Front matter must end with a boundary."
                    | Some closing when closing = 1 ->
                        invalid "frontmatter" "Front matter must declare required fields."
                    | Some closing ->
                        let rec parseFields index fields =
                            if index = closing then
                                Ok fields
                            else
                                let line = lines.[index]
                                let separator = line.IndexOf(':')

                                if separator <= 0 then
                                    invalid "frontmatter" "Front matter fields must use key: value lines."
                                else
                                    let key = line.Substring(0, separator)
                                    let value = line.Substring(separator + 1).Trim()

                                    if not (allowedKeys.Contains key) then
                                        invalid "frontmatter" $"Front matter field '{key}' is not supported."
                                    elif Map.containsKey key fields then
                                        invalid "frontmatter" $"Front matter field '{key}' is duplicated."
                                    else
                                        parseFields (index + 1) (Map.add key value fields)

                        parseFields 1 Map.empty
                        |> Result.bind (fun fields ->
                            tryRequired fields "id"
                            |> Result.bind (ContentId.tryCreate "frontmatter.id")
                            |> Result.bind (fun id ->
                                tryRequired fields "title"
                                |> Result.bind (ContentTitle.tryCreate "frontmatter.title")
                                |> Result.bind (fun title ->
                                    tryRequired fields "updatedAt"
                                    |> Result.bind (Timestamp.tryCreate "frontmatter.updatedAt")
                                    |> Result.bind (fun updatedAt ->
                                        let slugResult =
                                            match Map.tryFind "slug" fields with
                                            | None -> Ok None
                                            | Some value ->
                                                ContentSlug.tryCreate "frontmatter.slug" value |> Result.map Some

                                        slugResult
                                        |> Result.bind (fun slug ->
                                            let tagsResult =
                                                match Map.tryFind "tags" fields with
                                                | None -> Ok []
                                                | Some value -> tryTags value

                                            tagsResult
                                            |> Result.bind (fun tags ->
                                                let body = lines.[closing + 1 ..] |> String.concat "\n"

                                                MarkdownBody.tryCreate "document.body" body
                                                |> Result.map (fun validBody ->
                                                    { Id = id
                                                      Slug = slug
                                                      Title = title
                                                      UpdatedAt = updatedAt
                                                      Tags = tags
                                                      Body = validBody })))))))

    type ContentDocument =
        private
            { Id: ContentId
              Slug: ContentSlug option
              Path: VirtualPath
              Title: ContentTitle
              UpdatedAt: Timestamp
              Tags: ContentTag list
              Body: MarkdownBody
              Source: ContentSource
              Cache: CacheMetadata }

    [<RequireQualifiedAccess>]
    module ContentDocument =
        let tryCreate path source cache markdown : ValidationResult<ContentDocument> =
            FrontMatter.tryParse markdown
            |> Result.map (fun frontMatter ->
                { Id = frontMatter.Id
                  Slug = frontMatter.Slug
                  Path = path
                  Title = frontMatter.Title
                  UpdatedAt = frontMatter.UpdatedAt
                  Tags = frontMatter.Tags
                  Body = frontMatter.Body
                  Source = source
                  Cache = cache })

        let id document = document.Id
        let slug document = document.Slug
        let path document = document.Path
        let title document = document.Title
        let updatedAt document = document.UpdatedAt
        let tags document = document.Tags
        let body document = document.Body
        let source document = document.Source
        let cache document = document.Cache

    type Project =
        private
            { Id: ContentId
              Slug: ContentSlug
              Name: ContentTitle
              Summary: ContentSummary
              Url: ContentUrl
              Repository: RepositoryName
              UpdatedAt: Timestamp
              Tags: ContentTag list }

    [<RequireQualifiedAccess>]
    module Project =
        let create id slug name summary url repository updatedAt tags =
            { Id = id
              Slug = slug
              Name = name
              Summary = summary
              Url = url
              Repository = repository
              UpdatedAt = updatedAt
              Tags = tags }

        let id project = project.Id
        let slug project = project.Slug
        let name project = project.Name
        let summary project = project.Summary
        let url project = project.Url
        let repository project = project.Repository
        let updatedAt project = project.UpdatedAt
        let tags project = project.Tags

    type Projects =
        private
            { Entries: Project list
              Source: ContentSource
              Cache: CacheMetadata }

    [<RequireQualifiedAccess>]
    module Projects =
        let tryCreate source cache entries : ValidationResult<Projects> =
            if List.length entries > PageItemLimit then
                invalid "projects" "A project collection cannot contain more than 100 projects."
            else
                let ids = entries |> List.map (Project.id >> ContentId.value)
                let slugs = entries |> List.map (Project.slug >> ContentSlug.value)

                if ids |> Set.ofList |> Set.count <> List.length ids then
                    invalid "projects" "Project identifiers must not be duplicated."
                elif slugs |> Set.ofList |> Set.count <> List.length slugs then
                    invalid "projects" "Project slugs must not be duplicated."
                else
                    Ok
                        { Entries = entries
                          Source = source
                          Cache = cache }

        let entries projects = projects.Entries
        let source projects = projects.Source
        let cache projects = projects.Cache

    [<RequireQualifiedAccess>]
    module ProjectManifest =
        let private tryProperty (name: string) (element: JsonElement) =
            element.EnumerateObject()
            |> Seq.tryFind (fun (property: JsonProperty) -> property.NameEquals(name))
            |> Option.map (fun property -> property.Value)

        let private tryString (name: string) (element: JsonElement) =
            match tryProperty name element with
            | Some property when property.ValueKind = JsonValueKind.String ->
                let value = property.GetString()

                if hasText value then
                    Ok value
                else
                    invalid $"projects.{name}" $"Project field '{name}' is required."
            | _ -> invalid $"projects.{name}" $"Project field '{name}' must be a string."

        let private tryTags (element: JsonElement) : ValidationResult<ContentTag list> =
            match tryProperty "tags" element with
            | Some property when property.ValueKind = JsonValueKind.Array ->
                let rec validate (pending: JsonElement list) (accumulated: ContentTag list) =
                    match pending with
                    | [] -> Ok(List.rev accumulated)
                    | value :: remaining when value.ValueKind = JsonValueKind.String ->
                        let raw = value.GetString()

                        ContentTag.tryCreate "projects.tags" raw
                        |> Result.bind (fun tag -> validate remaining (tag :: accumulated))
                    | _ -> invalid "projects.tags" "Project tags must be strings."

                property.EnumerateArray()
                |> Seq.toList
                |> fun values -> validate values []
                |> Result.bind (fun tags ->
                    let values = tags |> List.map ContentTag.value

                    if values |> Set.ofList |> Set.count <> List.length values then
                        invalid "projects.tags" "Project tags must not contain duplicates."
                    else
                        Ok tags)
            | _ -> invalid "projects.tags" "Project tags must be an array."

        let private tryProject (element: JsonElement) : ValidationResult<Project> =
            let allowed =
                Set.ofList [ "id"; "slug"; "name"; "summary"; "url"; "repository"; "updatedAt"; "tags" ]

            if element.ValueKind <> JsonValueKind.Object then
                invalid "projects" "Each project manifest entry must be an object."
            elif
                element.EnumerateObject()
                |> Seq.exists (fun (property: JsonProperty) -> not (allowed.Contains property.Name))
            then
                invalid "projects" "A project manifest entry contains an unsupported field."
            else
                tryString "id" element
                |> Result.bind (ContentId.tryCreate "projects.id")
                |> Result.bind (fun id ->
                    tryString "slug" element
                    |> Result.bind (ContentSlug.tryCreate "projects.slug")
                    |> Result.bind (fun slug ->
                        tryString "name" element
                        |> Result.bind (ContentTitle.tryCreate "projects.name")
                        |> Result.bind (fun name ->
                            tryString "summary" element
                            |> Result.bind (ContentSummary.tryCreate "projects.summary")
                            |> Result.bind (fun summary ->
                                tryString "url" element
                                |> Result.bind (ContentUrl.tryCreate "projects.url")
                                |> Result.bind (fun url ->
                                    tryString "repository" element
                                    |> Result.bind (RepositoryName.tryCreate "projects.repository")
                                    |> Result.bind (fun repository ->
                                        tryString "updatedAt" element
                                        |> Result.bind (Timestamp.tryCreate "projects.updatedAt")
                                        |> Result.bind (fun updatedAt ->
                                            tryTags element
                                            |> Result.map (fun tags ->
                                                Project.create
                                                    id
                                                    slug
                                                    name
                                                    summary
                                                    url
                                                    repository
                                                    updatedAt
                                                    tags))))))))

        let tryParse (manifest: string) : ValidationResult<Project list> =
            try
                use document = JsonDocument.Parse manifest
                let root = document.RootElement

                match tryProperty "projects" root with
                | Some projects when
                    root.ValueKind = JsonValueKind.Object
                    && projects.ValueKind = JsonValueKind.Array
                    ->
                    let entries = projects.EnumerateArray() |> Seq.toList

                    if List.length entries > PageItemLimit then
                        invalid "projects" "A project manifest cannot contain more than 100 projects."
                    else
                        let rec validate pending accumulated =
                            match pending with
                            | [] -> Ok(List.rev accumulated)
                            | entry :: remaining ->
                                tryProject entry
                                |> Result.bind (fun project -> validate remaining (project :: accumulated))

                        validate entries []
                        |> Result.bind (fun projects ->
                            let ids = projects |> List.map (Project.id >> ContentId.value)
                            let slugs = projects |> List.map (Project.slug >> ContentSlug.value)

                            if ids |> Set.ofList |> Set.count <> List.length ids then
                                invalid "projects" "Project identifiers must not be duplicated."
                            elif slugs |> Set.ofList |> Set.count <> List.length slugs then
                                invalid "projects" "Project slugs must not be duplicated."
                            else
                                Ok projects)
                | _ -> invalid "projects" "A project manifest must contain a projects array."
            with :? JsonException ->
                invalid "projects" "A project manifest must be valid JSON."

    type CommitSha = private CommitSha of string

    [<RequireQualifiedAccess>]
    module CommitSha =
        let tryCreate field (value: string) : ValidationResult<CommitSha> =
            let isHex character =
                isAsciiDigit character || (character >= 'a' && character <= 'f')

            if
                not (hasText value)
                || value.Length < 7
                || value.Length > 64
                || value |> Seq.exists (isHex >> not)
            then
                invalid field "A commit SHA must be a lowercase hexadecimal identifier between 7 and 64 characters."
            else
                Ok(CommitSha value)

        let value (CommitSha value) = value

    type CommitSummary = private CommitSummary of string

    [<RequireQualifiedAccess>]
    module CommitSummary =
        let tryCreate field (value: string) : ValidationResult<CommitSummary> =
            if not (hasText value) || value.Length > 200 then
                invalid field "A commit summary must be non-empty and at most 200 characters."
            elif value.IndexOfAny([| '\r'; '\n'; '\u0000' |]) >= 0 then
                invalid field "A commit summary must be a single line."
            else
                Ok(CommitSummary(value.Trim()))

        let value (CommitSummary value) = value

    type Commit =
        private
            { Sha: CommitSha
              Summary: CommitSummary
              AuthoredAt: Timestamp
              Url: ContentUrl }

    [<RequireQualifiedAccess>]
    module Commit =
        let create sha summary authoredAt url =
            { Sha = sha
              Summary = summary
              AuthoredAt = authoredAt
              Url = url }

        let sha commit = commit.Sha
        let summary commit = commit.Summary
        let authoredAt commit = commit.AuthoredAt
        let url commit = commit.Url

    type Release =
        private
            { Tag: ContentTag
              Name: ContentTitle
              PublishedAt: Timestamp
              Body: string
              Url: ContentUrl
              Commits: Commit list }

    [<RequireQualifiedAccess>]
    module Release =
        let tryCreate tag name publishedAt (body: string) url (commits: Commit list) : ValidationResult<Release> =
            if
                isNull body
                || body.IndexOf('\u0000') >= 0
                || Encoding.UTF8.GetByteCount(body) > DocumentByteLimit
            then
                invalid "release.body" "Release notes must be at most 1 MiB and contain no null characters."
            elif List.length commits > PageItemLimit then
                invalid "release.commits" "A release cannot contain more than 100 commits."
            else
                let commitShas = commits |> List.map (Commit.sha >> CommitSha.value)

                if commitShas |> Set.ofList |> Set.count <> List.length commitShas then
                    invalid "release.commits" "A release cannot contain duplicate commit SHAs."
                else
                    Ok
                        { Tag = tag
                          Name = name
                          PublishedAt = publishedAt
                          Body = body
                          Url = url
                          Commits = commits }

        let tag release = release.Tag
        let name release = release.Name
        let publishedAt release = release.PublishedAt
        let body release = release.Body
        let url release = release.Url
        let commits release = release.Commits

    type Changelog =
        private
            { Unreleased: Commit list
              Releases: Release list
              Source: ContentSource
              Cache: CacheMetadata }

    [<RequireQualifiedAccess>]
    module Changelog =
        let tryCreate source cache unreleased releases : ValidationResult<Changelog> =
            if List.length unreleased > PageItemLimit || List.length releases > PageItemLimit then
                invalid "changelog" "Changelog groups cannot exceed 100 items."
            else
                let releaseTags = releases |> List.map (Release.tag >> ContentTag.value)
                let unreleasedShas = unreleased |> List.map (Commit.sha >> CommitSha.value)

                if releaseTags |> Set.ofList |> Set.count <> List.length releaseTags then
                    invalid "changelog.releases" "Changelog release tags must not be duplicated."
                elif unreleasedShas |> Set.ofList |> Set.count <> List.length unreleasedShas then
                    invalid "changelog.unreleased" "Unreleased commits must not be duplicated."
                else
                    Ok
                        { Unreleased = unreleased
                          Releases = releases
                          Source = source
                          Cache = cache }

        let unreleased changelog = changelog.Unreleased
        let releases changelog = changelog.Releases
        let source changelog = changelog.Source
        let cache changelog = changelog.Cache

    type Now =
        private
            { Title: ContentTitle
              Body: MarkdownBody
              UpdatedAt: Timestamp
              Source: ContentSource
              Cache: CacheMetadata }

    [<RequireQualifiedAccess>]
    module Now =
        let create title body updatedAt source cache =
            { Title = title
              Body = body
              UpdatedAt = updatedAt
              Source = source
              Cache = cache }

        let title value = value.Title
        let body value = value.Body
        let updatedAt value = value.UpdatedAt
        let source value = value.Source
        let cache value = value.Cache

    type ProblemCode =
        | InvalidRequest
        | NotFound
        | UpstreamUnavailable
        | RateLimited
        | ConfigurationInvalid

    [<RequireQualifiedAccess>]
    module ProblemCode =
        let value =
            function
            | InvalidRequest -> "invalid-request"
            | NotFound -> "not-found"
            | UpstreamUnavailable -> "upstream-unavailable"
            | RateLimited -> "rate-limited"
            | ConfigurationInvalid -> "configuration-invalid"

        let status =
            function
            | InvalidRequest -> 400
            | NotFound -> 404
            | UpstreamUnavailable -> 503
            | RateLimited -> 429
            | ConfigurationInvalid -> 500

        let title =
            function
            | InvalidRequest -> "The request is invalid."
            | NotFound -> "The requested content was not found."
            | UpstreamUnavailable -> "Content is temporarily unavailable."
            | RateLimited -> "Content retrieval is rate limited."
            | ConfigurationInvalid -> "Content is not configured."

    type Problem =
        private
            { Code: ProblemCode
              Detail: string }

    [<RequireQualifiedAccess>]
    module Problem =
        let create code detail =
            let safeDetail =
                if hasText detail && detail.Length <= 500 then
                    detail
                else
                    ProblemCode.title code

            { Code = code; Detail = safeDetail }

        let code problem = problem.Code
        let detail problem = problem.Detail
