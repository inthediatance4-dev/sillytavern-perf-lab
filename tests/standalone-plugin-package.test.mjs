import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const builderUrl = new URL('../scripts/build-standalone-plugins.mjs', import.meta.url);
const evidence = path.join(repository, '.evidence', 'standalone-plugins', 'package-tests');
const sourceFiles = {
    director: ['chapters.js', 'fate-decks.js', 'fate-marks.js', 'fate-sound.js', 'fate-ui.js', 'fate.js', 'index.js', 'instruct.js', 'manager.js', 'presets.js', 'template.js', 'manifest.json', 'settings.html', 'style.css'],
    affinity: ['affinity-prompt-budget.js', 'affinity-state.js', 'affinity.js', 'index.js', 'manifest.json', 'settings.html', 'style.css'],
};
const digest = value => createHash('sha256').update(value).digest('hex');

async function loadBuilder() {
    assert.ok(existsSync(builderUrl), 'the standalone package builder must exist');
    return import(builderUrl.href);
}

async function fixture() {
    await mkdir(evidence, { recursive: true });
    const root = await mkdtemp(path.join(evidence, 'fixture-'));
    await writeFile(path.join(root, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3\n');
    const runtime = path.join(root, 'public', 'scripts', 'plugin-runtime');
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'runtime.js'), "import './host-events.js';\nexport const runtime = true;\n");
    await writeFile(path.join(runtime, 'host-events.js'), 'export const event = true;\n');
    await writeFile(path.join(runtime, 'requests.js'), "export const host = () => import('/script.js');\n");
    for (const [id, files] of Object.entries(sourceFiles)) {
        const directory = path.join(root, 'public', 'scripts', 'extensions', id);
        await mkdir(directory, { recursive: true });
        for (const file of files) {
            let content = file.endsWith('.js') ? 'export const marker = true;\n' : '<div>settings</div>\n';
            if (file === 'manifest.json') content = JSON.stringify({
                display_name: id === 'director' ? '命运之牌' : '好感度记忆', version: '1.0.0', author: 'Example',
                js: 'index.js', css: 'style.css', hooks: { activate: 'init' },
                generate_interceptor: id === 'director' ? 'director_rebind_interceptor' : 'affinity_memory_interceptor',
            });
            if (file === 'style.css') content = '.settings { color: inherit; }\n';
            if (file === 'index.js') content = [
                "import { runtime } from '../../plugin-runtime/runtime.js';",
                "import { chat } from '../../../script.js';",
                `import './${id === 'director' ? 'presets.js' : 'affinity.js'}';`,
                "// import ignored from '../../../not-code.js';",
                'export function init() { return runtime && chat; }',
            ].join('\n');
            if (file === 'manager.js') content = "import { extension_settings } from '../../extensions.js';\nexport const current = () => extension_settings;\n";
            await writeFile(path.join(directory, file), content);
        }
        await writeFile(path.join(directory, 'index.js.bak'), 'PRIVATE BACKUP MUST NOT SHIP');
        await mkdir(path.join(directory, 'data'));
        await writeFile(path.join(directory, 'data', 'private.json'), '{"private":"never ship"}');
    }
    return root;
}

async function buildFixture(root, outputDir = path.join(root, 'output')) {
    const { buildStandalonePackages } = await loadBuilder();
    return buildStandalonePackages({ repoRoot: root, outputDir });
}

async function zipEntries(report, item) {
    const bytes = await readFile(path.join(report.buildDir, item.fileName));
    assert.equal(digest(bytes), item.sha256);
    return unzipSync(bytes);
}

test('two standalone ZIPs contain complete sources, runtime, license and valid root manifests', async () => {
    const root = await fixture();
    const report = await buildFixture(root);
    assert.equal(report.packages.length, 2);
    assert.deepEqual(report.packages.map(item => item.folderName), ['st-director-fate-cards', 'st-affinity-memory']);
    for (const item of report.packages) {
        const entries = await zipEntries(report, item);
        const prefix = `${item.folderName}/`;
        const manifest = JSON.parse(strFromU8(entries[`${prefix}manifest.json`]));
        assert.equal(manifest.generate_interceptor, item.id === 'director' ? 'standalone_director_cards_interceptor' : 'standalone_affinity_memory_interceptor');
        assert.ok(entries[`${prefix}${manifest.js}`]);
        assert.ok(entries[`${prefix}${manifest.css}`]);
        for (const filename of ['runtime/runtime.js', 'runtime/host-events.js', 'runtime/requests.js', 'settings.html', 'README.md', 'LICENSE', 'build-info.json']) assert.ok(entries[prefix + filename], filename);
        assert.equal(strFromU8(entries[prefix + 'LICENSE']), await readFile(path.join(root, 'LICENSE'), 'utf8'));
        assert.doesNotMatch(Object.keys(entries).join('\n'), /(?:\.bak|(?:^|\/)data\/|node_modules|\.git)/);
        assert.doesNotMatch(Object.values(entries).map(strFromU8).join('\n'), /PRIVATE BACKUP|never ship/);
        const info = JSON.parse(strFromU8(entries[prefix + 'build-info.json']));
        assert.equal(info.sourceHash, item.sourceHash);
        assert.ok(info.sourceFiles.every(file => !path.isAbsolute(file.path) && !file.path.includes('\\')));
        for (const file of info.sourceFiles) assert.equal(digest(await readFile(path.join(root, file.path))), file.sha256);
        for (const file of info.files) assert.equal(digest(entries[prefix + file.path]), file.sha256);
        assert.equal(Object.keys(entries).length, info.files.length + 1);
        assert.ok(!strFromU8(entries[prefix + 'build-info.json']).includes(root));
    }
});

