import type { StagedAsset } from "./PublicationDraft.ts";

export type AssetPreviewUrlApi = Readonly<{
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}>;

export type StagedAssetPreview = Readonly<{
  asset: StagedAsset;
  url: string;
}>;

export class StagedAssetPreviewUrls {
  readonly #api: AssetPreviewUrlApi;
  #urls: ReadonlyArray<string> = [];

  constructor(api: AssetPreviewUrlApi) {
    this.#api = api;
  }

  replace(assets: ReadonlyArray<StagedAsset>): ReadonlyArray<StagedAssetPreview> {
    this.clear();
    const previews: StagedAssetPreview[] = [];
    const urls: string[] = [];
    try {
      for (const asset of assets) {
        const url = this.#api.createObjectURL(asset.blob);
        urls.push(url);
        previews.push({ asset, url });
      }
      this.#urls = urls;
      return previews;
    } catch (error) {
      for (const url of urls) this.#api.revokeObjectURL(url);
      throw error;
    }
  }

  clear(): void {
    for (const url of this.#urls) this.#api.revokeObjectURL(url);
    this.#urls = [];
  }
}

export function browserAssetPreviewUrlApi(): AssetPreviewUrlApi {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}
