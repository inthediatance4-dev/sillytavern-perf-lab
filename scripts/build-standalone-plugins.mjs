import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import ts from 'typescript';

const REPOSITORY = fileURLToPath(new URL('../', import.meta.url));
const RUNTIME_SOURCE = 'public/scripts/plugin-runtime';
const REQUIRED_RUNTIME = ['runtime.js', 'host-events.js', 'requests.js'];
const SOURCE_EXTENSIONS = new Set(['.js', '.json', '.html', '.css']);
const PLUGINS = [
    {
        id: 'director', folderName: 'st-director-fate-cards', displayName: '命运之牌',
        files: ['chapters.js', 'fate-decks.js', 'fate-marks.js', 'fate-sound.js', 'fate-ui.js', 'fate.js', 'index.js', 'instruct.js', 'manager.js', 'presets.js', 'template.js', 'manifest.json', 'settings.html', 'style.css'],
    },
    {
        id: 'affinity', folderName: 'st-affinity-memory', displayName: '好感度记忆',
        files: ['affinity-prompt-budget.js', 'affinity-state.js', 'affinity.js', 'index.js', 'manifest.json', 'settings.html', 'style.css'],
    },
];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function validateOutputPath(output) {
    const filesystemRoot = path.parse(output).root;
    let current = filesystemRoot;
    for (const component of path.relative(filesystemRoot, output).split(path.sep)) {
        current = path.join(current, component);
        let stat;
        try { stat = await lstat(current); } catch (error) {
            if (error.code === 'ENOENT') break;
            throw error;
        }
        if (stat.isSymbolicLink()) throw new Error('Output directory cannot contain a symlink/junction alias.');
    }
}

async function readSource(root, filename) {
    // Check every component: a symlinked source directory must not expose files
    // outside the checkout, even when its final file itself is regular.
    const parts = filename.split('/');
    let current = root;
    for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        let stat;
        try { stat = await lstat(current); } catch { throw new Error(`Required source is missing: ${filename}`); }
        if (stat.isSymbolicLink()) throw new Error(`Source alias/symlink is not allowed: ${filename}`);
        if (index === parts.length - 1 && !stat.isFile()) throw new Error(`Source is not a regular file: ${filename}`);
    }
    const bytes = await readFile(current);
    if (!bytes.toString('utf8').trim()) throw new Error(`Empty source file: ${filename}`);
    const text = bytes.toString('utf8');
    if (/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}\b/.test(text)) {
        throw new Error(`Sensitive secret/private-key material detected in ${filename}`);
    }
    if (/\b[A-Za-z]:[\\/]+(?:Users|home|workspace|projects)[\\/]+|\/(?:Users|home)\/[^/\s]+\//.test(text)) {
        throw new Error(`Machine-specific absolute path detected in ${filename}`);
    }
    return { path: filename, bytes, sha256: sha256(bytes) };
}

async function runtimeFiles(root, directory = RUNTIME_SOURCE) {
    let entries;
    try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); } catch { throw new Error(`Required runtime directory is missing: ${directory}`); }
    const result = [];
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        if (entry.name.startsWith('.') || ['data', 'tests', 'node_modules', 'backups'].includes(entry.name)) continue;
        const filename = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error(`Source alias/symlink is not allowed: ${filename}`);
        if (entry.isDirectory()) result.push(...await runtimeFiles(root, filename));
        else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !/\.(?:test|spec)\./.test(entry.name)) result.push(await readSource(root, filename));
    }
    return result;
}

function importsIn(text, filename) {
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) throw new Error(`Invalid JavaScript source: ${filename}`);
    const imports = [];
    function add(literal) {
        if (!literal || !ts.isStringLiteralLike(literal)) throw new Error(`Nonliteral dynamic import is not supported: ${filename}`);
        imports.push({ value: literal.text, start: literal.getStart(source) + 1, end: literal.end - 1 });
    }
    function visit(node) {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            if (node.moduleSpecifier) add(node.moduleSpecifier);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
        else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            throw new Error(`Bare/CommonJS import is not supported in browser packages: ${filename}`);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return imports;
}

function hostModule(url) {
    if (url === '/script.js' || url === '/lib.js') return true;
    if (!/^\/scripts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(url)) return false;
    return !url.startsWith('/scripts/extensions/') || url === '/scripts/extensions/shared.js';
}

