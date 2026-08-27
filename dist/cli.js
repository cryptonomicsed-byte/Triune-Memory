import { Command } from 'commander';
import { LocalStore } from './store.js';
import { MinipaeBridge } from './minipae-bridge.js';
import { TriuneMemory } from './engine.js';
const dataDir = process.env.MEMORY_DATA_DIR || './data';
const app = new TriuneMemory(new LocalStore(dataDir), new MinipaeBridge());
const cli = new Command();
cli.command('birth')
    .requiredOption('--agent <id>')
    .requiredOption('--name <name>')
    .action((o) => console.log(app.birth(o.agent, o.name)));
cli.command('think')
    .requiredOption('--agent <id>')
    .requiredOption('--text <text>')
    .action(async (o) => console.log(await app.write(o.agent, 'think', o.text, 'private')));
cli.command('act')
    .requiredOption('--agent <id>')
    .requiredOption('--tool <tool>')
    .requiredOption('--params <params>')
    .action(async (o) => console.log(await app.write(o.agent, 'act', `${o.tool}:${o.params}`, 'private', o.tool, o.params)));
cli.command('recall')
    .requiredOption('--agent <id>')
    .action(async (o) => console.log(await app.recall(o.agent)));
cli.parse();
