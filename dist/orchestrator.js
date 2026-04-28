import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const ORCH = '.orchestrator';
const stateFile = `${ORCH}/state.json`;
const policyFile = `${ORCH}/loop-policy.json`;
function ensure() { mkdirSync(ORCH, { recursive: true }); }
function now() { return new Date().toISOString(); }
function loadPolicy() {
    return JSON.parse(readFileSync(policyFile, 'utf8'));
}
function loadState() {
    if (!existsSync(stateFile)) {
        return { phase: 2, loops: 0, done: false, paused: false, budgetUsed: 0, budgetMax: 1000, maxPhase: 6, log: [], tasks: {} };
    }
    return JSON.parse(readFileSync(stateFile, 'utf8'));
}
function saveState(s) { writeFileSync(stateFile, JSON.stringify(s, null, 2)); }
function tasksForPhase(phase) {
    const p = `${ORCH}/tasks/phase${phase}.json`;
    if (!existsSync(p))
        return [];
    return JSON.parse(readFileSync(p, 'utf8'));
}
function enqueue(s) {
    for (const t of tasksForPhase(s.phase)) {
        if (!s.tasks[t.id])
            s.tasks[t.id] = { ...t, status: 'queued' };
    }
    s.log.push(`${now()} enqueue phase ${s.phase}`);
}
function runTask(t) {
    const start = { ...t, status: 'running', updatedAt: now() };
    try {
        const output = execSync(t.command, { encoding: 'utf8' });
        return { ...start, status: 'done', output, updatedAt: now() };
    }
    catch (e) {
        return { ...start, status: 'failed', error: e?.message || String(e), updatedAt: now() };
    }
}
function runOnce(s, policy) {
    if (s.paused || s.done)
        return;
    if (s.budgetUsed >= s.budgetMax) {
        s.paused = true;
        s.log.push(`${now()} paused: budget exceeded`);
        return;
    }
    enqueue(s);
    const phaseTasks = Object.values(s.tasks).filter(t => t.phase === s.phase && (t.status === 'queued' || t.status === 'failed'));
    for (const t of phaseTasks.slice(0, policy.maxConcurrentAgents)) {
        const r = runTask(t);
        s.tasks[t.id] = r;
        s.budgetUsed += 1;
        if (r.status === 'failed' && policy.pauseOnFailure) {
            s.paused = true;
            s.log.push(`${now()} paused: task failed ${t.id}`);
        }
    }
    const donePhase = canAdvance(s, policy);
    if (donePhase) {
        s.phase += 1;
        s.log.push(`${now()} advanced to phase ${s.phase}`);
        if (s.phase > s.maxPhase) {
            s.done = true;
            s.log.push(`${now()} done`);
        }
    }
}
function hasUncommittedChanges() {
    try {
        const out = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
        return out.length > 0;
    }
    catch {
        return true;
    }
}
function canAdvance(s, policy) {
    const phaseTasks = Object.values(s.tasks).filter(t => t.phase === s.phase);
    if (phaseTasks.some(t => t.required && t.status !== 'done'))
        return false;
    if (policy.requireDocs && !existsSync('README.md'))
        return false;
    if (policy.requireTests) {
        try {
            execSync('npm run build', { stdio: 'pipe' });
        }
        catch {
            return false;
        }
    }
    if (policy.requireCommit && hasUncommittedChanges())
        return false;
    return true;
}
function status(s) { return s; }
function main() {
    ensure();
    const cmd = process.argv[2] || 'status';
    const s = loadState();
    const policy = loadPolicy();
    if (cmd === 'init') {
        saveState({ phase: 2, loops: 0, done: false, paused: false, budgetUsed: 0, budgetMax: 1000, maxPhase: 6, log: [], tasks: {} });
        console.log('initialized');
        return;
    }
    if (cmd === 'pause') {
        s.paused = true;
        s.log.push(`${now()} paused by operator`);
        saveState(s);
        console.log(status(s));
        return;
    }
    if (cmd === 'resume') {
        s.paused = false;
        s.log.push(`${now()} resumed by operator`);
        saveState(s);
        console.log(status(s));
        return;
    }
    if (cmd === 'enqueue') {
        enqueue(s);
        saveState(s);
        console.log(status(s));
        return;
    }
    if (cmd === 'run-once') {
        s.loops += 1;
        runOnce(s, policy);
        saveState(s);
        console.log(status(s));
        return;
    }
    if (cmd === 'run') {
        for (let i = 0; i < policy.maxLoopsPerRun && !s.done && !s.paused; i++) {
            s.loops += 1;
            runOnce(s, policy);
        }
        saveState(s);
        console.log(status(s));
        return;
    }
    console.log(status(s));
}
main();
