module.exports = {
    root: true,
    env: { browser: true, node: true, es2022: true, jquery: true },
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    ignorePatterns: ['node_modules/', 'public/lib/', 'public/scripts/extensions/third-party/', 'src/electron/'],
    // Match the project's four-space, single-quote, semicolon style. Keep legacy
    // upstream code parse-checked; enforce these rules on lab modules and tools.
    overrides: [{
        files: ['src/chat-*.js', 'src/request-drain.js', 'src/data-root-owner.js', 'src/process-identity.js', 'src/character-lifecycle.js', 'src/endpoints/chats.js', 'src/endpoints/groups.js', 'src/server-main.js', 'scripts/*.mjs', 'tests/*.mjs'],
        rules: {
            'constructor-super': 'error',
            'no-unreachable': 'error',
            'no-dupe-args': 'error',
            'no-dupe-keys': 'error',
            'valid-typeof': 'error',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
            'indent': ['error', 4, { SwitchCase: 1 }],
        },
    }],
};
