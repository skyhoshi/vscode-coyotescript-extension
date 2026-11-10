# CoyoteScript for Visual Studio Code

Unofficial language support for [CoyoteMIDI's CoyoteScript](https://coyotemidi.com/docs/).
This extension helps edit scripts; it does not execute them or require CoyoteMIDI.

## Features

- Language mode for `.cy`, `.coyote`, and `.coyotescript`.
- Syntax highlighting, comment toggling, bracket matching, four-space indentation,
  snippets, and indentation folding.
- Offline IntelliSense for 137 commands and 14 events, local/global variables,
  common argument values, and same-document subscript calls.
- Hover syntax, links to the official reference, and positional parameter hints.
- Live Problems diagnostics for unknown commands/events, unmatched parentheses,
  unclosed double quotes, invalid indentation, missing blocks, malformed headers,
  and duplicate subscript declarations.
- Outline for events, subscripts, and variables; Go to Definition for assigned
  variables and `runscript default <subscript>` within the same document.

The file associations are project conventions selected for this extension.
For scripts saved as `.txt`, choose **CoyoteScript** in VS Code's language selector;
the extension deliberately does not claim every text file.

## Try it

1. Install Node.js 22 or newer and open this repository folder in VS Code.
2. Run `npm ci`, then `npm run build`.
3. Press **F5** to launch the Extension Development Host.
4. Open [examples/midi.cy](examples/midi.cy) in that window. Use **Ctrl+Space**
   for completions, **Ctrl+Shift+Space** for parameter hints, and **F12** for
   same-document definitions.
5. Introduce a typo such as `pritn hello` to see a warning in the Problems panel.

To install locally, run `npm run package`, then choose **Extensions: Install from
VSIX...** and select `coyotescript-0.1.0.vsix`.
On Windows, you can instead run `.\scripts\build-vsix.ps1`; it packages the
extension and reports the resulting VSIX path. Run `npm ci` first if dependencies
are not installed.

The manifest uses `skyhoshi` as a provisional publisher identifier for local builds.
Marketplace publication requires ownership of that publisher; nothing is published
by the build or packaging commands.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `coyotescript.lint.enabled` | `true` | Enable or disable diagnostics. |
| `coyotescript.lint.unknownCommands` | `true` | Warn about unknown commands/events; disable when using newer runtime additions. |

Both settings respect workspace/resource configuration. Editing diagnostics are
debounced by 150 ms; closing a document clears its diagnostics and cached analysis.

## Development

```shell
npm ci
npm test
npm run test:integration
npm run package
```

`npm test` builds and runs the editor-independent regression suite.
`npm run test:integration` downloads a stable VS Code test instance on first use
and exercises the actual language providers in an isolated Extension Host. It
needs a desktop environment and internet access for the initial download.
`npm run watch` recompiles while developing.

The development-only packager uses a patched `minimatch` override because its
declared major version currently includes a denial-of-service advisory. Packaging
is validated with that override; the extension has no runtime npm dependencies.

The [implementation plan](docs/PLAN.md) records the approved feature list, architecture,
roadmap, sources, and initial limitations. The core is independent of VS Code;
language providers reuse its tokenization, cursor context, and analysis.

## Catalog and limitations

The bundled factual command/event catalog comes from the
[official structured reference](https://update.coyotemidi.com/?request=scriptdocs).
Run `npm run catalog:update` to refresh it and regenerate the syntax grammar,
then review the diff and run tests. Updating explicitly needs network access;
normal extension operation is offline. The updater corrects the upstream
`getmodifierfolders` syntax label, which currently says `gettranslationfolders`.
Reference prose is not bundled.

This is conservative static analysis, not a complete interpreter or type checker.
Unquoted text and collection literals are valid; arbitrary bare words inside
parentheses are not automatically treated as misspelled commands. Variables can
be injected by events, translations, or callers, so unassigned variables are not
errors. Globals are suggested from this document, not indexed across all scripts.
Double-quoted text is recognized; undocumented escaping and multiline syntax
are not inferred. Parameter hints follow the reference's positional notation,
not inferred runtime types. Formatting, execution, cross-file navigation, and
exhaustive argument validation are outside this first release.

Not affiliated with or endorsed by CoyoteMIDI. Distributed under [GPL-3.0](LICENSE).
