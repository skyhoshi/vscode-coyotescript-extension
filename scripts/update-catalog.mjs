import { writeFile } from 'node:fs/promises';

const source = 'https://update.coyotemidi.com/?request=scriptdocs';
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`);
const data = await response.json();
function entries(value) {
    if (!Array.isArray(value) || value.length === 0) throw new Error('Empty or invalid catalog');
    const names = new Set();
    return value.map(item => {
        if (typeof item.Name !== 'string' || !/^[a-z][a-z0-9]*$/i.test(item.Name)
            || typeof item.Syntax !== 'string' || names.has(item.Name)) {
            throw new Error('Invalid or duplicate catalog entry');
        }
        names.add(item.Name);
        // The reference currently gives getmodifierfolders the wrong command name.
        const syntax = item.Syntax.replace(/^\S+/, item.Name);
        return { name: item.Name, syntax, category: typeof item.Category === 'string' ? item.Category : 'General' };
    }).sort((a, b) => a.name.localeCompare(b.name));
}
const catalog = {
    source,
    retrieved: new Date().toISOString().slice(0, 10),
    commands: entries(data.commands),
    events: entries(data.events)
};
await writeFile(new URL('../data/catalog.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`);
const commands = catalog.commands.map(item => item.name).join('|');
const events = catalog.events.map(item => item.name).join('|');
const grammar = {
    name: 'CoyoteScript',
    scopeName: 'source.coyotescript',
    patterns: [
        { name: 'comment.line.double-slash.coyotescript', match: '//.*$' },
        { name: 'string.quoted.double.coyotescript', begin: '"', end: '"|$', patterns: [
            { name: 'variable.other.coyotescript', match: '[$%][A-Za-z_][A-Za-z0-9_]*' }
        ] },
        { match: '(?i)^\\s*(script)\\s+([A-Za-z_][A-Za-z0-9_]*)', captures: {
            1: { name: 'keyword.control.coyotescript' }, 2: { name: 'entity.name.function.coyotescript' }
        } },
        { match: `(?i)^\\s*(event)\\s+(${events})\\b`, captures: {
            1: { name: 'keyword.control.coyotescript' }, 2: { name: 'entity.name.tag.coyotescript' }
        } },
        { name: 'keyword.control.coyotescript', match: '(?i)\\b(event|script|if|else|repeat|foreach|while|switch|case|return)\\b' },
        { name: 'support.function.coyotescript', match: `(?i)(?:^\\s*|(?<=\\()\\s*)\\b(?:${commands})\\b` },
        { name: 'variable.other.coyotescript', match: '[$%][A-Za-z_][A-Za-z0-9_]*' },
        { name: 'constant.language.coyotescript', match: '(?i)\\b(true|false|public|private|hidden)\\b' },
        { name: 'constant.numeric.coyotescript', match: '(?<![\\w$%])-?\\b\\d+(?:\\.\\d+)?\\b' },
        { name: 'keyword.operator.coyotescript', match: '!contains\\b|\\b(contains|add|remove|include|exclude|new|in)\\b|==|!=|>=|<=|&&|\\|\\||\\+>|->|[=+*/<>!\\-]' },
        { name: 'punctuation.section.parens.coyotescript', match: '[()]' }
    ]
};
await writeFile(new URL('../syntaxes/coyotescript.tmLanguage.json', import.meta.url), `${JSON.stringify(grammar, null, 2)}\n`);
console.log(`Updated ${catalog.commands.length} commands and ${catalog.events.length} events.`);
