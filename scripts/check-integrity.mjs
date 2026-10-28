import { checkIntegrity } from '../src/integrity-check.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
try {
    const options = args.filter(arg => arg !== '--json');
    if (options.length !== 2 || options[0] !== '--data-root' || options[1].startsWith('--') || args.filter(arg => arg === '--json').length > 1) {
        throw new Error('Usage: npm run check:integrity -- --data-root <dir> [--json]');
    }
    const report = await checkIntegrity(options[1]);
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
        console.log(`Integrity check (read-only): ${report.dataRoot}`);
        for (const finding of report.findings) {
            if (finding.kind === 'recycle-usage') continue;
            const location = finding.line ? `${finding.source} (line ${finding.line})` : finding.source;
            const conflict = finding.kind === 'marker-visible-conflict'
                ? ` -> ${finding.visible}; intent=${finding.intent ?? 'none'}, state=${finding.state}` : '';
            console.log(`${finding.kind}: ${location}${conflict}`);
        }
        for (const usage of report.recycle) console.log(`Recycle ${usage.root}: ${usage.bytes} bytes, ${usage.count} files`);
        console.log(`${report.findings.length} findings`);
    }
    process.exitCode = report.findings.length ? 1 : 0;
} catch (error) {
    if (json) console.log(JSON.stringify({ error: error.message }));
    else console.error(error.message);
    process.exitCode = 2;
}
