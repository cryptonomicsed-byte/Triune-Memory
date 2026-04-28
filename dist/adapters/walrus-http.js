export class WalrusHttpAdapter {
    endpoint;
    apiKey;
    constructor(endpoint, apiKey) {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
    }
    async put(cipherText) {
        if (!this.endpoint)
            throw new Error('WALRUS_ENDPOINT_MISSING');
        // TODO: wire real Walrus API; placeholder deterministic id until endpoint contract finalized
        return `walrus_http_${Buffer.from(cipherText).toString('base64').slice(0, 16)}`;
    }
    async get(_id) {
        // TODO: real fetch
        return null;
    }
}
