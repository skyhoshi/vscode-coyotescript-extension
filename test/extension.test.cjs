const assert = require('node:assert/strict');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, description) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await predicate()) return;
        await delay(50);
    }
    assert.fail(`Timed out: ${description}`);
}

exports.run = async function run() {
    const extension = vscode.extensions.getExtension('skyhoshi.coyotescript');
    assert.ok(extension, 'extension is discoverable');
    const document = await vscode.workspace.openTextDocument({
        language: 'coyotescript',
        content: [
            '$value = 60',
            'runscript default greet',
            'script greet public',
            '    print $value',
            'event midi note 60',
            '    midi note 60 127',
            '    print (time)',
            '    pritn typo',
            '    print ',
            'event ',
            '    print hi'
        ].join('\n')
    });
    const editor = await vscode.window.showTextDocument(document);
    await eventually(() => extension.isActive, 'automatic language activation');
    assert.equal(editor.options.tabSize, 4, 'four-space indentation');
    assert.equal(editor.options.insertSpaces, true, 'indentation uses spaces');
    const position = (line, character) => new vscode.Position(line, character);
    const execute = (command, at, ...rest) => vscode.commands.executeCommand(command, document.uri, at, ...rest);
    const ownDiagnostics = () => vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'CoyoteScript');
    await eventually(() => ownDiagnostics().some(item => item.code === 'unknown-command'), 'initial diagnostics');
    const typo = ownDiagnostics().find(item => item.code === 'unknown-command');
    assert.equal(typo.range.start.line, 7);
    assert.equal(document.getText(typo.range), 'pritn');
    assert.equal(typo.severity, vscode.DiagnosticSeverity.Warning);

    const completion = await execute('vscode.executeCompletionItemProvider', position(8, 4));
    assert.ok(completion.items.some(item => item.label === 'print'), 'command completion');
    assert.ok(completion.items.some(item => item.label === '$trigger'), 'context variable completion');
    assert.ok(!completion.items.some(item => item.label === '$value'), 'local from default section must not leak into event');
    const eventCompletion = await execute('vscode.executeCompletionItemProvider', position(9, 6));
    assert.ok(eventCompletion.items.some(item => item.label === 'midi'), 'event completion');
    assert.ok(!eventCompletion.items.some(item => item.label === 'print'), 'commands excluded from event names');
    const subscriptCompletion = await execute('vscode.executeCompletionItemProvider', position(1, 18));
    assert.ok(subscriptCompletion.items.some(item => item.label === 'greet'), 'same-document subscript completion');

    const hovers = await execute('vscode.executeHoverProvider', position(5, 6));
    assert.ok(hovers.some(hover => hover.contents.some(value => value.value?.includes('#command_midi'))), 'command hover links to reference');
    const eventHovers = await execute('vscode.executeHoverProvider', position(4, 8));
    assert.ok(eventHovers.some(hover => hover.contents.some(value => value.value?.includes('#event_midi'))), 'event hover uses event namespace');
    const signatures = await execute('vscode.executeSignatureHelpProvider', position(5, 17), ' ');
    assert.equal(signatures.signatures[0].label.startsWith('midi [<eventType>]'), true);
    assert.equal(signatures.activeParameter, 2);

    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    assert.ok(symbols.some(symbol => symbol.name === 'greet' && symbol.kind === vscode.SymbolKind.Function), 'subscript outline');
    assert.ok(symbols.some(symbol => symbol.name === 'event midi' && symbol.kind === vscode.SymbolKind.Event), 'event outline');
    const definitions = await execute('vscode.executeDefinitionProvider', position(1, 20));
    assert.equal(definitions[0].range.start.line, 2, 'subscript definition');
    const variableDefinitions = await execute('vscode.executeDefinitionProvider', position(0, 3));
    assert.equal(variableDefinitions[0].range.start.line, 0, 'variable definition');
    const folds = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', document.uri);
    assert.ok(folds.some(fold => fold.start === 2 && fold.end === 3), 'subscript folding');

    await editor.edit(builder => builder.replace(typo.range, 'print'));
    await eventually(() => !ownDiagnostics().some(item => item.code === 'unknown-command'), 'diagnostics update after edit');

    const config = vscode.workspace.getConfiguration('coyotescript');
    const oldEnabled = config.inspect('lint.enabled')?.globalValue;
    const oldUnknown = config.inspect('lint.unknownCommands')?.globalValue;
    try {
        await config.update('lint.unknownCommands', false, vscode.ConfigurationTarget.Global);
        await editor.edit(builder => builder.replace(new vscode.Range(7, 4, 7, 9), 'newercommand'));
        await eventually(() => !ownDiagnostics().some(item => item.code === 'unknown-command'), 'unknown command setting');
        await config.update('lint.unknownCommands', true, vscode.ConfigurationTarget.Global);
        await eventually(() => ownDiagnostics().some(item => item.code === 'unknown-command'), 'unknown command setting restored');
        await config.update('lint.enabled', false, vscode.ConfigurationTarget.Global);
        await eventually(() => ownDiagnostics().length === 0, 'lint disabled clears diagnostics');
        await config.update('lint.enabled', true, vscode.ConfigurationTarget.Global);
        await eventually(() => ownDiagnostics().some(item => item.code === 'unknown-command'), 'lint re-enabled');
    } finally {
        await config.update('lint.enabled', oldEnabled, vscode.ConfigurationTarget.Global);
        await config.update('lint.unknownCommands', oldUnknown, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    await eventually(() => ownDiagnostics().length === 0, 'closed document diagnostics cleared');

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coyotescript-test-'));
    try {
        for (const suffix of ['cy', 'coyote', 'coyotescript']) {
            const file = path.join(directory, `example.${suffix}`);
            await fs.writeFile(file, 'print hello\n');
            const associated = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
            assert.equal(associated.languageId, 'coyotescript', `.${suffix} association`);
            await vscode.window.showTextDocument(associated);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    } finally {
        await fs.rm(directory, { recursive: true, maxRetries: 10, retryDelay: 100 });
    }
    console.log('Extension Host: diagnostics, settings, completion, hover, signatures, symbols, definitions, folding, and file associations passed.');
};
