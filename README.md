# nf-core/actions

Centralised reusable workflows and TypeScript actions for nf-core pipelines.

A pipeline repo keeps a thin stub workflow that calls a reusable workflow here,
pinned to a major tag such as `@v1`. All logic, and all security fixes, live in
this repo. When a maintainer moves the `v1` tag, every pipeline that calls it
picks up the change on its next run. Changing a value in 141 pipeline repos
needs a 141-repo campaign; changing it here needs one tag move.

## Example: a pipeline using this repo

A pipeline repo does not implement test logic itself. It calls the shared
[`nf-test.yml`](#the-nf-testyml-workflow) workflow and passes its own settings
through `.nf-core.yml`, not through the stub:

```yaml
# .github/workflows/nf-test.yml in a pipeline repo
name: nf-test

on:
  pull_request:
  release:
    types: [published]
  workflow_dispatch:

concurrency:
  group:
    ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  test:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/nf-test.yml@v1
    secrets:
      SENTIEON_LICSRVR_IP: ${{ secrets.SENTIEON_LICSRVR_IP }}
      SENTIEON_LICENSE_MESSAGE: ${{ secrets.SENTIEON_LICENSE_MESSAGE }}
      SENTIEON_ENCRYPTION_KEY: ${{ secrets.SENTIEON_ENCRYPTION_KEY }}
```

The pipeline repo never edits test logic, matrix setup, or reporting. The three
`secrets:` lines are optional: omit them entirely for a pipeline that does not
use Sentieon. See [The `nf-test.yml` workflow](#the-nf-testyml-workflow) for the
full input and secret list, and for the ARM/GPU variant example.

The workflow-level `permissions: {}` denies everything by default. The `test:`
job grants back only `contents: read`, the most every job inside
[`nf-test.yml`](.github/workflows/nf-test.yml) requests. A called (reusable)
workflow can only narrow the permissions the calling job holds, never widen
them: without this job-level grant, GitHub rejects the run at validation,
because the called workflow's jobs ask for `contents: read` while the caller
grants `contents: none`.

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
      - uses: nf-core/setup-nextflow@v1
      - uses: nf-core/setup-nf-test@v1
      - id: get-shards
        uses: nf-core/actions/actions/get-shards@v1
        with:
          max-shards: 10
          # 'test,docker': the same profile the 'test' job below runs.
          profile: test,docker
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

`get-shards` runs nf-test, so Nextflow must already be on `PATH` for the dry run
too, not only for the real test run below.

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
          # Must match the 'nf-test' step's profile below: a different
          # profile could select a different test set, and the 'nf-test'
          # action treats zero tests as a hard failure.
          profile: test,docker
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
          profile: test,docker
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

**TAP directive limitation.** An unescaped `#` followed by `SKIP` or `TODO`
(case-insensitive) is read as a TAP directive, per the TAP specification, and
the test is counted as skipped or expected-to-fail instead of by its own
ok/not-ok result. nf-test does not escape a `#` in a test's own name, so a test
named with an unescaped `# SKIP` or `# TODO` sequence is read as a directive,
not as literal text: a real failure with such a name can report green. An
escaped `\#` is read correctly as a literal character. This is a known, accepted
limitation of TAP-conformant parsing, not a bug; avoid that sequence in a test
name if it matters.

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

## The `nf-test.yml` workflow

[`nf-test.yml`](.github/workflows/nf-test.yml) is a reusable workflow that
replaces a pipeline's entire nf-test CI: shard discovery, the test matrix, tool
setup, and a stable gate job for branch protection. A pipeline calls it with the
stub shown in
[Example: a pipeline using this repo](#example-a-pipeline-using-this-repo).

### Inputs and secrets

| Input     | Default | Purpose                                                                                                                                                                                   |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `variant` | `''`    | Names this call's flavour, for example `arm` or `gpu`. Any non-default value restricts the matrix to the fastest profile, regardless of branch. `gpu` also enables GPU-gated tests.       |
| `runner`  | `''`    | Overrides the RunsOn runner label for this call only. Forwarded straight to `read-config`'s own `runner` input, so it wins over `.nf-core.yml` the same way any `read-config` input does. |

| Secret                     | Required | Purpose                                      |
| -------------------------- | -------- | -------------------------------------------- |
| `SENTIEON_LICSRVR_IP`      | No       | Passed through to the pipeline's nf-test run |
| `SENTIEON_LICENSE_MESSAGE` | No       | Passed through to the pipeline's nf-test run |
| `SENTIEON_ENCRYPTION_KEY`  | No       | Passed through to the pipeline's nf-test run |

Every other setting — `nf-test-version`, `nextflow-versions`, `profiles`,
`max-shards`, `nf-test-workdir`, `runner`, and `nf-core-version` — comes from
`.nf-core.yml`'s `ci:` block through [`read-config`](#the-ci-config-block). This
keeps two pipelines' stubs byte-identical: only a call that genuinely needs a
different runner or a different hardware flavour sets an input at all.

### ARM or GPU variant

A pipeline that also validates on ARM keeps a second, equally small stub file
and calls the same workflow with `variant` and `runner` set:

```yaml
# .github/workflows/nf-test-arm.yml in a pipeline repo
name: nf-test (ARM)

on:
  pull_request:
  workflow_dispatch:

concurrency:
  group:
    ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions: {}

jobs:
  test:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/nf-test.yml@v1
    with:
      variant: arm
      runner: 4cpu-linux-arm64
```

There is no separate `nf-test-arm.yml` or `nf-test-gpu.yml` workflow in this
repo: the ARM and GPU flavours fall out of `variant` and `runner` on the one
shared workflow, not out of a duplicated file.

As in the default stub, `test:` grants `contents: read` even though the
workflow-level default is `permissions: {}`: see the note after the default stub
above.

### Referencing the sibling actions

`nf-test.yml` calls `read-config`, `plan-run`, `get-shards`, and `nf-test` with
GitHub's `$/` self-repository syntax, for example `uses: $/actions/get-shards`.
`$/` resolves to this repo at the exact commit already running, with no separate
tag lookup. A plain `owner/repo/path@v1` reference, by contrast, is
independently re-resolved to whatever `v1` currently points at each time a job
starts, so a release that moves `v1` while a long matrix run is still starting
its jobs could mix commits within one run. `$/` cannot skew that way: every job
runs the sibling action from the same commit as the `nf-test.yml` version the
pipeline called, because it is the same resolution, not a new one.

`$/` requires Actions runner 2.336.0 or later and is not yet recognised by
actionlint v1.7.12; `.github/actionlint.yaml` carries a narrow, named `ignore`
rule for exactly this, to remove once actionlint catches up.

**Operational prerequisite.** `$/` needs Actions runner **2.336.0 or later**,
and does not exist on **GitHub Enterprise Server** at all. Most of this
workflow's jobs run on self-hosted runners that RunsOn provisions; this repo
does not control the runner version on that fleet. If a runner in the fleet is
older than 2.336.0, every job in every pipeline that calls this workflow fails
at action resolution, with an error that does not mention the runner version (it
reads as the action reference being invalid, not as a version problem). Confirm
with whoever maintains the RunsOn fleet that its runners are kept at 2.336.0 or
later before relying on this workflow.

### Migrating from a pipeline's own `nf-test.yml`

- **Check names**: `nf-test-changes`, `nf-test`, and `confirm-pass` keep their
  names, so existing branch-protection rules still match. `config` is new: it is
  not required, so it does not need adding to branch protection, but it will
  appear in the checks list.
- **Tool installation moves into this workflow.** A pipeline that vendored
  `nf-core/setup-nextflow`, `nf-core/setup-nf-test`, or a container-engine setup
  step in its own `nf-test.yml` removes that step: this workflow already runs
  it, driven by `.nf-core.yml`'s `ci.nf_test_version`.
- **`SKIP_SENTIEON`** is now computed from whether the `SENTIEON_LICSRVR_IP`
  secret is empty, not from the event type. A pipeline that skipped Sentieon
  tests on conda for reasons other than missing secrets needs to express that in
  its own nf-test tags instead.
- **The PR-comment artifact for a failed `latest-everything` run is not built
  yet.** That lands with the `pr-comment.yml` workflow; until then, a
  `latest-everything` failure shows only as a non-blocking, orange check and in
  that job's own summary.

### Sentieon secret exposure

The `SENTIEON_LICSRVR_IP`, `SENTIEON_LICENSE_MESSAGE`, and
`SENTIEON_ENCRYPTION_KEY` secrets are optional on `workflow_call`. Only a
pipeline whose stub passes them (see
[Example: a pipeline using this repo](#example-a-pipeline-using-this-repo)) is
affected by what follows; today that is a small number of pipelines, for example
those that test Sentieon tools such as sarek.

GitHub withholds secrets only from a fork's pull request. A pull request from a
branch of the pipeline's own repository, opened by anyone with write access,
still receives these secrets, because it is not a fork pull request. Its test
code runs with the Sentieon credentials available to it. This matches what these
pipelines do today: this fix does not change the behaviour, only documents it.

In short: a fork pull request is unaffected; a same-repository branch from a
contributor with write access is trusted with these secrets, the same as any
other secret a workflow makes available to a non-fork pull request.

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
