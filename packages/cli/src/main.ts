// Entry point: `isat <command> ...`. All logic is in cli.ts (run() is exported for in-process tests).
import process from 'node:process';
import { nodeIo, run } from './cli';

// In a Deno-compiled binary the arguments come from Deno.args (process.argv layout differs); otherwise from node.
const denoArgs = (globalThis as { Deno?: { args?: string[] } }).Deno?.args;
process.exitCode = await run(denoArgs ?? process.argv.slice(2), nodeIo());
