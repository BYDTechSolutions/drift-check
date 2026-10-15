# Security policy

## Reporting a vulnerability

Please email **sales.bydtech@gmail.com** with the details, instead of opening a
public issue. We will acknowledge the report and keep you posted on the fix.

## Scope

`drift-check` reads the files its config names and, only with `--fix`, writes
the source's bytes over the other members. A `.mjs` or `.js` config file is
imported and runs as code, like any JavaScript config: only use config files
you trust. Paths in a config may point anywhere on disk, including outside the
project, so review a config before running `--fix` with it.
