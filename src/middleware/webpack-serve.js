import path from 'node:path';
import webpack from 'webpack';
import getPublicLibConfig from '../../webpack.config.js';

export default function getWebpackServeMiddleware() {
    /**
     * A very spartan recreation of webpack-dev-middleware.
     * @param {import('express').Request} req Request object.
     * @param {import('express').Response} res Response object.
     * @param {import('express').NextFunction} next Next function.
     * @type {import('express').RequestHandler}
     */
    function devMiddleware(req, res, next) {
        const publicLibConfig = getPublicLibConfig();
        const outputPath = publicLibConfig.output?.path;
        const outputFile = publicLibConfig.output?.filename;
        const parsedPath = path.parse(req.path);

        if (req.method === 'GET' && parsedPath.dir === '/' && parsedPath.base === outputFile) {
            return res.sendFile(outputFile, { root: outputPath });
        }

        next();
    }

    /**
     * Wait until Webpack is done compiling.
     * @param {object} param Parameters.
     * @param {boolean} [param.forceDist=false] Whether to force the use the /dist folder.
     * @param {boolean} [param.pruneCache=false] Whether to prune old cache directories before compiling.
     * @returns {Promise<void>}
     */
    devMiddleware.runWebpackCompiler = ({ forceDist = false, pruneCache = false } = {}) => {
        console.log();
        console.log('Compiling frontend libraries...');

        const publicLibConfig = getPublicLibConfig({ forceDist, pruneCache });
        const compiler = webpack(publicLibConfig);

        return new Promise((resolve, reject) => {
            const finish = (runError, stats) => {
                let error = runError;
                try {
                    if (!error && !stats) {
                        error = new Error('Webpack compilation returned no stats.');
                    } else if (!error && stats.hasErrors()) {
                        error = new Error('Webpack frontend compilation failed. See the compiler diagnostics.');
                    }

                    const output = stats?.toString(publicLibConfig.stats);
                    if (output) {
                        console.log(output);
                        console.log();
                    }
                } catch (statsError) {
                    error ??= statsError;
                }

                const finishClose = closeError => {
                    if (error || closeError) reject(error ?? closeError);
                    else resolve();
                };
                try {
                    compiler.close(finishClose);
                } catch (closeError) {
                    finishClose(closeError);
                }
            };

            try {
                compiler.run(finish);
            } catch (runError) {
                finish(runError);
            }
        });
    };

    return devMiddleware;
}
