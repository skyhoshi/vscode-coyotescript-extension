const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { analyze, tokenize, cursorContext, visibleVariables, findDefinition, foldingRanges } = require('../dist/core.js');
const { commands, events, parameters, documentationUrl } = require('../dist/catalog.js');

test('catalog covers the documented commands and events with correct syntax labels', () => {
    assert.equal(commands.size, 137);
    assert.equal(events.size, 14);
    for (const [name, entry] of [...commands, ...events]) {
        assert.equal(entry.syntax.split(' ')[0], name);
        assert.equal(typeof entry.category, 'string');
    }
    assert.deepEqual(parameters(commands.get('key')), ['[up/down/stroke]', '[<key>(,?)]', '(<stroke duration>)', '(key separation delay)']);
    assert.equal(documentationUrl(events.get('midi'), true), 'https://coyotemidi.com/commands-and-events/#event_midi');
    assert.equal(documentationUrl({ name: 'script' }), 'https://coyotemidi.com/docs/subscripts/');
});

test('tokenizer preserves quoted URLs, paths, interpolation, and comment boundaries', () => {
    const text = 'print "https://example.test/a ($name) C:\\Music\\" // real comment';
    const tokens = tokenize(text);
    assert.deepEqual(tokens.map(token => [token.kind, token.text]), [
        ['word', 'print'], ['string', '"https://example.test/a ($name) C:\\Music\\"'], ['comment', '// real comment']
    ]);
    assert.equal(tokens[1].start, 6);
    assert.equal(tokens[1].end, text.indexOf(' //'));
    assert.deepEqual(analyze(text).issues, []);
});

test('valid documented language forms do not produce diagnostics', () => {
    const fixtures = [
        '$text = The quick brown fox\nprint $text',
        '$list = a, b, c\n$list + e\n$list - b\nprint ($list 2)',
        '$list new list\n$list include a, b\n$list exclude b',
        '$map = a: (dog, cat), b: (car, plane)\n$map a 1 = mouse\nprint ($map a 1)',
        '$x = 4\nprint ($x + 2)\nprint (7 * 3 / 2)',
        'if !$provided || (%saved contains thing)\n    print Good day\nelse if $other\n    wait 0.1\nelse\n    print Goodbye',
        'while (keystate LCTRL)\n    if $injected\n        key stroke LCTRL, ALT, I\n    wait 1',
        'switch $value\n    case 1, 2\n        print one or two\n    case default\n        return false',
        'event midi note 56 127\n    print ($trigger velocity)\nevent midi note 56 0\n    return true',
        'runscript default hidden_sub note:($trigger note)\nscript hidden_sub hidden\n    print $note',
        'foreach $key:$value in %collection\n    print "$key $value"',
        "print Don't interpret apostrophes as strings",
        'IF $condition\n    PRINT yes',
        'print (some, arbitrary, list)\nprint (notacommand)',
        'print $caller_variable\nprint %external_global',
        '\n// comments can separate headers from their blocks\nrepeat 2\n    // note\n\n    print hello'
    ];
    for (const fixture of fixtures) assert.deepEqual(analyze(fixture).issues, [], fixture);
});

test('example is valid and contains navigable sections and variables', () => {
    const example = fs.readFileSync(path.join(__dirname, '../examples/midi.cy'), 'utf8');
    const analysis = analyze(example);
    assert.deepEqual(analysis.issues, []);
    assert.deepEqual(analysis.definitions.filter(item => item.kind !== 'variable').map(item => item.name), ['greet', 'midi', 'uirefreshed']);
    assert.equal(findDefinition(analysis, '%last_note', 10).line, 10);
});

test('diagnostics report precise codes and ranges for malformed input', () => {
    const cases = [
        ['pritn hello', 'unknown-command', 0, 0, 5],
        ['event notanevent\n    print yes', 'unknown-event', 0, 6, 16],
        ['print (time', 'unclosed-parenthesis', 0, 6, 7],
        ['print time)', 'unexpected-close', 0, 10, 11],
        ['print "unfinished', 'unclosed-string', 0, 6, 17],
        ['if true\nprint no', 'missing-block', 0, 0, 2],
        ['while true\n    // no body', 'missing-block', 0, 0, 5],
        ['    print no', 'unexpected-indent', 0, 4, 9],
        ['print hello\n    print no', 'unexpected-indent', 1, 4, 9],
        ['event\n    print no', 'missing-name', 0, 0, 5],
        ['    event midi\n        print no', 'header-indent', 0, 4, 9],
        ['script test secret\n    print no', 'script-access', 0, 12, 18],
        ['script test public extra\n    print no', 'script-header', 0, 19, 24],
        ['script a\n    print hi\nscript a\n    print bye', 'duplicate-script', 2, 7, 8],
        ['script a\n    print hi\nprint bye', 'section-indent', 2, 0, 5],
        ['if true\n        print no', 'indent-step', 1, 8, 13],
        ['if true\n   print no', 'indentation', 1, 3, 8],
        ['if true\n\tprint no', 'indentation', 1, 1, 6],
        ['if true\n    if true\n        print yes\n  print no', 'invalid-dedent', 3, 2, 7]
    ];
    for (const [source, code, line, start, end] of cases) {
        const issue = analyze(source).issues.find(item => item.code === code);
        assert.ok(issue, `${code}: ${source}`);
        assert.deepEqual([issue.line, issue.start, issue.end], [line, start, end], code);
        assert.ok(issue.message.length > 10);
    }
});

test('unknown-name setting does not disable structural errors', () => {
    assert.deepEqual(analyze('newcommand\nevent newevent\n    print (time', false).issues.map(item => item.code), ['unclosed-parenthesis']);
});

