// Entry point: `isat <command> ...`. All logic is in cli.ts (run() is exported for in-process tests).
import process from 'node:process';
import { isBrokenPipe, nodeIo, run } from './cli';

// Node reports a closed pipe asynchronously on the stream; exit quietly as `head`-style readers expect.
process.stdout.on('error', (e) => { if (isBrokenPipe(e)) process.exit(0); });

// In a Deno-compiled binary the arguments come from Deno.args (process.argv layout differs); otherwise from node.
const denoArgs = (globalThis as { Deno?: { args?: string[] } }).Deno?.args;
process.exitCode = await run(denoArgs ?? process.argv.slice(2), nodeIo());
