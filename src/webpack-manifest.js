import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import writeFileAtomic from 'write-file-atomic';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fileIdentity(file) {
    try {
        if (fs.statSync(file).isDirectory()) {
            // Resolver ancestors are fileDependencies too. Their existence is
            // relevant; unrelated siblings in e.g. the temp root are not.
            // Actual directory-content dependencies are tracked below.
            return 'directory';
        }
        return sha256(fs.readFileSync(file));
    } catch (error) {
        if (error.code === 'ENOENT') return 'absent';
        throw error;
    }
}

// Explicit wide source set: public/lib.js and every file below public/lib/.
// Webpack's actual file/context/missing dependencies supplement this set after
// a full build, including installed dependency bytes and resolution candidates.
function sourceTree(directory) {
    try {
        return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
            .map(entry => [entry.name, entry.isDirectory()
                ? sourceTree(path.join(directory, entry.name)) : fileIdentity(path.join(directory, entry.name))]);
    } catch (error) {
        if (error.code === 'ENOENT') return 'absent';
        throw error;
    }
}

function fixedIdentity(config) {
    return sha256(JSON.stringify([
        config.cache.version,
        // Re-read raw build inputs as well as using the existing cache identity.
        config.cache.buildDependencies.config.map(file => [path.relative(config.context, file), fileIdentity(file)]),
        fileIdentity(config.entry), sourceTree(path.join(path.dirname(config.entry), 'lib')),
    ]));
}

function inputIdentity(config, dependencies) {
    return sha256(JSON.stringify([
        fixedIdentity(config),
        dependencies.files.map(file => [file, fileIdentity(path.resolve(config.context, file))]),
        dependencies.contexts.map(directory => [directory,
            fs.readdirSync(path.resolve(config.context, directory), { withFileTypes: true })
                .map(entry => [entry.name, entry.isDirectory()]).sort()]),
        dependencies.missing.map(file => [file, fs.existsSync(path.resolve(config.context, file))]),
    ]));
}

function outputHashes(config, names) {
    if (!names.includes(config.output.filename)) throw new Error('Manifest does not cover the frontend entry output.');
    return Object.fromEntries([...names].sort().map(name => {
        if (typeof name !== 'string' || path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
            throw new Error('Invalid Webpack output name.');
        }
        return [name, sha256(fs.readFileSync(path.join(config.output.path, name)))];
    }));
}

/**
 * Prepare a fail-open optimization: any uncertainty requires the full compiler.
 * @param {import('webpack').Configuration} config Frontend build configuration.
 * @returns {{matches: boolean, record: function(import('webpack').Stats): void}} Manifest state.
 */
export function prepareWebpackManifest(config) {
    let before;
    let manifestPath;
    let matches = false;
    try {
        manifestPath = path.join(path.dirname(config.cache.cacheDirectory), 'manifest.json');
        before = fixedIdentity(config);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.schema === 1 && manifest.inputIdentity === inputIdentity(config, manifest.dependencies)) {
            const current = outputHashes(config, Object.keys(manifest.outputSha256));
            matches = Object.entries(current).every(([name, hash]) => hash === manifest.outputSha256[name]);
        }
    } catch { /* Missing, malformed, unreadable or changed inputs/outputs require compilation. */ }

    return {
        matches,
        record(stats) {
            try {
                if (!before || before !== fixedIdentity(config)) return;
                const compilation = stats.compilation;
                const relative = files => [...files].map(file => path.relative(config.context, file)).sort();
                const dependencies = {
                    files: relative(compilation.fileDependencies),
                    contexts: relative(compilation.contextDependencies),
                    missing: relative(compilation.missingDependencies),
                };
                // Do not bless inputs edited while the compiler was reading them.
                if (dependencies.files.some(file => {
                    const stat = fs.statSync(path.resolve(config.context, file));
                    return stat.isFile() && stat.mtimeMs > stats.startTime;
                })) return;
                const manifest = {
                    schema: 1,
                    inputIdentity: inputIdentity(config, dependencies),
                    dependencies,
                    outputSha256: outputHashes(config, compilation.getAssets().map(asset => asset.name)),
                };
                fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
                // Atomic replacement with fsync; an interrupted write cannot enable a skip.
                writeFileAtomic.sync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
            } catch { /* Cache recording is optional; the completed build remains usable. */ }
        },
    };
}
