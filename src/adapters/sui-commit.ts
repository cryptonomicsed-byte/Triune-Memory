import { createHash } from 'node:crypto';
export class SuiCommitClient {
  constructor(private endpoint: string, private packageId?: string) {}
  async commit(payload: object): Promise<{tx:string; hash:string}> {
    if (!this.endpoint) throw new Error('SUI_ENDPOINT_MISSING');
    const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return { tx:`sui_commit_${hash.slice(0,20)}`, hash };
  }
}
