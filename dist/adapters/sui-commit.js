import { createHash } from 'node:crypto';
export class SuiCommitClient {
    endpoint;
    packageId;
    constructor(endpoint, packageId) {
        this.endpoint = endpoint;
        this.packageId = packageId;
    }
    async commit(payload) {
        if (!this.endpoint)
            throw new Error('SUI_ENDPOINT_MISSING');
        const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        return { tx: `sui_commit_${hash.slice(0, 20)}`, hash };
    }
}
