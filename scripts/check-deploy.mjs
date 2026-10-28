import { checkDeploy, parseDeployArgs } from '../src/deploy-check.js';

const args = process.argv.slice(2);
try {
    const options = parseDeployArgs(args);
    const report = await checkDeploy(options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else {
        console.log(`Deployment check (read-only): ${report.configPath}; data root: ${report.dataRoot}`);
        for (const check of report.checks) console.log(`${check.level} ${check.check}: ${check.message}`);
    }
    process.exitCode = report.exitCode;
} catch (error) {
    if (args.includes('--json')) console.log(JSON.stringify({ error: error.message, exitCode: 2 }));
    else console.error(error.message);
    process.exitCode = 2;
}
