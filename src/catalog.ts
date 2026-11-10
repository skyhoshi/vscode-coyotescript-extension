import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Entry {
    name: string;
    syntax: string;
    category: string;
}

interface Catalog {
    commands: Entry[];
    events: Entry[];
}

const catalog: Catalog = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
export const commands = new Map(catalog.commands.map(entry => [entry.name.toLowerCase(), entry]));
export const events = new Map(catalog.events.map(entry => [entry.name.toLowerCase(), entry]));
export const blocks = new Set(['if', 'else', 'repeat', 'foreach', 'while', 'switch', 'case', 'script', 'event']);
export const headers = new Map<string, Entry>([
    ['script', { name: 'script', syntax: 'script [<name>] (public/hidden/private)', category: 'Structure' }],
    ['event', { name: 'event', syntax: 'event [<event name>] (<filters>)', category: 'Structure' }]
]);

export function documentationUrl(entry: Entry, isEvent = false): string {
    if (entry.name === 'script') return 'https://coyotemidi.com/docs/subscripts/';
    if (entry.name === 'event') return 'https://coyotemidi.com/docs/events/';
    return `https://coyotemidi.com/commands-and-events/#${isEvent ? 'event' : 'command'}_${entry.name}`;
}

export function parameters(entry: Entry): string[] {
    return entry.syntax.match(/\[[^\]]*\]|\([^)]*\)/g) ?? [];
}
