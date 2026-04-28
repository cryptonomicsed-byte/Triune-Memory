import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const stateFile = '.orchestrator/state.json';
function loadState() {
    if (!existsSync(stateFile))
        return { phase: 2, loops: 0, done: false, log: [] };
    return JSON.parse(readFileSync(stateFile, 'utf8'));
}
function saveState(s) { writeFileSync(stateFile, JSON.stringify(s, null, 2)); }
function plan(s) { s.log.push(`plan: phase ${s.phase}`); }
function dispatch(s) { s.log.push(`dispatch: spawned workers for phase ${s.phase}`); }
function check(s) { s.log.push(`check: validation pass required for phase ${s.phase}`); }
function advance(s) { s.phase += 1; s.log.push(`advance: moved to phase ${s.phase}`); if (s.phase > 6)
    s.done = true; }
const cmd = process.argv[2] || 'run';
const policy = JSON.parse(readFileSync('.orchestrator/loop-policy.json', 'utf8'));
const s = loadState();
if (cmd === 'plan')
    plan(s);
else if (cmd === 'dispatch')
    dispatch(s);
else if (cmd === 'check')
    check(s);
else if (cmd === 'advance')
    advance(s);
else {
    for (let i = 0; i < policy.maxLoopsPerRun && !s.done; i++) {
        s.loops++;
        plan(s);
        dispatch(s);
        check(s);
        advance(s);
    }
}
saveState(s);
console.log(s);