function mapImport(specifier, sourcePath, packagePath, plugin, files) {
    if (specifier.startsWith('/')) {
        if (!hostModule(specifier)) throw new Error(`Unsupported host import or built-in source alias in ${sourcePath}`);
        return specifier;
    }
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`Unsupported external/bare import in ${sourcePath}`);
    if (/[\\?#%]/.test(specifier)) throw new Error(`Unsupported relative import alias in ${sourcePath}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), specifier));
    const pluginSource = `public/scripts/extensions/${plugin.id}/`;
    let target;
    if (resolved.startsWith(pluginSource)) target = resolved.slice(pluginSource.length);
    else if (resolved.startsWith(`${RUNTIME_SOURCE}/`)) target = `runtime/${resolved.slice(RUNTIME_SOURCE.length + 1)}`;
    else if (resolved.startsWith('public/')) {
        const host = `/${resolved.slice('public/'.length)}`;
        if (hostModule(host)) return host;
    }
    if (!target) throw new Error(`Import escapes the package or references unsupported host code: ${sourcePath}`);
    if (!files.has(target)) throw new Error(`Unresolved package import ${specifier} in ${sourcePath}`);
    let relative = path.posix.relative(path.posix.dirname(packagePath), target);
    if (!relative.startsWith('.')) relative = `./${relative}`;
    // Preserve ordinary local specifiers exactly; rewrite only host/runtime paths.
    return resolved.startsWith(pluginSource) || sourcePath.startsWith(`${RUNTIME_SOURCE}/`) ? specifier : relative;
}

function rewriteSource(record, packagePath, plugin, files) {
    let text = record.bytes.toString('utf8');
    for (const item of importsIn(text, record.path).reverse()) {
        const replacement = mapImport(item.value, record.path, packagePath, plugin, files);
        if (replacement !== item.value) text = text.slice(0, item.start) + replacement + text.slice(item.end);
    }
    return Buffer.from(text);
}

function validateManifest(manifest, files, plugin) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.display_name !== plugin.displayName
        || typeof manifest.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.version)) {
        throw new Error(`Invalid manifest metadata for ${plugin.id}`);
    }
    for (const [field, required] of [['js', true], ['css', false]]) {
        const filename = manifest[field];
        if (!filename && !required) continue;
        if (typeof filename !== 'string' || filename.split('/').some(part => !part || part === '.' || part === '..') || filename.includes('\\') || !files.has(filename)) {
            throw new Error(`Invalid manifest ${field} path for ${plugin.id}`);
        }
    }
}

function packageReadme(plugin, version) {
    return `# ${plugin.displayName}\n\n版本：${version}。独立的 SillyTavern 前端扩展，源码、运行适配文件与 AGPLv3 许可证已包含。\n\n`
        + '兼容验证目标：官方 SillyTavern 1.19.0，以及 sillytavern-perf-lab 1.19.0。实际验证结果以随发布提供的报告为准。\n\n'
        + `## 安装\n\n解压整个 \`${plugin.folderName}\` 文件夹到酒馆的 \`data/<用户标识>/extensions/\`。需供全部用户使用时，解压到 \`public/scripts/extensions/third-party/\`。确认 \`${plugin.folderName}/manifest.json\` 直接位于扩展文件夹内，然后刷新酒馆页面，在扩展管理中启用「${plugin.displayName}」。无需为插件单独安装 Node.js 或 npm 依赖。\n\n`
        + `使用已内置本功能的性能分支时，先在扩展管理中停用内置的「${plugin.displayName}」，刷新后再启用此第三方副本。同一功能只启用一份。设置与当前聊天中的已有数据继续沿用；命运之牌与好感度记忆可以分别安装、分别启用。\n\n`
        + (plugin.id === 'affinity' ? '## 使用\n\n在扩展设置中展开「好感度记忆」，选择开关与整理频率。默认每 10 条有效角色回复整理一次，可改为 5 条。后台整理会调用当前连接的模型并消耗额度；记忆按聊天隔离。\n\n' : '## 使用\n\n展开「命运之牌」扩展设置，管理预设与快捷键；聊天输入区的入口可使用预设、抽取命运牌和回看章节。已有 `/director` 快捷命令继续可用。\n\n')
        + '## 更新与卸载\n\n手动安装的 ZIP 不提供 Git 自动更新。更新前备份扩展文件夹及酒馆数据，再用新版本文件替换此插件文件。卸载时先停用并刷新，将整个插件文件夹移到回收站。不要删除聊天文件或其他扩展。\n\n'
        + '## 完整性\n\n`build-info.json` 记录源文件和包内文件的 SHA256；外部构建报告另记录 ZIP SHA256。请保留 `LICENSE` 及来源信息。当前完整酒馆仓库链接不适用于扩展面板的一键安装，请使用此 ZIP 的手动安装方式。\n';
}

