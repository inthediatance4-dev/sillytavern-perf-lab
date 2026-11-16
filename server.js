#!/usr/bin/env node
import { enableStartupCompileCache } from './src/compile-cache.js';
import { serverDirectory } from './src/server-directory.js';

enableStartupCompileCache();

const startupTrace = process.env.ST_STARTUP_TRACE ? await import('./src/startup-trace.js') : null;
if (startupTrace) startupTrace.mark('server_js_enter');

const { CommandLineParser } = await import('./src/command-line.js');

console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
if (startupTrace) startupTrace.mark('config_read_done');
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

try {
    if (startupTrace) startupTrace.mark('server_main_import_begin');
    await import('./src/server-main.js');
    if (startupTrace) startupTrace.mark('server_main_imported');
} catch (error) {
    console.error('A critical error has occurred while starting the server:', error);
}
