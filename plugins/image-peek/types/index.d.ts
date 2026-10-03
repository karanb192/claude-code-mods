export type PreviewImage = {
  path: string;
  width: number;
  height: number;
};

export type PreviewSession = {
  sessionId: string;
  images: Record<string, PreviewImage | null>;
  observed: string[];
  enabled: boolean;
};

declare module 'claude-code' {
  interface PluginState {
    'image-peek': { session: PreviewSession };
  }
}
