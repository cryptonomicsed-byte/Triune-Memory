export class SealEnvelope {
  constructor(private endpoint: string, private keyRef?: string) {}
  encrypt(plain: string, agentId: string): string {
    if (!this.endpoint) throw new Error('SEAL_ENDPOINT_MISSING');
    return Buffer.from(`${agentId}::${plain}`).toString('base64');
  }
  decrypt(cipher: string): string {
    const s=Buffer.from(cipher,'base64').toString('utf8');
    return s.split('::').slice(1).join('::');
  }
}
