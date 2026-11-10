const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'extension.test.cjs'),
    ...(process.env.VSCODE_EXECUTABLE_PATH ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH } : {}),
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust']
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
