# nf-core/actions

Centralised reusable workflows and TypeScript actions for nf-core pipelines.

A pipeline repo keeps a thin stub workflow that calls a reusable workflow here,
pinned to a major tag such as `@v1`. All logic, and all security fixes, live in
this repo. When a maintainer moves the `v1` tag, every pipeline that calls it
picks up the change on its next run. Changing a value in 141 pipeline repos
needs a 141-repo campaign; changing it here needs one tag move.

## Example: a pipeline using this repo

A pipeline repo does not implement test logic itself. It calls the shared
workflow and passes its own settings:

```yaml
# .github/workflows/nf-test.yml in a pipeline repo
name: nf-test

on:
  pull_request:
  push:
    branches:
      - master

jobs:
  test:
    uses: nf-core/actions/.github/workflows/nf-test.yml@v1
    with:
      profile: docker
    secrets: inherit
```

The pipeline repo never edits test logic, matrix setup, or reporting. It only
supplies the small set of inputs the shared workflow accepts.

## Configuration precedence

Every setting a shared workflow or action reads resolves in this order:

1. The workflow `with:` input, if the calling pipeline set one.
2. The `.nf-core.yml` file in the calling pipeline's repo, if it sets one.
3. A built-in default in this repo.

Falling back to the built-in default logs a warning in the Actions run, so a
pipeline maintainer can see when they are relying on a default instead of an
explicit choice.

`.nf-core.yml` also records the pipeline's template version. Code in this repo
reads that version and can change behaviour for older pipelines instead of
breaking them outright.

## The `ci:` config block

The [`read-config`](actions/read-config) action resolves CI settings and exposes
them as outputs for later steps and reusable workflows. It reads a `ci:` block
from the pipeline's `.nf-core.yml`. That block does not exist by default; a
pipeline adds it only to override a setting. For example:

```yaml
# .nf-core.yml in a pipeline repo
nf_core_version: '4.0.3'
repository_type: pipeline
template:
  name: rnaseq
  org: nf-core
  version: '3.27.0dev'
ci:
  nf_test_version: '0.10.0'
  nextflow_versions: ['24.10.0', 'latest-everything']
  profiles: ['docker', 'singularity']
  max_shards: 12
  nf_test_workdir: '~'
  runner: '8cpu-linux-x64'
```

Omitting a key under `ci:` is normal. It means the pipeline follows the central
default for that setting, and `read-config` logs a warning in the Actions run
naming the setting and the default used, so a maintainer can see where the value
came from.

