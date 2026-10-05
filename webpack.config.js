import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import isDocker from 'is-docker';
import webpack from 'webpack';
import { serverDirectory } from './src/server-directory.js';
import { color } from './src/util.js';

// npm package distributions may omit package-lock.json. Both supported npm
// lockfiles are optional inputs; absence has its own identity rather than
// preventing startup or adding a missing file to Webpack's build dependencies.
const cacheInputs = [
    { file: fileURLToPath(import.meta.url), optional: false },
    { file: path.join(serverDirectory, 'package.json'), optional: false },
    { file: path.join(serverDirectory, 'package-lock.json'), optional: true },
    { file: path.join(serverDirectory, 'npm-shrinkwrap.json'), optional: true },
].map(({ file, optional }) => {
    try {
        const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        return { file, fingerprint, present: true };
    } catch (error) {
        if (optional && error.code === 'ENOENT') return { file, fingerprint: 'absent', present: false };
        throw error;
    }
});
const cacheBuildDependencies = cacheInputs.filter(input => input.present).map(input => input.file);

/**
 * Identify build configuration and dependency inputs, including uncommitted edits.
 * Backend-only Git commits do not invalidate the frontend cache. Entry modules
 * and installed packages are still checked by Webpack's filesystem snapshots.
 * @returns {string} The cache version string.
 */
function getWebpackCacheVersion() {
    return crypto.createHash('shake256', { outputLength: 8 })
        .update(JSON.stringify([
            webpack.version,
            ...cacheInputs.map(input => [path.basename(input.file), input.fingerprint]),
        ]))
        .digest('hex');
}

/**
 * Move old Webpack cache directories into a recoverable recycle directory.
 * @param {string} webpackRoot The root directory where Webpack caches are stored.
 * @param {string} currentCacheVersion The current cache version to keep.
 */
function pruneWebpackCache(webpackRoot, currentCacheVersion) {
    try {
        if (!fs.existsSync(webpackRoot)) {
            return;
        }

        const cacheDirectories = fs.readdirSync(webpackRoot, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const dir of cacheDirectories) {
            const dirPath = path.join(webpackRoot, dir);
            if (dir !== currentCacheVersion && dir !== '.recycle') {
                try {
                    const recycleDirectory = path.join(webpackRoot, '.recycle');
                    fs.mkdirSync(recycleDirectory, { recursive: true });
                    const recycledPath = path.join(recycleDirectory, `${dir}-${crypto.randomUUID()}`);
                    fs.renameSync(dirPath, recycledPath);
                    console.debug(`Recycled outdated cache directory: ${color.yellow(dir)}`);
                } catch (error) {
                    console.error(`Failed to recycle Webpack cache directory: ${color.red(dir)}. The original is retained.`, error);
                }
            }
        }
    } catch (error) {
        console.error('Failed to read Webpack cache directories for pruning.', error);
    }
}

// Fixed for this process, just as the build configuration is. Do not re-read
// package/configuration files for every frontend asset request.
const cacheVersion = getWebpackCacheVersion();

/**
 * Get the Webpack configuration for the public/lib.js file.
 * 1. Docker has got cache and the output file pre-baked.
 * 2. Non-Docker environments use the global DATA_ROOT variable to determine the cache and output directories.
 * @param {object} options Configuration options.
 * @param {boolean} [options.forceDist=false] Whether to force the use the /dist folder.
 * @param {boolean} [options.pruneCache=false] Whether to prune old cache directories.
 * @returns {import('webpack').Configuration}
 * @throws {Error} If the DATA_ROOT variable is not set.
 * */
export default function getPublicLibConfig({ forceDist = false, pruneCache = false } = {}) {
    function getWebpackRoot() {
        if (forceDist || isDocker()) {
            return path.resolve(process.cwd(), 'dist', '_webpack');
        }

        if (typeof globalThis.DATA_ROOT === 'string') {
            return path.resolve(globalThis.DATA_ROOT, '_webpack');
        }

        throw new Error('DATA_ROOT variable is not set.');
    }

    function getCacheDirectory() {
        return path.join(webpackRoot, cacheVersion, 'cache');
    }

    function getOutputDirectory() {
        return path.join(webpackRoot, cacheVersion, 'output');
    }

    const webpackRoot = getWebpackRoot();
    const cacheDirectory = getCacheDirectory();
    const outputDirectory = getOutputDirectory();

    if (pruneCache) {
        pruneWebpackCache(webpackRoot, cacheVersion);
    }

    return {
        mode: 'production',
        entry: path.join(serverDirectory, 'public/lib.js'),
        cache: {
            type: 'filesystem',
            cacheDirectory: cacheDirectory,
            store: 'pack',
            compression: 'gzip',
            buildDependencies: {
                config: cacheBuildDependencies,
            },
        },
        devtool: false,
        watch: false,
        module: {},
        stats: {
            preset: 'minimal',
            assets: false,
            modules: false,
            colors: true,
            timings: true,
        },
        experiments: {
            outputModule: true,
        },
        performance: {
            hints: false,
        },
        output: {
            path: outputDirectory,
            filename: 'lib.js',
            libraryTarget: 'module',
        },
    };
}