test('rewrites host and canonical runtime imports while preserving package-local imports and comments', async () => {
    const root = await fixture();
    const report = await buildFixture(root);
    const entries = await zipEntries(report, report.packages[0]);
    const entry = strFromU8(entries['st-director-fate-cards/index.js']);
    assert.match(entry, /from '\.\/runtime\/runtime\.js'/);
    assert.match(entry, /from '\/script\.js'/);
    assert.match(entry, /import '\.\/presets\.js'/);
    assert.match(entry, /\/\/ import ignored from '\.\.\/\.\.\/\.\.\/not-code\.js'/);
    assert.match(strFromU8(entries['st-director-fate-cards/manager.js']), /from '\/scripts\/extensions\.js'/);
    assert.match(strFromU8(entries['st-director-fate-cards/runtime/runtime.js']), /import '\.\/host-events\.js'/);
});

test('repeat builds preserve earlier files and produce identical ZIP bytes and source hashes', async () => {
    const root = await fixture();
    const first = await buildFixture(root);
    await writeFile(path.join(root, 'output', 'keep.txt'), 'user-owned output');
    const second = await buildFixture(root);
    assert.notEqual(first.buildDir, second.buildDir);
    assert.equal(await readFile(path.join(root, 'output', 'keep.txt'), 'utf8'), 'user-owned output');
    for (let index = 0; index < 2; index++) {
        assert.equal(first.packages[index].sha256, second.packages[index].sha256);
        assert.equal(first.packages[index].sourceHash, second.packages[index].sourceHash);
        assert.deepEqual(await readFile(path.join(first.buildDir, first.packages[index].fileName)), await readFile(path.join(second.buildDir, second.packages[index].fileName)));
    }
});

test('rejects missing runtime before writing any package directory', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/plugin-runtime/requests.js'), '');
    await assert.rejects(buildFixture(root), /empty.*requests\.js|requests\.js.*empty/i);
    assert.equal(existsSync(path.join(root, 'output')), false);
});

test('rejects an empty plugin entry', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/director/index.js'), '\n');
    await assert.rejects(buildFixture(root), /empty.*index\.js|index\.js.*empty/i);
});

test('rejects an unresolved package-local import', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/director/presets.js'), "import './missing.js';\n");
    await assert.rejects(buildFixture(root), /missing\.js|unresolved/i);
});

test('rejects escaped relative imports instead of packaging private sources', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/director/presets.js'), "export * from '../../../../data/private.js';\n");
    await assert.rejects(buildFixture(root), /outside|unsupported|escape/i);
    assert.equal(existsSync(path.join(root, 'output')), false);
});

test('rejects aliases pointing back to built-in copies', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/affinity/affinity.js'), "import '/scripts/extensions/director/index.js';\n");
    await assert.rejects(buildFixture(root), /built.in|unsupported|alias/i);
});

test('rejects nonliteral dynamic imports, bare packages, and remote modules', async () => {
    for (const source of ["const target = './missing.js'; import(target);", "import 'some-npm-package';", "export * from 'https://example.invalid/source.js';"]) {
        const root = await fixture();
        await writeFile(path.join(root, 'public/scripts/extensions/director/presets.js'), source);
        await assert.rejects(buildFixture(root), /dynamic|unsupported|external|bare/i);
    }
});

test('rejects manifests that point outside their package', async () => {
    const root = await fixture();
    const file = path.join(root, 'public/scripts/extensions/director/manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.js = '../index.js';
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(buildFixture(root), /manifest|outside|invalid/i);
});

test('rejects private-key material without printing the source content', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/director/presets.js'), '// -----BEGIN PRIVATE KEY-----\nexport const marker = true;\n');
    await assert.rejects(buildFixture(root), error => /sensitive|secret|private.key/i.test(error.message) && !error.message.includes('-----BEGIN'));
});

test('rejects output paths inside product source directories', async () => {
    const root = await fixture();
    await assert.rejects(buildFixture(root, path.join(root, 'public/scripts/extensions/director/output')), /output|source/i);
    assert.equal((await readdir(path.join(root, 'public/scripts/extensions/director'))).includes('output'), false);
});

test('rejects runtime directory junctions instead of following source aliases', async () => {
    const root = await fixture();
    const runtime = path.join(root, 'public/scripts/plugin-runtime');
    const original = `${runtime}-original`;
    await rename(runtime, original);
    await symlink(original, runtime, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(buildFixture(root), /alias|symlink/i);
    assert.equal(existsSync(path.join(root, 'output')), false);
});

test('rejects output junctions that point into product sources', async () => {
    const root = await fixture();
    const alias = path.join(root, 'output-alias');
    const source = path.join(root, 'public/scripts/extensions/director');
    await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(buildFixture(root, alias), /output|alias|symlink/i);
    assert.equal((await readdir(source)).some(file => file.startsWith('build-')), false);
});

test('rejects source files containing machine-specific absolute paths', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'public/scripts/extensions/director/presets.js'), String.raw`export const local = 'C:\\Users\\SYNTHETIC_TEST\\private';`);
    await assert.rejects(buildFixture(root), /machine.specific|absolute.path/i);
});
