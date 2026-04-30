export type ProviderSendResult =
  | { ok: true; response?: string | Record<string, unknown> }
  | {
      ok: false;
      description: string;
      response?: string | Record<string, unknown>;
    };

export type ChannelPreview = {
  credentialPreview: string;
  targetPreview: string;
};