function preparePackage(plugin, sources, runtime, license) {
    const prefix = `public/scripts/extensions/${plugin.id}/`;
    const records = new Map(sources.map(record => [record.path.slice(prefix.length), record]));
    for (const record of runtime) records.set(`runtime/${record.path.slice(RUNTIME_SOURCE.length + 1)}`, record);
    let manifest;
    try { manifest = JSON.parse(records.get('manifest.json').bytes.toString('utf8')); } catch { throw new Error(`Invalid manifest JSON for ${plugin.id}`); }
    validateManifest(manifest, records, plugin);
    const files = new Map();
    for (const [filename, record] of records) files.set(filename, filename.endsWith('.js') ? rewriteSource(record, filename, plugin, records) : record.bytes);
    if (manifest.generate_interceptor) {
        manifest.generate_interceptor = plugin.id === 'director' ? 'standalone_director_cards_interceptor' : 'standalone_affinity_memory_interceptor';
        files.set('manifest.json', jsonBytes(manifest));
    }
    files.set('LICENSE', license.bytes);
    files.set('README.md', Buffer.from(packageReadme(plugin, manifest.version)));
    const sourceFiles = [...sources, ...runtime, license].map(({ path: source, sha256: hash }) => ({ path: source, sha256: hash })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const sourceHash = sha256(jsonBytes(sourceFiles));
    const packagedFiles = [...files].map(([filename, bytes]) => ({ path: filename, bytes: bytes.length, sha256: sha256(bytes) })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    files.set('build-info.json', jsonBytes({ schemaVersion: 1, id: plugin.id, folderName: plugin.folderName, version: manifest.version, sourceHash, sourceFiles, files: packagedFiles }));
    const entries = {};
    for (const [filename, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        // Fixed DOS timestamp makes unchanged source produce byte-identical ZIPs.
        entries[`${plugin.folderName}/${filename}`] = [bytes, { mtime: new Date(2000, 0, 1, 0, 0, 0), os: 0 }];
    }
    const bytes = zipSync(entries, { level: 9 });
    return {
        bytes,
        report: { id: plugin.id, folderName: plugin.folderName, displayName: plugin.displayName, version: manifest.version,
            fileName: `${plugin.folderName}-${manifest.version}.zip`, sha256: sha256(bytes), sourceHash, bytes: bytes.length, entries: files.size },
    };
}

/** Build independent source ZIPs into a new directory; existing output is never overwritten. */
export async function buildStandalonePackages({ repoRoot = REPOSITORY, outputDir = path.join(repoRoot, '.evidence', 'standalone-plugins', 'packages') } = {}) {
    const root = await realpath(path.resolve(repoRoot));
    const output = path.resolve(outputDir);
    await validateOutputPath(output);
    const sourceDirectories = [RUNTIME_SOURCE, ...PLUGINS.map(plugin => `public/scripts/extensions/${plugin.id}`)].map(directory => path.join(root, directory));
    if (sourceDirectories.some(directory => inside(directory, output))) throw new Error('Output directory must be outside product source directories.');
    const license = await readSource(root, 'LICENSE');
    const runtime = await runtimeFiles(root);
    for (const required of REQUIRED_RUNTIME) {
        if (!runtime.some(record => record.path === `${RUNTIME_SOURCE}/${required}`)) throw new Error(`Required runtime source is missing: ${required}`);
    }
    const packages = [];
    // Prepare and validate both packages before creating any output.
    for (const plugin of PLUGINS) {
        const sources = await Promise.all(plugin.files.map(filename => readSource(root, `public/scripts/extensions/${plugin.id}/${filename}`)));
        packages.push(preparePackage(plugin, sources, runtime, license));
    }
    await mkdir(output, { recursive: true });
    const buildHash = sha256(packages.map(item => item.report.sha256).join('\n')).slice(0, 12);
    const buildDir = path.join(output, `build-${buildHash}-${randomUUID().slice(0, 8)}`);
    await mkdir(buildDir);
    for (const item of packages) await writeFile(path.join(buildDir, item.report.fileName), item.bytes, { flag: 'wx' });
    const report = { schemaVersion: 1, packages: packages.map(item => item.report) };
    await writeFile(path.join(buildDir, 'build-report.json'), jsonBytes(report), { flag: 'wx' });
    await writeFile(path.join(buildDir, 'SHA256SUMS.txt'), packages.map(item => `${item.report.sha256}  ${item.report.fileName}\n`).join(''), { flag: 'wx' });
    return { ...report, buildDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        if (args.length && (args.length !== 2 || args[0] !== '--output-dir' || !args[1] || args[1].startsWith('--'))) {
            throw new Error('Usage: node scripts/build-standalone-plugins.mjs [--output-dir <directory>]');
        }
        console.log(JSON.stringify(await buildStandalonePackages(args.length ? { outputDir: args[1] } : {}), null, 2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
