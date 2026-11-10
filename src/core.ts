import { blocks, commands, events } from './catalog';

export type TokenKind = 'word' | 'variable' | 'string' | 'open' | 'close' | 'operator' | 'separator' | 'comment';
export interface Token {
    kind: TokenKind;
    text: string;
    start: number;
    end: number;
}
export interface Issue {
    line: number;
    start: number;
    end: number;
    code: string;
    message: string;
    severity: 'error' | 'warning';
}
export interface Line {
    text: string;
    tokens: Token[];
    indent: number;
    section: number;
}
export interface Definition {
    name: string;
    kind: 'script' | 'event' | 'variable';
    line: number;
    start: number;
    end: number;
    section: number;
}
export interface Analysis {
    lines: Line[];
    issues: Issue[];
    definitions: Definition[];
}

export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const start = i;
        const char = text[i]!;
        if (/\s/.test(char)) { i++; continue; }
        let kind: TokenKind;
        if (text.startsWith('//', i)) {
            tokens.push({ kind: 'comment', text: text.slice(i), start, end: text.length });
            break;
        } else if (char === '"') {
            kind = 'string';
            const close = text.indexOf('"', i + 1);
            i = close < 0 ? text.length : close + 1;
        } else if (char === '(' || char === ')') {
            kind = char === '(' ? 'open' : 'close';
            i++;
        } else if (char === ',' || char === ':') {
            kind = 'separator';
            i++;
        } else if (/[=+*/<>!&|\-]/.test(char)) {
            kind = 'operator';
            const pair = text.slice(i, i + 2);
            i += ['==', '!=', '>=', '<=', '&&', '||', '+>', '->'].includes(pair) ? 2 : 1;
        } else {
            const variable = text.slice(i).match(/^[$%][A-Za-z_][A-Za-z0-9_]*/);
            if (variable) {
                kind = 'variable';
                i += variable[0].length;
            } else {
                kind = 'word';
                while (i < text.length && !/[\s"(),:=+*/<>!&|\-]/.test(text[i]!)) i++;
            }
        }
        tokens.push({ kind, text: text.slice(start, i), start, end: i });
    }
    return tokens;
}

export function codeTokens(line: Line): Token[] {
    return line.tokens.filter(token => token.kind !== 'comment');
}

export function analyze(text: string, unknownCommands = true): Analysis {
    const issues: Issue[] = [];
    const definitions: Definition[] = [];
    let section = 0;
    const lines: Line[] = text.split(/\r\n|\n|\r/).map(line => ({
        text: line, tokens: tokenize(line), indent: line.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length, section: 0
    }));
    type BlockLine = { line: number; indent: number; head: string; token: Token };
    const scriptNames = new Set<string>();
    let previous: BlockLine | undefined;
    const parents: BlockLine[] = [];
    const report = (line: number, token: Token, code: string, message: string, severity: Issue['severity'] = 'error') => {
        issues.push({ line, start: token.start, end: token.end, code, message, severity });
    };
    for (const [index, line] of lines.entries()) {
        const tokens = codeTokens(line);
        const first = tokens[0];
        line.section = section;
        if (!first) continue;
        const head = first.text.toLowerCase();
        const header = head === 'script' || head === 'event';
        if (header) line.section = ++section;
        if (/\t/.test(line.text.slice(0, first.start)) || line.indent % 4 !== 0) {
            report(index, first, 'indentation', 'Use spaces in groups of four for indentation.', 'warning');
        }
        if (header && line.indent !== 0) {
            report(index, first, 'header-indent', 'Script and event headers must be at the top level.');
        }
        if (previous && blocks.has(previous.head) && line.indent <= previous.indent) {
            report(previous.line, previous.token, 'missing-block', 'This header or control command needs an indented block.');
        }
        if (previous && line.indent > previous.indent) {
            if (!blocks.has(previous.head)) {
                report(index, first, 'unexpected-indent', 'Only a block command or header may introduce indentation.');
            } else if (line.indent !== previous.indent + 4) {
                report(index, first, 'indent-step', 'A nested block must be indented by four additional spaces.', 'warning');
            }
            parents.push(previous);
        }
        while (parents.length && parents[parents.length - 1]!.indent >= line.indent) parents.pop();
        if (!previous && line.indent > 0) {
            report(index, first, 'unexpected-indent', 'The first command must start at the top level.');
        } else if (!header && line.indent === 0 && section > 0) {
            report(index, first, 'section-indent', 'Commands after a script or event header must be indented.');
        } else if (previous && line.indent < previous.indent && line.indent > 0) {
            const parent = parents[parents.length - 1];
            if (!parent || line.indent !== parent.indent + 4) {
                report(index, first, 'invalid-dedent', 'Dedent to an enclosing block level.', 'warning');
            }
        }
        const open: Token[] = [];
        for (const token of tokens) {
            if (token.kind === 'string' && !token.text.slice(1).includes('"')) {
                report(index, token, 'unclosed-string', 'Close the double-quoted text on this line.');
            }
            if (token.kind === 'open') open.push(token);
            if (token.kind === 'close' && !open.pop()) {
                report(index, token, 'unexpected-close', 'No matching opening parenthesis.');
            }
        }
        for (const token of open) report(index, token, 'unclosed-parenthesis', 'No matching closing parenthesis on this line.');
        if (header) {
            const name = tokens[1];
            if (!name || name.kind !== 'word') {
                report(index, first, 'missing-name', `Provide a ${head === 'event' ? 'documented event' : 'subscript'} name.`);
            } else {
                definitions.push({ name: name.text, kind: head, line: index, start: name.start, end: name.end, section });
                if (head === 'event' && unknownCommands && !events.has(name.text.toLowerCase())) {
                    report(index, name, 'unknown-event', `Unknown event '${name.text}'; it is absent from the bundled reference.`, 'warning');
                }
                if (head === 'script') {
                    if (scriptNames.has(name.text)) report(index, name, 'duplicate-script', `Subscript '${name.text}' is already declared.`);
                    scriptNames.add(name.text);
                    if (tokens[2] && !['public', 'private', 'hidden'].includes(tokens[2].text.toLowerCase())) {
                        report(index, tokens[2], 'script-access', 'Expected public, hidden, or private accessibility.');
                    }
                    if (tokens[3]) report(index, tokens[3], 'script-header', 'Unexpected text after subscript accessibility.');
                }
            }
        } else if (first.kind === 'variable') {
            if (tokens.some(token => token.text === '=' || ['new', 'add', 'remove', 'include', 'exclude', '+', '-', '+>', '->'].includes(token.text))) {
                definitions.push({ name: first.text, kind: 'variable', line: index, start: first.start, end: first.end, section });
            }
        } else if (unknownCommands && !commands.has(head)) {
            report(index, first, 'unknown-command', `Unknown command '${first.text}'; it is absent from the bundled reference.`, 'warning');
        }
        // foreach introduces locals for the loop, without a separate assignment.
        if (head === 'foreach') {
            for (const token of tokens.slice(1)) {
                if (token.text.toLowerCase() === 'in') break;
                if (token.kind === 'variable') {
                    definitions.push({ name: token.text, kind: 'variable', line: index, start: token.start, end: token.end, section });
                }
            }
        }
        previous = { line: index, indent: line.indent, head, token: first };
    }
    if (previous && blocks.has(previous.head)) {
        report(previous.line, previous.token, 'missing-block', 'This header or control command needs an indented block.');
    }
    return { lines, issues, definitions };
}