test('CRLF, blank lines, and comments preserve source line numbers', () => {
    const analysis = analyze('// hi\r\n\r\nif true\r\n    // comment\r\n    pritn hello\r\n');
    assert.equal(analysis.lines.length, 6);
    assert.deepEqual(analysis.issues.map(issue => [issue.code, issue.line]), [['unknown-command', 4]]);
});

test('cursor context distinguishes event names, commands, arguments and nested calls', () => {
    const cases = [
        ['', undefined, false, true, 0],
        ['pri', 'pri', false, true, 0],
        ['print ', 'print', false, false, 0],
        ['event ', undefined, true, true, 0],
        ['event mid', 'mid', true, true, 0],
        ['event midi note ', 'midi', true, false, 1],
        ['midi note 60 ', 'midi', false, false, 2],
        ['print (getvolume ', 'getvolume', false, false, 0],
        ['$x = (time', 'time', false, true, 0],
        ['runscript default he', 'runscript', false, false, 1],
        ['key stroke LCTRL,ALT ', 'key', false, false, 2],
        ['translationparameter id (textbox "A label" "Description") ', 'translationparameter', false, false, 2],
        ['print (max (min 2 3) 4) ', 'print', false, false, 1]
    ];
    for (const [source, command, isEvent, commandPosition, argument] of cases) {
        const actual = cursorContext(source, source.length);
        assert.deepEqual([actual.command, actual.isEvent, actual.commandPosition, actual.argument],
            [command, isEvent, commandPosition, argument], source);
        assert.equal(actual.suppressed, false);
    }
    for (const source of ['// print ', 'print "hello ', 'print hello // (time ']) {
        assert.equal(cursorContext(source, source.length).suppressed, true, source);
    }
    const middle = 'print (time) later text';
    assert.equal(cursorContext(middle, 11).command, 'time');
});

test('scoped variables and definitions do not leak across event and subscript boundaries', () => {
    const analysis = analyze([
        '$root = 1', '%global = 1', 'runscript default second',
        'script first', '    $a = 1', '    print $a',
        'script second', '    $b = 2', '    print $b',
        'event midi', '    foreach $key:$value in %global', '        print $value'
    ].join('\n'));
    assert.deepEqual(analysis.issues, []);
    assert.deepEqual(visibleVariables(analysis, 5).sort(), ['$a', '$parameters', '$trigger', '%global'].sort());
    assert.deepEqual(visibleVariables(analysis, 8).sort(), ['$b', '$parameters', '$trigger', '%global'].sort());
    assert.equal(findDefinition(analysis, '$a', 8), undefined);
    assert.equal(findDefinition(analysis, '$a', 5).line, 4);
    assert.equal(findDefinition(analysis, '%global', 11).line, 1);
    assert.equal(findDefinition(analysis, 'second', 2).line, 6);
    assert.equal(findDefinition(analysis, '$value', 11).line, 10);
    assert.equal(findDefinition(analysis, 'midi', 11), undefined);
});

test('folding respects indentation, nested blocks and section boundaries', () => {
    const analysis = analyze('script a\n    if true\n        print yes\n    print end\n\nevent midi\n    print note\n');
    assert.deepEqual(foldingRanges(analysis), [{ start: 0, end: 3 }, { start: 1, end: 2 }, { start: 5, end: 6 }]);
    assert.deepEqual(foldingRanges(analyze('if true')), []);
});

test('empty and comment-only documents are valid', () => {
    for (const source of ['', ' \n// hi\n    // indented comment']) {
        const analysis = analyze(source);
        assert.deepEqual(analysis.issues, []);
        assert.deepEqual(analysis.definitions, []);
        assert.deepEqual(foldingRanges(analysis), []);
    }
});

test('TextMate grammar highlights language constructs without treating string content as code', async () => {
    const oniguruma = require('vscode-oniguruma');
    const textmate = require('vscode-textmate');
    const wasm = fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: patterns => new oniguruma.OnigScanner(patterns),
            createOnigString: text => new oniguruma.OnigString(text)
        }),
        loadGrammar: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../syntaxes/coyotescript.tmLanguage.json'), 'utf8'))
    });
    try {
        const grammar = await registry.loadGrammar('source.coyotescript');
        const cases = [
            ['print hello', 'print', 'support.function.coyotescript'],
            ['    PRINT hello', 'PRINT', 'support.function.coyotescript'],
            ['print ( time )', 'time', 'support.function.coyotescript'],
            ['event   midi', 'midi', 'entity.name.tag.coyotescript'],
            ['script   named private', 'named', 'entity.name.function.coyotescript'],
            ['$local = 64', '$local', 'variable.other.coyotescript'],
            ['$local = 64', '64', 'constant.numeric.coyotescript'],
            ['print "http://host/$local"', 'http', 'string.quoted.double.coyotescript'],
            ['print "http://host/$local"', '$local', 'variable.other.coyotescript'],
            ['print hello // time', 'time', 'comment.line.double-slash.coyotescript'],
            ['if $a !contains b', '!contains', 'keyword.operator.coyotescript']
        ];
        for (const [source, word, scope] of cases) {
            const column = source.indexOf(word);
            const token = grammar.tokenizeLine(source).tokens.find(item => item.startIndex <= column && item.endIndex > column);
            assert.ok(token.scopes.includes(scope), `${source}: ${word} should have ${scope}, got ${token.scopes}`);
        }
        const unclosed = grammar.tokenizeLine('print "unfinished');
        const next = grammar.tokenizeLine('print next', unclosed.ruleStack);
        assert.ok(next.tokens[0].scopes.includes('support.function.coyotescript'), 'unclosed text must not color the next line as a string');
    } finally {
        registry.dispose();
    }
});
