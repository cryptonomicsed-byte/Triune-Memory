import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export class LocalStore {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir;
        mkdirSync(baseDir, { recursive: true });
    }
    p(f) { return join(this.baseDir, f); }
    loadAgents() { const f = this.p('agents.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; }
    saveAgents(v) { writeFileSync(this.p('agents.json'), JSON.stringify(v, null, 2)); }
    loadEvents(agentId) { const f = this.p(`${agentId}.events.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; }
    saveEvents(agentId, e) { writeFileSync(this.p(`${agentId}.events.json`), JSON.stringify(e, null, 2)); }
}
