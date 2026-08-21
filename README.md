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