export interface CursorContext {
    suppressed: boolean;
    commandPosition: boolean;
    command: string | undefined;
    isEvent: boolean;
    argument: number;
    args: string[];
}

export function cursorContext(text: string, column: number): CursorContext {
    const tokens = tokenize(text.slice(0, column));
    const last = tokens[tokens.length - 1];
    const suppressed = !!last && (last.kind === 'comment'
        || (last.kind === 'string' && !last.text.slice(1).includes('"')));
    const frames: Token[][] = [[]];
    for (const token of tokens) {
        if (token.kind === 'comment') break;
        if (token.kind === 'open') {
            frames[frames.length - 1]!.push(token);
            frames.push([]);
        } else if (token.kind === 'close') {
            if (frames.length > 1) {
                frames.pop();
                const parent = frames[frames.length - 1]!;
                const open = parent[parent.length - 1]!;
                parent[parent.length - 1] = { ...open, text: text.slice(open.start, token.end), end: token.end };
            } else frames[0]!.push(token);
        } else frames[frames.length - 1]!.push(token);
    }
    const frame = frames[frames.length - 1]!;
    let first = frame[0];
    const isEvent = frames.length === 1 && first?.text.toLowerCase() === 'event';
    const commandTokens = isEvent ? frame.slice(1) : frame;
    first = commandTokens[0];
    const commandPosition = !first || (commandTokens.length === 1 && first.end === column);
    const args: string[] = [];
    let end = -1;
    for (const token of commandTokens.slice(1)) {
        if (token.start > end) args.push(token.text);
        else args[args.length - 1] += token.text;
        end = token.end;
    }
    const trailingSpace = end >= 0 && column > end;
    return { suppressed, commandPosition, command: first?.text.toLowerCase(), isEvent,
        argument: Math.max(0, args.length - (trailingSpace ? 0 : 1)), args };
}

export function visibleVariables(analysis: Analysis, line: number): string[] {
    const section = analysis.lines[line]?.section ?? 0;
    return [...new Set([
        '$trigger', '$parameters',
        ...analysis.definitions.filter(definition => definition.kind === 'variable'
            && (definition.name.startsWith('%') || definition.section === section)).map(definition => definition.name)
    ])];
}

export function findDefinition(analysis: Analysis, name: string, line: number): Definition | undefined {
    const section = analysis.lines[line]?.section ?? 0;
    const candidates = analysis.definitions.filter(definition =>
        definition.name === name && definition.kind !== 'event'
        && (definition.kind === 'script' || name.startsWith('%') || definition.section === section));
    return candidates.filter(definition => definition.line <= line).pop() ?? candidates[0];
}

export function foldingRanges(analysis: Analysis): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    const stack: { start: number; indent: number }[] = [];
    let last = 0;
    for (const [index, line] of analysis.lines.entries()) {
        const first = codeTokens(line)[0];
        if (!first) continue;
        while (stack.length && line.indent <= stack[stack.length - 1]!.indent) {
            const block = stack.pop()!;
            if (last > block.start) ranges.push({ start: block.start, end: last });
        }
        if (blocks.has(first.text.toLowerCase())) stack.push({ start: index, indent: line.indent });
        last = index;
    }
    for (const block of stack) if (last > block.start) ranges.push({ start: block.start, end: last });
    return ranges.sort((a, b) => a.start - b.start);
}
