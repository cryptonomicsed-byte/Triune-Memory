export class WalrusHttpAdapter {
  constructor(private endpoint: string, private apiKey?: string) {}
  async put(cipherText: string): Promise<string> {
    if (!this.endpoint) throw new Error('WALRUS_ENDPOINT_MISSING');
    // TODO: wire real Walrus API; placeholder deterministic id until endpoint contract finalized
    return `walrus_http_${Buffer.from(cipherText).toString('base64').slice(0,16)}`;
  }
  async get(_id: string): Promise<string | null> {
    // TODO: real fetch
    return null;
  }
}
