// Entry point: `isat <command> ...`. All logic is in cli.ts (run() is exported for in-process tests).
import process from 'node:process';
import { nodeIo, run } from './cli';

process.exitCode = await run(process.argv.slice(2), nodeIo());
