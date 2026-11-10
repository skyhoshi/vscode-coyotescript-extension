# CoyoteScript extension: features and implementation plan

## Approved first release

- Language ID `coyotescript`; file associations `.cy`, `.coyote`, `.coyotescript`.
- Syntax highlighting for commands, events, subscripts, variables, text,
  numbers, operators, and `//` comments.
- Four-space indentation, bracket matching, comment toggling, and snippets.
- Offline command/event completion, variable completion, hover documentation
  links, and parameter hints.
- Live diagnostics for unknown commands/events, unclosed double quotes,
  unmatched parentheses, indentation problems, missing blocks, malformed
  headers, and duplicate subscripts.
- Document outline, indentation folding, and same-document definitions for
  subscripts and assigned variables.
- Automated analysis and Extension Host tests; a locally installable VSIX.

## Architecture

Use TypeScript and VS Code's language-provider APIs, without a separate language
server for this first release. Keep the tokenizer, analysis, symbol discovery,
and completion context in an editor-independent core. One bundled JSON catalog
drives command/event completion and help. No network access, script execution,
CoyoteMIDI installation, telemetry, or cloud resources are needed at runtime.

The initial catalog includes all 137 command names and 14 event names exposed by
the official documentation endpoint on 2026-11-09. Store factual names, categories,
and syntax only, not copies of the reference's prose descriptions.

## Phases

1. **Foundation:** extension manifest, compiler configuration, development launch
   tasks, language configuration, grammar, snippets, and factual catalog.
2. **Analysis:** line-aware tokenization, indentation blocks, conservative
   diagnostics, section-scoped variables, subscripts, folding, and cursor context.
3. **Editor integration:** diagnostic lifecycle, completion, hover, signature
   help, outline, and same-document definition providers.
4. **Verification:** unit regressions for valid syntax and failure cases, actual
   Extension Host provider tests, compilation, and VSIX packaging.

## Initial implementation verification

All four phases above are implemented. On 2026-11-09:

- `npm test`: 12 passing regression tests, including actual TextMate tokenization.
- Analysis core: 99.23% line coverage, 97.50% branch coverage.
- Extension Host checks passed on VS Code 1.145.2, including automatic activation,
  file associations, indentation defaults, provider output, diagnostic updates,
  settings changes, and cleanup when a document closes.
- The packaged VSIX was extracted and tested as the development extension in a
  separate Extension Host; all provider checks passed without the source tree
  or runtime npm dependencies inside the package.
- `npm audit`: zero reported vulnerabilities.
- `npm run package`: produced `coyotescript-0.1.0.vsix` for local installation.

The minimum engine is declared as VS Code 1.96 and checked against its API types;
the runtime smoke test above used 1.145.2, not every supported editor version.
Linting remains deliberately conservative as described below.

## Deliberate limits

- This is an unofficial editor extension, not a CoyoteMIDI interpreter.
- File associations are user-selected, not a claim about a native export format.
- Unquoted text, list/map literals, and nested expressions are valid. Do not
  assume JavaScript syntax, semicolons, braces, or function-call commas.
- Unknown bare words inside parentheses may be text/list literals, so do not
  flag them as unknown nested commands.
- Do not flag unassigned variables: events, translations, and callers can inject
  local variables, and globals can originate in other scripts.
- No runtime types, exhaustive argument validation, cross-file/global indexing,
  formatting, execution/debugging, or automatic changes to scripts in v0.1.
- Signature hints follow documented positional syntax; they are not type checks.
- Double-quoted strings and single-line expressions follow the published examples;
  undocumented escaping or multiline syntax is not inferred.

## Later releases

1. Validate real exported scripts and expand the regression corpus.
2. Add verified argument/value checks, opt-in semantic rules, and quick fixes.
3. Add workspace navigation and rename once cross-script scoping is established.
4. Consider formatting and an LSP only after syntax is sufficiently specified.
5. Add publishing automation after choosing a Marketplace publisher identity.

## Sources

- [Language documentation](https://coyotemidi.com/docs/)
- [Command and event reference](https://coyotemidi.com/commands-and-events/)
- [Structured reference](https://update.coyotemidi.com/?request=scriptdocs)
- [Command nesting](https://coyotemidi.com/docs/command-nesting/)
- [Variables](https://coyotemidi.com/docs/variables/)
- [Events](https://coyotemidi.com/docs/events/)
- [Subscripts](https://coyotemidi.com/docs/subscripts/)
- [Comments](https://coyotemidi.com/docs/comments/)
- [VS Code language providers](https://code.visualstudio.com/api/language-extensions/programmatic-language-features)
