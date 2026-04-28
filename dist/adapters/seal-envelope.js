export class SealEnvelope {
    endpoint;
    keyRef;
    constructor(endpoint, keyRef) {
        this.endpoint = endpoint;
        this.keyRef = keyRef;
    }
    encrypt(plain, agentId) {
        if (!this.endpoint)
            throw new Error('SEAL_ENDPOINT_MISSING');
        return Buffer.from(`${agentId}::${plain}`).toString('base64');
    }
    decrypt(cipher) {
        const s = Buffer.from(cipher, 'base64').toString('utf8');
        return s.split('::').slice(1).join('::');
    }
}
