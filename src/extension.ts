import * as vscode from 'vscode';
import { commands, documentationUrl, Entry, events, headers, parameters } from './catalog';
import { Analysis, analyze, codeTokens, cursorContext, findDefinition, foldingRanges, visibleVariables } from './core';

const language = 'coyotescript';
const variablePattern = /[$%]?[A-Za-z_][A-Za-z0-9_]*/;

function help(entry: Entry, isEvent = false): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(`${isEvent ? 'event ' : ''}${entry.syntax}`, language);
    markdown.appendText(`${entry.category} ${isEvent ? 'event' : 'command'}. Square brackets mark required inputs; parentheses mark optional inputs.`);
    markdown.appendMarkdown(`\n\n[Official reference](${documentationUrl(entry, isEvent)})`);
    return markdown;
}

export function activate(context: vscode.ExtensionContext): void {
    const diagnostics = vscode.languages.createDiagnosticCollection(language);
    const cache = new Map<string, { version: number; unknown: boolean; analysis: Analysis }>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const selector: vscode.DocumentSelector = { language };

    function inspect(document: vscode.TextDocument): Analysis {
        const key = document.uri.toString();
        const unknown = vscode.workspace.getConfiguration(language, document.uri).get<boolean>('lint.unknownCommands', true);
        const previous = cache.get(key);
        if (previous?.version === document.version && previous.unknown === unknown) return previous.analysis;
        const analysis = analyze(document.getText(), unknown);
        cache.set(key, { version: document.version, unknown, analysis });
        return analysis;
    }

    function refresh(document: vscode.TextDocument): void {
        if (document.languageId !== language || document.isClosed) return;
        if (!vscode.workspace.getConfiguration(language, document.uri).get<boolean>('lint.enabled', true)) {
            diagnostics.delete(document.uri);
            return;
        }
        diagnostics.set(document.uri, inspect(document).issues.map(issue => {
            const range = new vscode.Range(issue.line, issue.start, issue.line, issue.end);
            const diagnostic = new vscode.Diagnostic(range, issue.message,
                issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
            diagnostic.source = 'CoyoteScript';
            diagnostic.code = issue.code;
            return diagnostic;
        }));
    }

    context.subscriptions.push(
        diagnostics,
        new vscode.Disposable(() => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
            cache.clear();
        }),
        vscode.workspace.onDidOpenTextDocument(refresh),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId !== language) return;
            const key = event.document.uri.toString();
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => {
                timers.delete(key);
                refresh(event.document);
            }, 150));
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const key = document.uri.toString();
            clearTimeout(timers.get(key));
            timers.delete(key);
            cache.delete(key);
            diagnostics.delete(document.uri);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(language)) {
                cache.clear();
                vscode.workspace.textDocuments.forEach(refresh);
            }
        }),
        vscode.languages.registerCompletionItemProvider(selector, {
            provideCompletionItems(document, position) {
                const text = document.lineAt(position.line).text;
                const cursor = cursorContext(text, position.character);
                if (cursor.suppressed) return [];
                const items: vscode.CompletionItem[] = [];
                const range = document.getWordRangeAtPosition(position, variablePattern) ?? new vscode.Range(position, position);
                const prefix = text.slice(0, position.character).match(/[$%]?[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? '';
                function add(label: string, kind: vscode.CompletionItemKind, detail: string): vscode.CompletionItem {
                    const item = new vscode.CompletionItem(label, kind);
                    item.detail = detail;
                    item.range = range;
                    items.push(item);
                    return item;
                }
                if (!prefix.startsWith('$') && !prefix.startsWith('%') && cursor.commandPosition) {
                    const entries = cursor.isEvent ? events : new Map([...commands, ...headers]);
                    for (const entry of entries.values()) {
                        const item = add(entry.name, cursor.isEvent ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Function, entry.syntax);
                        item.documentation = help(entry, cursor.isEvent);
                    }
                }
                if (!cursor.isEvent) {
                    for (const name of visibleVariables(inspect(document), position.line)) {
                        add(name, vscode.CompletionItemKind.Variable, name.startsWith('%') ? 'Global variable' : 'Local/context variable');
                    }
                }
                if (!cursor.commandPosition && !cursor.isEvent && cursor.command === 'runscript'
                    && cursor.argument === 1 && cursor.args[0]?.toLowerCase() === 'default') {
                    for (const definition of inspect(document).definitions) {
                        if (definition.kind === 'script') add(definition.name, vscode.CompletionItemKind.Function, 'Subscript in this document');
                    }
                }
                const choices = !cursor.commandPosition && cursor.argument === 0
                    ? cursor.command === 'midi' ? ['note', 'controlchange', 'programchange', 'pitchbend', 'aftertouch']
                        : cursor.command === 'key' ? (cursor.isEvent ? ['up', 'down'] : ['up', 'down', 'stroke']) : []
                    : !cursor.isEvent && cursor.command === 'script' && cursor.argument === 1 ? ['public', 'hidden', 'private'] : [];
                for (const choice of choices) add(choice, vscode.CompletionItemKind.EnumMember, 'Documented input value');
                return items;
            }
        }, '$', '%'),
        vscode.languages.registerHoverProvider(selector, {
            provideHover(document, position) {
                const range = document.getWordRangeAtPosition(position, variablePattern);
                if (!range) return;
                const word = document.getText(range);
                const line = inspect(document).lines[position.line]!;
                const token = line.tokens.find(item => item.start <= range.start.character && item.end >= range.end.character);
                if (!token || token.kind === 'comment') return;
                if (word.startsWith('$') || word.startsWith('%')) {
                    const markdown = new vscode.MarkdownString();
                    markdown.appendCodeblock(word, language);
                    markdown.appendText(word === '$trigger' ? 'Context map supplied by the trigger or event.'
                        : word === '$parameters' ? 'UI translation parameters supplied by CoyoteMIDI.'
                            : word.startsWith('%') ? 'Persistent global variable shared between scripts.' : 'Local variable for this script execution.');
                    return new vscode.Hover(markdown, range);
                }
                const tokens = codeTokens(line);
                const index = tokens.indexOf(token);
                const root = index === 0;
                const isEvent = index === 1 && tokens[0]?.text.toLowerCase() === 'event';
                if (!root && !isEvent && tokens[index - 1]?.kind !== 'open') return;
                if (token.kind === 'string') return;
                const entry = isEvent ? events.get(word.toLowerCase()) : headers.get(word.toLowerCase()) ?? commands.get(word.toLowerCase());
                if (entry) return new vscode.Hover(help(entry, isEvent), range);
                return;
            }
        }),
        vscode.languages.registerSignatureHelpProvider(selector, {
            provideSignatureHelp(document, position) {
                const cursor = cursorContext(document.lineAt(position.line).text, position.character);
                if (cursor.suppressed || cursor.commandPosition || !cursor.command) return;
                const entry = cursor.isEvent ? events.get(cursor.command) : commands.get(cursor.command) ?? headers.get(cursor.command);
                if (!entry) return;
                const signature = new vscode.SignatureInformation(`${cursor.isEvent ? 'event ' : ''}${entry.syntax}`, help(entry, cursor.isEvent));
                signature.parameters = parameters(entry).map(label => new vscode.ParameterInformation(label));
                const result = new vscode.SignatureHelp();
                result.signatures = [signature];
                result.activeSignature = 0;
                result.activeParameter = Math.min(cursor.argument, Math.max(0, signature.parameters.length - 1));
                return result;
            }
        }, ' ', '('),
        vscode.languages.registerDocumentSymbolProvider(selector, {
            provideDocumentSymbols(document) {
                const analysis = inspect(document);
                const result: vscode.DocumentSymbol[] = [];
                const sections = new Map<number, vscode.DocumentSymbol>();
                const seen = new Set<string>();
                for (const definition of analysis.definitions) {
                    const key = `${definition.section}:${definition.kind}:${definition.name}`;
                    if (definition.kind === 'variable' && seen.has(key)) continue;
                    seen.add(key);
                    const start = new vscode.Position(definition.line, definition.start);
                    const selection = new vscode.Range(start, new vscode.Position(definition.line, definition.end));
                    const nextSection = analysis.lines.findIndex((line, index) => index > definition.line && line.section !== definition.section);
                    const endLine = definition.kind === 'variable' ? definition.line
                        : nextSection < 0 ? document.lineCount - 1 : nextSection - 1;
                    const range = new vscode.Range(new vscode.Position(definition.line, 0), document.lineAt(endLine).range.end);
                    const kind = definition.kind === 'script' ? vscode.SymbolKind.Function
                        : definition.kind === 'event' ? vscode.SymbolKind.Event : vscode.SymbolKind.Variable;
                    const symbol = new vscode.DocumentSymbol(definition.kind === 'event' ? `event ${definition.name}` : definition.name, '', kind, range, selection);
                    if (definition.kind !== 'variable') {
                        sections.set(definition.section, symbol);
                        result.push(symbol);
                    } else {
                        const parent = sections.get(definition.section);
                        if (parent) parent.children.push(symbol);
                        else result.push(symbol);
                    }
                }
                return result;
            }
        }),
        vscode.languages.registerDefinitionProvider(selector, {
            provideDefinition(document, position) {
                const range = document.getWordRangeAtPosition(position, variablePattern);
                if (!range) return;
                const word = document.getText(range);
                const analysis = inspect(document);
                const line = analysis.lines[position.line]!;
                if (line.tokens.some(token => token.kind === 'comment' && token.start <= position.character)) return;
                if (!word.startsWith('$') && !word.startsWith('%')) {
                    const tokens = codeTokens(line);
                    if (tokens[0]?.text.toLowerCase() !== 'runscript' || tokens[1]?.text.toLowerCase() !== 'default'
                        || tokens[2]?.start !== range.start.character) return;
                }
                const definition = findDefinition(analysis, word, position.line);
                if (definition) return new vscode.Location(document.uri, new vscode.Range(
                    definition.line, definition.start, definition.line, definition.end));
                return;
            }
        }),
        vscode.languages.registerFoldingRangeProvider(selector, {
            provideFoldingRanges(document) {
                return foldingRanges(inspect(document)).map(range => new vscode.FoldingRange(range.start, range.end));
            }
        })
    );
    vscode.workspace.textDocuments.forEach(refresh);
}
