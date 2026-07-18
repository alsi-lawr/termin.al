export type ContentValidation<Value> =
  | Readonly<{ kind: "valid"; value: Value }>
  | Readonly<{ kind: "invalid"; message: string }>;

export class ContentId {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static tryCreate(value: string, field: string): ContentValidation<ContentId> {
    const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

    return stableIdentifier.test(value)
      ? { kind: "valid", value: new ContentId(value) }
      : { kind: "invalid", message: `${field} must be a stable identifier.` };
  }
}