Each setting follows the same three-step order as
[Configuration precedence](#configuration-precedence) above: the action input
first, then the value at that setting's path under `ci:`, then the built-in
default.

A setting whose value is a list or a number is available on the input side and
the output side as JSON, for example `'["docker","singularity"]'` or `'12'`, so
a calling workflow can use `fromJSON()` to build a matrix.

`read-config` also exposes `nf-core-version`, `repository-type`, and
`pipeline-name`, read from the pipeline's existing schema outside `ci:`. These
have no built-in default: if a pipeline's `.nf-core.yml` does not set them, the
output is an empty string and `read-config` logs a warning.

## The `get-shards` action

The [`get-shards`](actions/get-shards) action replaces a composite action that
used to be vendored into every pipeline. It runs an nf-test dry run, reads how
many tests nf-test would execute, and turns that count into a shard matrix for a
later job. It does not install nf-test: the calling workflow must already have
it on `PATH`, for example through `nf-core/setup-nf-test`.

```yaml
# .github/workflows/nf-test.yml in a pipeline repo
name: nf-test

on:
  pull_request:

jobs:
  get-shards:
    runs-on: ubuntu-latest
    outputs:
      shards: ${{ steps.get-shards.outputs.shards }}
      total-shards: ${{ steps.get-shards.outputs.total-shards }}
      has-tests: ${{ steps.get-shards.outputs.has-tests }}
    steps:
      # fetch-depth: 0 fetches full history: nf-test's --changed-since needs
      # HEAD^ to exist to find what changed.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nf-core/setup-nf-test@v1
      - id: get-shards
        uses: nf-core/actions/actions/get-shards@v1
        with:
          max-shards: 10
          changed-since: HEAD^

  test:
    needs: get-shards
    if: needs.get-shards.outputs.has-tests == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: ${{ fromJSON(needs.get-shards.outputs.shards) }}
    steps:
      - name: Run shard ${{ matrix.shard }}
        run:
          echo "shard ${{ matrix.shard }} of ${{
          needs.get-shards.outputs.total-shards }}"
```

`get-shards` only produces the shard plan; it does not install nf-test, so the
first job installs it before calling `get-shards`, for example with
`nf-core/setup-nf-test`. The second job reads its matrix from the first job's
outputs with `fromJSON()`, and is skipped outright when there is nothing to
test.

The shard count is `min(number of tests, max-shards)`. No tests to run is
success, not failure: `shards` is `'[]'`, `total-shards` is `'0'`, and
`has-tests` is `'false'`, so a calling workflow can skip its matrix job outright
instead of running it with an empty matrix.

Every value nf-test needs — the profile, `--tag`, `--changed-since` — is passed
to the process as its own argument, with no shell involved. A tag or profile
value cannot inject a shell command, however it is formed. Values logged for
debugging are JSON-encoded, so a value containing a newline cannot inject a
workflow command into the Actions log either. If nf-test's dry-run output does
not match either a known test count or its "no tests" message, `get-shards`
fails loudly instead of silently falling back to zero shards, because an empty
matrix that reports success having tested nothing is worse than a failed run.

### Migrating from the vendored action

A pipeline switching from the old vendored composite action to `get-shards` must
handle these differences:

- The outputs are renamed: `shard` becomes `shards`, and `total_shards` becomes
  `total-shards`.
- The array elements in `shards` are numbers, for example `[1,2,3]`, not
  strings.
- The `paths` input is gone. The vendored action never used it.
- `get-shards` does not install nf-test. Add a step such as
  `nf-core/setup-nf-test` before it in the workflow.

## The `nf-test` action

The [`nf-test`](actions/nf-test) action runs one shard of a pipeline's nf-test
suite and reports the result. Like `get-shards`, it does not install any tool:
the calling workflow must already have `nf-test` on `PATH`, and, for a real
pipeline run, Nextflow, Python, and a container engine too.

```yaml
# .github/workflows/nf-test.yml in a pipeline repo
name: nf-test

on:
  pull_request:

jobs:
  get-shards:
    runs-on: ubuntu-latest
    outputs:
      shards: ${{ steps.get-shards.outputs.shards }}
      total-shards: ${{ steps.get-shards.outputs.total-shards }}
      has-tests: ${{ steps.get-shards.outputs.has-tests }}
    steps:
      # fetch-depth: 0 fetches full history: nf-test's --changed-since needs
      # HEAD^ to exist to find what changed.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nf-core/setup-nextflow@v1
      - uses: nf-core/setup-nf-test@v1
      - id: get-shards
        uses: nf-core/actions/actions/get-shards@v1
        with:
          max-shards: 10
          changed-since: HEAD^

  test:
    needs: get-shards
    if: needs.get-shards.outputs.has-tests == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: ${{ fromJSON(needs.get-shards.outputs.shards) }}
    steps:
      # fetch-depth: 0 fetches full history: nf-test's --changed-since needs
      # HEAD^ to exist to find what changed.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nf-core/setup-nextflow@v1
      - uses: nf-core/setup-nf-test@v1
      - uses: nf-core/actions/actions/nf-test@v1
        with:
          profile: docker
          shard: ${{ matrix.shard }}
          total-shards: ${{ needs.get-shards.outputs.total-shards }}
```

Every value nf-test needs is passed to the process as its own argument, the same
as in `get-shards`: a `tags` value with shell metacharacters cannot inject a
shell command. TAP output is parsed in TypeScript, not a bash `while` loop, so a
test name with an unusual character cannot break the summary table: it is
HTML-escaped before it reaches the table too. The action fails when any test
failed, or when nf-test itself exited non-zero (for example a Nextflow crash),
even if every test that did run passed. It also fails, instead of reporting a
hollow pass, when nf-test reports zero tests, whatever its exit code, and when
the TAP plan line promises more tests than were actually reported: both mean the
run tested nothing or was cut short. There is no legitimate zero-test path for
this action: `get-shards` already caps the shard count at the number of tests it
found, and stops the matrix job outright when there are none.

`extra-args` accepts a JSON array of strings, for example
`'["--follow-dependencies"]'`, so a pipeline with unusual nf-test needs can pass
an extra argument without forking the calling workflow. A plain string is
rejected, because it would need re-splitting on spaces by something downstream,
reopening the same shell-injection risk this action avoids everywhere else. An
element that sets a flag this action already owns (`--tap`, `--shard`,
`--profile`, `--tag`, `--changed-since`, `--verbose`, `--ci`) is rejected too,
so `extra-args` cannot redirect the TAP report away from the path this action
reads or otherwise override the action's own contract.

### Migrating from the vendored action

A pipeline switching from the old vendored composite action to `nf-test` must
handle these differences:

- The `paths` input is gone. The vendored action never used it.
- Tool setup moved to the calling workflow. The vendored action installed
  Nextflow, Python, nf-test, and the profile's container engine itself; this
  action assumes they are already on `PATH` when it runs.
- The `sudo rm -rf /home/ubuntu/tests/` cleanup step is gone. It hardcoded a
  specific runner user's home directory, and this action does not own the
  working directory's lifecycle. Runner hygiene, if still needed, belongs in the
  calling workflow.

## Tag policy

Two different pinning rules apply, for two different trust relationships:

- **Pipelines pin this repo by tag.** A pipeline's stub workflow calls
  `nf-core/actions/...@v1`. This repo, and the `nf-core` GitHub org, are
  controlled by nf-core maintainers, so a moving major tag is the intended
  distribution mechanism.
- **This repo pins external actions by commit SHA.** Any third-party action used
  inside this repo's own workflows (`actions/checkout`, `github/codeql-action`,
  and so on) is pinned to a full commit SHA, with a `# vX` comment for context.
  Actions under the `nf-core`, `nextflow-io`, and `seqeralabs` orgs are the
  exception: those orgs are nf-core-controlled, so they are pinned to a major
  tag, the same as pipelines pin this repo. The trust chain ends at code nf-core
  has reviewed.

A tag ruleset on this repo blocks anyone from moving a major tag (`v1`, `v2`,
...) outside the [release workflow](.github/workflows/release.yml), which gates
the move behind required reviewers.

## Layout

```
actions/<name>/action.yml   Action metadata: runs.using: node24, runs.main: dist/index.js
actions/<name>/dist/        Committed, built bundle for that action
src/actions/<name>/         TypeScript source for that action's entry point
src/lib/                    Shared code used by more than one action
__tests__/                  Unit tests, mirroring src/
.github/workflows/          Reusable workflows pipelines call, plus this repo's own CI
```

`actions/*/dist/**` is committed. It is built from `src/`, never written by
hand, and CI fails if it is out of date. The bundle is not minified and has no
sourcemap, so a pull request diff shows the actual code change under review.

See [PLAN.md](./PLAN.md) for the stage-by-stage build plan, and
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to build, test, and add an action.
