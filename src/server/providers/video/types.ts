export interface VideoPrompt {
  prompt: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  /** Image de départ optionnelle (clé de stockage résolue par l'appelant). */
  referenceImagePath?: string;
  seed?: number;
}

export interface VideoAsset {
  buffer: Buffer;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  costCents: number;
  provider: string;
}

export interface VideoProvider {
  readonly id: string;
  readonly isLive: boolean;
  generateVideo(input: VideoPrompt): Promise<VideoAsset>;
}
