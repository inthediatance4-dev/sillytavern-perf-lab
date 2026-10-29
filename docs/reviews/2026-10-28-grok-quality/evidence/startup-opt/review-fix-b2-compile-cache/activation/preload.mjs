import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
const log = event => fs.appendFileSync(process.env.CC_PROBE_LOG, JSON.stringify(event) + '\n');
const enable = module.enableCompileCache;
module.enableCompileCache = function () {
    const result = enable(process.env.CC_PROBE_CACHE);
    log({ event: 'enableCompileCache', result, active: module.getCompileCacheDir() });
    return result;
};
module.registerHooks({ resolve(specifier, context, next) {
    if (specifier === './src/server-main.js' || specifier === './src/command-line.js' || specifier === 'express' || specifier === 'webpack') {
        const active = module.getCompileCacheDir();
        log({ event: 'resolve', specifier, active: active ?? null });
        if (!active) throw new Error('Application graph resolved before cache activation');
    }
    const result = next(specifier, context);
    if (!module.getCompileCacheDir() && result.url.startsWith('file:')) log({ event: 'beforeEnable', file: path.basename(new URL(result.url).pathname) });
    return result;
} });
