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
  nextflow_lint: true
```

Omitting a key under `ci:` is normal. It means the pipeline follows the central
default for that setting, and `read-config` logs a warning in the Actions run
naming the setting and the default used, so a maintainer can see where the value
came from.

Each setting follows the same three-step order as
[Configuration precedence](#configuration-precedence) above: the action input
first, then the value at that setting's path under `ci:`, then the built-in
default.

A setting whose value is a list, a number, or a boolean is available on the
input side and the output side as JSON, for example
`'["docker","singularity"]'`, `'12'`, or `'true'`, so a calling workflow can use
`fromJSON()` to build a matrix or gate an `if:` condition.

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

### Shard count assumes profile-independent test selection

`nf-test-changes` enumerates the shard count once, from the dry run of only the
first entry in `test-profiles`, while the `nf-test` job fans out over every
entry with that one `total-shards`. This assumes nf-test selects tests by file
and tag, not by profile, so the count is the same whichever profile ran the dry
run. A pipeline whose test selection genuinely varies by profile would break
that assumption and could get an uneven shard split.

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

## The `validate-patch` action

The [`validate-patch`](actions/validate-patch) action is the last gate before a
privileged job applies an untrusted patch and pushes it. It does not apply the
patch; it only decides whether the patch is safe to apply, and logs an audit
trail of what it contains.

```yaml
- name: Validate the patch
  uses: nf-core/actions/actions/validate-patch@v1
  with:
    patch-path: ${{ runner.temp }}/lint-fix/lint-fix.patch
```

Given `patch-path`, it rejects, each with its own message:

- a path that is not a regular file, including a symlink (an uploaded artifact
  can contain one);
- an empty file;
- a file over `max-size-bytes` (default 5 MiB, generous for a formatting diff
  and far below anything that should reach a privileged job);
- a file that is not a valid git patch, checked independently of the current
  tree (`git apply --numstat`);
- a well-formed patch that no longer applies to the current tree
  (`git apply --check`), for example because the branch moved after the patch
  was built.

A missing file at `patch-path` is not an error: `has-patch` is `false`, which is
the normal outcome when a linter made no changes. Every other problem above
fails the action. On success, it logs the touched files and the diffstat, and
publishes `files-changed`, so the run's log and summary show what the privileged
job is about to commit before it commits it.

`validate-patch` never passes `--unsafe-paths` to `git apply`, relying on git's
own refusal to write outside the checkout.

**What it deliberately does not block.** It does not reject a patch that touches
`.github/workflows/**`, `.nf-core.yml`, or any other specific path. The linter
this repo runs (`prek`, see below) legitimately reformats YAML, including
workflow files, so blocking changes to them would break real fixes, not just
attacks. Three things bound the residual risk instead: the commit lands on the
pull request's own branch, still subject to normal review before merge, not on a
protected branch directly; GitHub itself refuses a push that touches
`.github/workflows/**` from a token without the `workflow` OAuth scope, so
keeping that scope off the bot's token (if operationally possible) closes this
specific escalation path independently of this action; and `prepare-fix` (below)
never holds a credential, so a hostile pre-commit hook running there has nothing
to steal even if it tries. A maintainer reviewing a bot-authored "automated lint
fix" commit should give it the same scrutiny as a human-authored one: the commit
message does not imply the diff was checked for anything beyond being a
well-formed, applying patch.

## The `fix-linting.yml` workflow

[`fix-linting.yml`](.github/workflows/fix-linting.yml) implements the
`@nf-core-bot fix linting` pull request comment command. It replaces a vendored
workflow that ran a pull request's own lint hooks in the same job that held the
bot's push credential: hook code the pull request defines could read that
credential. This workflow never does that. See SECURITY.md for the trust
boundary it follows, and PLAN.md's principle 4 for the design rule.

### Three jobs, one trust boundary

- **`acknowledge`** gates the whole run. It runs only when the comment is on a
  pull request and contains the command, then checks the commenter's permission
  against the repository (via the API, not `author_association`, which reflects
  a user's relationship to the repository, not their current permission level)
  and whether the pull request's head branch is protected. See
  [Branch protection and the commenter gate](#branch-protection-and-the-commenter-gate)
  for the exact rule. Holds `contents: read`, to look up the pull request and
  the branch, and `issues: write`, to react to the comment; it never checks out
  the pull request.
- **`prepare-fix`** checks out the pull request and runs its lint hooks
  (`prek`). This is untrusted code. It holds `contents: read` and
  `pull-requests: read`, nothing that can write, and no secret is referenced
  anywhere in the job. The checkout does not persist credentials. If the hooks
  changed anything, it stages the change and builds a binary git patch from the
  staged diff, and uploads it as an artifact; a hook failure that produces no
  patch fails the job outright. It never commits: `push-fix` (below) is the only
  job that creates a commit.
- **`push-fix`** holds the credential. It re-checks out the pull request head
  and confirms it still matches the SHA `prepare-fix` ran against (the patch no
  longer describes the tree otherwise), downloads and validates the patch with
  `validate-patch` above, applies it, and commits and pushes as the bot with
  hooks and GPG signing explicitly disabled for those two commands. It never
  runs a file that came from the pull request.

Every comment reaction (`eyes`, `+1`, `hooray`, `confused`) is posted with
`gh api`, not a third-party action: `push-fix` holds the bot's credential, and a
privileged job runs no third-party action, so the reaction there could not use
one anyway. `acknowledge` uses the same `gh api` call for consistency, even
though it is not itself privileged.

### Branch protection and the commenter gate

`push-fix` pushes with the bot's organisation-wide token. A collaborator with
plain `write` access cannot push to a protected branch directly, so admitting
any `write` user here would turn the bot into a way around that: the contributor
controls `.pre-commit-config.yaml` and every hook `prepare-fix` runs, so the
"lint fix" patch it produces can contain any diff at all.

`acknowledge` decides using `GET /repos/{owner}/{repo}/branches/{branch}` on the
pull request's head branch, read with `contents: read`. It does not use the
branch-protection endpoint itself
(`GET /repos/{owner}/{repo}/branches/{branch}/protection`): that one needs
`admin` on the repository, which this job does not hold and should not need just
to decide whether to run.

| Head branch   | Author                     | `write` / `admin` collaborator |
| ------------- | -------------------------- | ------------------------------ |
| Not protected | Allowed                    | Allowed                        |
| Protected     | **Denied** (needs `admin`) | Allowed only with `admin`      |

A release pull request's head branch is typically protected, so its own author
gets no exemption there: the bot would otherwise push to a protected branch on
the author's behalf, which the author could not do by pushing directly
themselves. On an ordinary, unprotected branch, the author exemption is
unchanged: the bot only ever pushes to the author's own branch, so letting them
trigger it grants them nothing beyond what pushing to it themselves already
would.

A failed lookup (the pull request API call, the branch API call, or the
collaborator-permission API call) denies the request and prints why, instead of
the job aborting silently: a maintainer commenting on someone else's pull
request sees a clear reason if the check itself could not run, not a missing
reaction and no explanation.

### Configuration

`prepare-fix` reads `.nf-core.yml` before checking out the pull request, so a
setting used to run the pull request's own hooks comes from the repository's own
default branch, not from the pull request under test. Today that is one value:
the Nextflow version, taken from `read-config`'s existing `nextflow-versions`
output (the first configured version), the same setting `nf-test.yml`'s dry run
uses. `prek` itself needs no separate version setting: its action pin already
fixes a version, and every hook's own version is already pinned in the
pipeline's own `.pre-commit-config.yaml`. Nothing new was added to
`.nf-core.yml` for this workflow.

### Pipeline stub

```yaml
# .github/workflows/fix-linting.yml in a pipeline repo
name: fix-linting

on:
  issue_comment:
    types: [created]

concurrency:
  group: ${{ github.workflow }}-${{ github.event.issue.number }}

permissions: {}

jobs:
  fix-linting:
    permissions:
      actions: read
      contents: read
      issues: write
      pull-requests: read
    uses: nf-core/actions/.github/workflows/fix-linting.yml@v1
    secrets:
      BOT_TOKEN: ${{ secrets.nf_core_bot_auth_token }}
```

`BOT_TOKEN` is optional and named explicitly: this stub never uses
`secrets: inherit`. Omitting it is valid syntax, but every job that needs it
then fails with a clear message instead of silently pushing with the workflow's
own default token. `secrets.nf_core_bot_auth_token` above is the existing
organisation secret already available to nf-core pipeline repos; only the name
on the left, `BOT_TOKEN`, is this workflow's own contract, so a pipeline whose
bot secret is named differently only needs to change the right-hand side.

The calling job grants `actions: read`, `contents: read`, `issues: write`, and
`pull-requests: read`: the union of what `fix-linting.yml`'s three jobs request
between them. A called workflow can only narrow the permissions the calling job
holds, never widen them, so a job here that granted only, say, `contents: read`
would make GitHub reject the run at validation the moment `push-fix` tried to
use `issues: write` to react to the comment.

The `concurrency` group has no `cancel-in-progress`: a second "fix linting"
comment on the same pull request queues behind the first instead of racing it
mid-push, which could otherwise fail with a non-fast-forward push.

### Migrating from the vendored workflow

- **Job names changed.** The vendored workflow's single `fix-linting` job (or
  the two-job `prepare-fix` / `push-fix` split some pipelines already carry)
  becomes `acknowledge`, `prepare-fix`, and `push-fix`. Update branch protection
  or status checks that name the old job, if any did.
- **The bot secret is now named and passed explicitly.** A stub that checked out
  or pushed directly with `secrets.nf_core_bot_auth_token` (or used
  `secrets: inherit`) now passes it as `BOT_TOKEN` in the `secrets:` block
  above; the reusable workflow fails clearly if it is missing, rather than
  falling back to the default token.
- **The commenter gate is stricter.** A comment from someone with neither write
  access nor pull request authorship is now rejected before anything runs,
  checked against the API rather than `author_association`.
- **No custom `.pre-commit-config.yaml` handling changed.** `prepare-fix` runs
  `prek` the same way the vendored workflow ran it; a pipeline's own hook
  configuration needs no change.

## The `linting.yml` workflow

[`linting.yml`](.github/workflows/linting.yml) replaces a pipeline's own
`linting.yml` (`prek` and `nf-core pipelines lint`) and, for a pipeline that
carries one, its separate `nextflow-lint.yml` (the Nextflow strict-syntax
check). All three checks are jobs in this one reusable workflow.

```yaml
# .github/workflows/linting.yml in a pipeline repo
name: nf-core linting

on:
  pull_request:
  push:
    branches: [master, main, dev]
  release:
    types: [published]

permissions: {}

jobs:
  run:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/linting.yml@v1
```

`run:` grants `contents: read`, the most every job inside `linting.yml`
requests. No job here needs a secret, so the stub passes none: not even
`secrets: inherit`.

### Jobs

- **`config`** resolves `nextflow-versions`, `nf-core-version` and
  `nextflow-lint` from `.nf-core.yml` once, for the jobs below. Not required in
  branch protection.
- **`pre-commit`** runs the pipeline's own `prek` hooks (formatting,
  `editorconfig-checker`, and whatever else `.pre-commit-config.yaml` lists).
  Not required in branch protection.
- **`nf-core`** runs `nf-core pipelines lint`, `--release` on a pull request
  into `master` or `main`. It writes the `pr-comment` artifact described below.
  Not required in branch protection.
- **`nextflow-lint`** runs `nextflow lint`, Nextflow's own strict-syntax
  checker, over every script and config file. Opt-in; see below. Not required in
  branch protection.
- **`confirm-pass`** reports the combined result of every job above and always
  runs. **This is the check to put in branch protection**, not any job above:
  GitHub treats a required check that reports `skipped` as satisfied, and each
  job above can report `skipped`, either by design (its own `if:`, or
  `nextflow-lint` being off) or because `config` failed and every job that
  `needs` it was skipped as a result. Requiring one of those jobs directly would
  let a broken `.nf-core.yml` bypass linting entirely.

Each job gates on `github.event_name` so the merged trigger set still runs each
check only when it ran before: `pre-commit` and `nf-core` skip `push`;
`nextflow-lint` skips `release`.

**`nextflow-lint` is opt-in.** It was never part of the pipeline template — only
rnaseq ran it, from its own `nextflow-lint.yml` — so adopting `linting.yml` does
not turn it on by default. Set `ci.nextflow_lint: true` in `.nf-core.yml` to
enable it; see [The `ci:` config block](#the-ci-config-block). Run
`nextflow lint -o concise .` locally first: a pipeline whose scripts or config
files are not yet strict-syntax clean gets a new failing check the moment it
enables this setting.

### `.nf-core.yml` keys

One new key: `ci.nextflow_lint` (boolean, default `false`) turns the
`nextflow-lint` job on. `nextflow-versions` (`ci.nextflow_versions`) and
`nf-core-version` (the pipeline's existing `nf_core_version` key) are the same
settings [`nf-test.yml`](#the-nf-testyml-workflow) already reads; see
[The `ci:` config block](#the-ci-config-block). `nextflow lint`'s own default
exclude list (`.git`, `.nf-test`, `nf-test.config`, `work`, and a few others)
already covers every generated or tool directory a pipeline has; no pipeline has
needed a different list, so there is no `ci:` setting for it. Add one, the same
way `profiles` or `max-shards` were added, only once a pipeline genuinely needs
to exclude something else.

### The `pr-comment` artifact

The `nf-core` job uploads an artifact named `pr-comment`,
`if: always() && github.event_name == 'pull_request'`, for
[`pr-comment.yml`](#the-pr-commentyml-workflow) to read:

| File            | Contents                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr_number.txt` | The pull request number, as plain text.                                                                                                                                                                                      |
| `header.txt`    | `lint`. Identifies which comment this artifact updates, so a later run replaces it instead of adding a second one.                                                                                                           |
| `comment.md`    | `nf-core pipelines lint`'s own Markdown report. **Absent** when the lint step never produced one (a failure before it ran). Its absence means "nothing to say", not an error.                                                |
| `resolved.md`   | Optional; see [The `post-comment` action](#the-post-comment-action) below. This workflow never writes one, so an absent `comment.md` behaves exactly as before: nothing is posted, and any earlier comment is left standing. |

This is the same three-file shape the previous, vendored `linting.yml` built for
its own PR-comment step; `pr-comment.yml` can read it unchanged. `pre-commit`
and `nextflow-lint` do not build one: neither did before, and a failing check
already shows its own output in the Actions log. The `nf-core` job also runs on
`release`, which has no pull request to comment on; gating on
`github.event_name == 'pull_request'` keeps a release run from uploading an
artifact with a blank `pr_number.txt`.

**The artifact may be entirely absent, and that is normal, not an error.** A
`release` run never uploads it, by the gate above. A job timeout or a cancelled
run skips `if: always()` steps too, the same as any other step. See
[the `post-comment` action](#the-post-comment-action) for how the poster treats
that.

### Migrating from a pipeline's own `linting.yml` and `nextflow-lint.yml`

- **Check names**: keep the stub's `name:` as `nf-core linting` and the
  `pre-commit` and `nf-core` checks keep their names. Two new checks appear,
  `config` and `confirm-pass`; neither is required except `confirm-pass` itself,
  which replaces whatever checks branch protection required before (see
  [Jobs](#jobs) above).
- **A pipeline that had `nextflow-lint.yml` sets `ci.nextflow_lint: true`.** The
  job is opt-in and defaults to off (see [Jobs](#jobs) above), so carrying it
  forward needs this key in `.nf-core.yml`. `Nextflow strict syntax lint / lint`
  is gone; the same check reappears as `nf-core linting / nextflow-lint`. Update
  branch protection to the new name (or to `confirm-pass`, see above), and
  delete `nextflow-lint.yml` and its stub. Run `nextflow lint -o concise .`
  locally before enabling the setting, to see what it would flag.
- **The stub gains a `push` trigger.** Add it even if the pipeline never had
  `nextflow-lint.yml`: `nextflow-lint` only runs on `pull_request` and `push`,
  the same events its standalone workflow used. It still needs
  `ci.nextflow_lint: true` to actually run.
- **The `pietrobolcato/action-read-yaml` step is gone.** `nf-core-version` now
  comes from `read-config`, the same action every other reusable workflow here
  uses, instead of a separate third-party action.
- **`GITHUB_COMMENTS_URL` is gone.** Nothing in `nf-core pipelines lint` reads
  it; it was already inert.
- **The release-branch condition is fixed.** Some pipelines carried
  `github.base_ref != 'master' || github.base_ref != 'main'` (always true, an
  `&&`/`||` mix-up), which ran the non-release lint even on a release pull
  request, alongside the release lint. This workflow uses the correct `&&`.

## The `post-comment` action

The [`post-comment`](actions/post-comment) action reads a `pr-comment` artifact
(see [The `pr-comment` artifact](#the-pr-comment-artifact) above) and posts or
updates a pull request comment from it. It is the code between untrusted input
and a write operation: everything in the artifact was produced by a job that may
have run pull request code, so `post-comment` validates every field before using
it, and never executes anything the artifact contains.

```yaml
- name: Post or update the pull request comment
  uses: nf-core/actions/actions/post-comment@v1
  with:
    artifact-path: ${{ runner.temp }}/pr-comment
    github-token: ${{ github.token }}
    head-sha: ${{ github.event.workflow_run.head_sha }}
```

| Input           | Required | Purpose                                                                                                                               |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact-path` | Yes      | Directory the `pr-comment` artifact was downloaded into. Missing entirely, or present with no `pr_number.txt`, means nothing to post. |
| `github-token`  | Yes      | Token used to verify the pull request and to create or update the comment. See [Token](#token) below.                                 |
| `head-sha`      | Yes      | Commit SHA to verify the artifact's claimed pull request number against.                                                              |

### What it validates, and why

**The pull request number.** `pr_number.txt` is written by a job that ran pull
request code; nothing stops that job writing a different number, which would let
a contributor make the bot comment on an unrelated pull request or issue.
`post-comment` does not trust it on its own. It calls
`GET /repos/{owner}/{repo}/commits/{head_sha}/pulls` (a GitHub REST endpoint
that lists the open or merged pull requests associated with a commit) using
`head-sha`, and requires the claimed number to be in that list. `head-sha` comes
from `github.event.workflow_run.head_sha`, part of the event that triggered this
workflow, not from the artifact. This is deliberately not
`github.event.workflow_run.pull_requests`: GitHub leaves that array empty
whenever the triggering run came from a pull request opened from a fork, which
is exactly the untrusted case this check exists for. The commit-based lookup
works the same way for a fork and for a same-repository branch, because GitHub
keys it by the commit itself, not by which repository holds the branch it lives
on. A commit with no associated pull request at all (closed without merging, or
a timing gap) is a clean no-op, logged, not a failure: there is nothing wrong,
just nothing to post. A commit that **is** associated with one or more pull
requests, none matching the claim, fails the action outright.

**The header.** `header.txt` selects which existing comment gets replaced. A
crafted header could collide with a different tool's own marker and let a
contributor overwrite an unrelated comment. `post-comment` requires it to match
`^[a-z][a-z0-9-]{0,63}$` (lowercase letters, digits and hyphens, starting with a
letter, at most 64 characters) and rejects, rather than sanitises, anything
else: silently rewriting a bad header would let two different inputs collapse
onto the same marker. The validated header is wrapped in a namespaced hidden
marker, `<!-- nf-core-actions:pr-comment:<header> -->`, invisible in the
rendered comment. A later run finds its own earlier comment by two conditions
together: the comment's body **starts with** that exact marker (not merely
contains it, so an untrusted body cannot bury a lookalike marker ahead of a
different tool's own report and hijack it, and a defence-in-depth strip of any
marker-shaped text in the body backs this up, see below), and the comment's
author is the login the calling token itself authenticates as (see
[Token](#token) below for how that is resolved).

**The body.** `comment.md` is untrusted Markdown, posted as data through the
GitHub API, never interpolated into a shell command or otherwise executed, so it
cannot be shell-injected regardless of its content. Before anything else,
`post-comment` neutralises three shapes in it: any text shaped like one of its
own markers (wrapped in inline code, so it cannot be mistaken for a real one),
any `@mention` (also wrapped in inline code, so it cannot ping anyone or feed a
mention-triggered automation), and any image embed, Markdown or raw `<img>`
(turned into a plain link, or escaped to visible text) — a lint report has no
legitimate need to embed a remote image, and one left alone is a tracking pixel
fired under the bot's trusted identity. GitHub rejects a comment body over 65536
characters; `post-comment` caps it at that length itself, truncating the body
(never the marker) and appending a short notice, closing an unterminated ` ``` `
fence first so the notice renders as a note under the code block instead of as a
line inside it, so an oversized report still gets posted instead of failing
outright. A body that is blank, or entirely whitespace, is treated the same as
an absent one: nothing to say, not a report that erases the previous one. Beyond
this, the body is not otherwise sanitised: it renders under the bot's own
account, which a contributor cannot spoof, so content that merely _looks like_ a
maintainer or a status is a rendering concern, not a privilege one; scanning
Markdown for such content would either miss a real attempt or flag the file
names and lint messages a legitimate report legitimately contains. This was a
deliberate choice, not an oversight. See also
[What a posted comment does not prove](#what-a-posted-comment-does-not-prove)
below.

**The optional `resolved.md`.** A producer with nothing to report can still have
something to withdraw: a pipeline that was behind and is now current has no
lint-style report to post, but an earlier "you are behind" comment from a
previous push is now wrong. `resolved.md`, read and sanitised exactly like
`comment.md`, exists for that. It is used only when `comment.md` is itself
absent or blank, and only ever to **update** an existing comment under this
header to `resolved.md`'s own text; it never creates one. With no earlier
comment to update, it is a no-op, the same as an absent `comment.md` on its own.
A producer that never writes `resolved.md` — `linting.yml` always writes a body,
so it never needs to — behaves exactly as if this file did not exist.

**Order of checks.** The header and pull request number are validated as soon as
the artifact is read, whether or not there is a comment to post; the
commit/pull-request lookup above, which needs an API call, only runs once
`comment.md` is confirmed present, since nothing is posted otherwise.

### Token

`github-token` must be the ephemeral, per-job `GITHUB_TOKEN`, with
`pull-requests: write`. This is required, not merely sufficient. `comment.md`'s
content is attacker-controlled (see above), and a workflow event `GITHUB_TOKEN`
authors never triggers another workflow. A long-lived token (a personal access
token, commonly substituted so a bot comment triggers other workflows, for
example a lint-fix bot watching for a particular phrase) does not have that
protection: a lint report containing the trigger phrase would then fire that
workflow, with the commenter read as an account that has write access. Passing
anything other than `GITHUB_TOKEN` here reopens that chain.

`post-comment` does not hardcode the login it searches for. It calls `GET /user`
with the supplied token and uses the login that returns. A personal access token
answers that call directly. `GITHUB_TOKEN`, like every GitHub App installation
token, does not: `GET /user` needs a user-to-server token and returns 403 for
one. That 403 is itself the reliable signal, not a failure to work around:
GitHub Actions' own token always posts comments under the fixed
`github-actions[bot]` login, so `post-comment` falls back to that literal string
only in the one case it is guaranteed correct for.

### Implementation note: `@actions/github`

`post-comment` calls the GitHub API through `@actions/github` (Octokit) rather
than hand-rolled `fetch` calls. It is a first-party package in the same
`@actions/*` trust tier as `@actions/core`, `@actions/exec` and `@actions/io`,
already dependencies of this repo, and it handles response pagination
(`octokit.paginate`, used for both the commit/pull-request lookup and the
existing-comment search) and GitHub's own error format, which a hand-rolled
version would otherwise have to reimplement for this security-sensitive path.

### What a posted comment does not prove

A bot comment is not evidence that a check passed. A contributor controls both
sides of their own pull request: the copy of the producer workflow's stub that
runs, and the artifact content it uploads. Nothing stops a pull request from
carrying a stub that fabricates a `comment.md` reporting success regardless of
what actually ran, and that fabricated report then appears under the bot's own
identity, on that same pull request. Two things limit this. It cannot be
redirected to a different pull request: the pull-request-number check above
verifies that independently of the artifact's own claim. And it cannot affect a
required check: branch protection reads real job results from the aggregate job,
never the comment's text. Read a bot comment as a convenience summary, not as
proof.

## The `pr-comment.yml` workflow

[`pr-comment.yml`](.github/workflows/pr-comment.yml) replaces a pipeline's own
vendored comment-posting workflow (`dawidd6/action-download-artifact` plus
`marocchino/sticky-pull-request-comment`). It downloads the `pr-comment`
artifact from the exact run that triggered it and hands the result to
[the `post-comment` action](#the-post-comment-action).

```yaml
# .github/workflows/pr-comment.yml in a pipeline repo
name: pr-comment

on:
  workflow_run:
    workflows:
      - nf-core linting
      - nf-test
      - nf-core template version comment
    types: [completed]

permissions: {}

jobs:
  post-comment:
    permissions:
      actions: read
      pull-requests: write
    uses: nf-core/actions/.github/workflows/pr-comment.yml@v1
```

`workflows:` names the pipeline's own producer workflows by their `name:` field
(`nf-core linting`, `nf-test`, `nf-core template version comment`; see their own
stubs above and below), not this repo's reusable workflow file names. Add to
that list as the pipeline adopts more producers of the `pr-comment` artifact
contract; a name that does not match a real workflow, for example a typo, simply
never fires, silently, so double-check it against the producer's own `name:`
line. `types: [completed]` is required: `workflow_run` defaults to firing on
`requested`, `in_progress`, **and** `completed`, and only a `completed` run has
an artifact to download.

The vendored workflow this replaces watched four producers. This stub lists
three; the fourth, `branch.yml` (stage 9), does not exist here yet and adds its
own name to this list once built. Add each one, in the pull request that adds
the producer itself, as described above.

The calling job grants `actions: read` and `pull-requests: write`, the same two
permissions [`pr-comment.yml`](.github/workflows/pr-comment.yml)'s own job
requests; see [Security model](#security-model) below for why each is needed.
Neither `contents` nor `issues` is required: this workflow never checks out
anything, and GitHub's `pull-requests` scope already covers writing a comment on
a pull request through the Issues API.

### Security model

This workflow runs on `workflow_run`, always in the base repository, with a
write token, once the producing workflow has already finished. Everything the
artifact contains came from a job that may have run pull request code. The job
here never checks out or executes any of it: it downloads a plain-text artifact
from the exact triggering run (`run-id: github.event.workflow_run.id`, never a
bare artifact name, which could otherwise resolve to a different run) and passes
it to `post-comment`, which validates the pull request number, the header, and
the body's size before using any of them (see
[above](#what-it-validates-and-why)). `actions: read` is scoped to checking for
and downloading that one artifact; `pull-requests: write` is scoped to verifying
and posting the comment. Every step in the job's step list is `gh` (GitHub's own
CLI, preinstalled on every GitHub-hosted runner), a first-party GitHub action
(`actions/download-artifact`), or this repo's own action: no third-party action
ever runs in this job, in line with this repo's rule that a privileged job runs
no third-party action.

### `workflow_run` only runs from the default branch

GitHub decides whether, and how, a `workflow_run`-triggered workflow runs using
the copy of that workflow file on the repository's **default branch**, not the
copy in whatever pull request or branch is being tested. Two consequences for a
pipeline adopting this stub:

- **A pull request that adds or edits this stub does nothing by itself.**
  Nothing runs from it until it is merged to the default branch; you cannot see
  it fire by opening a pull request against itself. Merge it, then test against
  a following pull request.
- **A change to `workflows:` (for example adding a newly adopted producer) only
  takes effect once merged**, the same way. Between merging a producer
  workflow's own name change and merging the matching update here, a run can
  silently stop matching; keep both changes in the same pull request where
  possible.

### Missing `if-no-files-found` for a cross-run download

`actions/download-artifact` has no input to make a cross-run download of a
missing artifact succeed quietly; a run that has none throws instead. Rather
than downloading first and using `continue-on-error` to paper over any failure,
this workflow asks the API whether the artifact exists first
(`gh api .../actions/runs/<id>/artifacts`), and only runs the download step when
it does. A legitimately absent artifact skips the download step entirely and
reaches `post-comment` as an empty directory, treated the same as a directory
that was never created: nothing to post. A real download error (a rate limit, an
artifact that expired between the check and the download) now fails the job
instead of looking identical to "no artifact" and silently never reaching the
pull request.

### Runs for the same pull request are serialised

Two pushes to the same pull request in quick succession can finish their
producer runs close enough together that two `workflow_run` jobs each see no
existing comment yet and each create one; a later run then only ever finds and
updates the first, leaving the second stale forever. This workflow sets a
`concurrency` group (`pr-comment`, with `cancel-in-progress: false`) at its own
top level, so GitHub queues a second call behind a first one still running
instead of letting them race. It is one group for every pull request, not one
per pull request: `github.event.workflow_run` cannot name the pull request
reliably without an API call (see [above](#what-it-validates-and-why)), and a
concurrency group name is evaluated before any step runs, so it cannot make one
either. Queuing unrelated pull requests behind each other is a small cost for a
short, five-minute job; `cancel-in-progress: false` matters more here than the
group's breadth, since cancelling a run drops a report instead of posting it.

### Migrating from the vendored workflow

- **Two third-party actions in a privileged job are gone.**
  `dawidd6/action-download-artifact` and
  `marocchino/sticky-pull-request-comment` both ran with a
  `pull-requests: write` token; this workflow replaces them with a first-party
  download action and this repo's own reviewed code. See
  [Security model](#security-model) above.
- **The pull request number is now verified**, not just checked for being
  numeric. A legitimate producer is unaffected; anything that relied on posting
  to a number the triggering commit was not actually associated with now fails
  instead.
- **The comment marker changed.** The vendored workflow's sticky-comment marker
  is not the same text as `post-comment`'s own
  (`<!-- nf-core-actions:pr-comment:<header> -->`). The first run after
  migrating posts a new comment instead of updating the old one; every run after
  that updates correctly, from the new marker. The old comment is left behind,
  unmanaged.
- **The producer-side artifact contract is unchanged.** `pr_number.txt`,
  `header.txt` and `comment.md` are the same three files the vendored
  `linting.yml` already built (see [above](#the-pr-comment-artifact)); no
  producer needs to change.
- **`types: [completed]` is new.** The vendored workflow's `on: workflow_run:`
  block had no `types:` filter, so it ran on `requested` and `in_progress` too,
  doing nothing on either (no artifact exists yet). Add `types: [completed]` in
  the stub, as shown above.
- **An oversized report now gets truncated and posted, instead of failing.** See
  [The body](#what-it-validates-and-why) above.

## The `template-version` action

The [`template-version`](actions/template-version) action compares the
pipeline's configured nf-core/tools version against the latest nf-core/tools
release, and writes a `pr-comment` artifact: a comment when the pipeline is
behind, or a short resolved note when a pipeline that was behind has caught up.
It never posts anything itself.

```yaml
- name: Compare template version
  uses: nf-core/actions/actions/template-version@v1
  with:
    nf-core-version: ${{ steps.read-config.outputs.nf-core-version }}
    pr-number: ${{ github.event.pull_request.number }}
    github-token: ${{ github.token }}
```

| Input             | Required | Purpose                                                                                                                                              |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nf-core-version` | No       | The pipeline's configured nf-core/tools version. Pass [`read-config`](#the-ci-config-block)'s own `nf-core-version` output; do not re-read the file. |
| `pr-number`       | Yes      | Pull request number, recorded in `pr_number.txt`.                                                                                                    |
| `github-token`    | Yes      | Used to read nf-core/tools' latest release. See [The `github-token` input](#the-github-token-input) below.                                           |
| `artifact-path`   | No       | Directory to write the artifact files into. Defaults to `pr-comment`, matching the workflow's own upload step.                                       |

### Version comparison

The comparison uses [`semver`](https://www.npmjs.com/package/semver), the
dependency npm itself uses to parse versions, rather than a hand-rolled
comparison. A plain string or numeric-split comparison gets `2.10` sorting
before `2.9` wrong (`'1' < '9'` as characters); `semver`'s parsed
major/minor/patch numbers do not. `semver`'s `coerce()` also accepts shapes a
strict parser would reject: a two-component version such as `2.10`, and a
development suffix with no separating hyphen such as `3.27.0dev` (not valid
strict semver, which needs `3.27.0-dev`). `coerce()` extracts the leading
`major.minor.patch` and drops everything else, so `3.27.0dev` compares equal to
`3.27.0`, not less than it: treating the suffix as a real pre-release tag would
count every in-progress dev sync as behind its own eventual release, which is
noise for a check meant to flag a stale template, not an unreleased one.

An empty or otherwise unparseable `nf-core-version` compares as `unknown`, not
as `behind`: there is nothing to compare, so no comment is written, and the
Actions log carries a warning naming why. The latest release's own tag is
assumed already version-shaped, since it comes from a real GitHub release, not
from pull-request-controlled text; a malformed tag there fails the action
outright instead of silently comparing against nothing.

### The `github-token` input

`github-token` only needs to be a valid token, not one holding any particular
scope: nf-core/tools is a public repository, so reading its release list needs
no permission at all. Passing the ephemeral, per-job `GITHUB_TOKEN` raises the
request above the unauthenticated rate limit; this action never uses it for
anything else, and never needs a secret.

### The `pr-comment` artifact

| File            | Contents                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pr_number.txt` | The pull request number, as plain text.                                                                                                                                                                                                                                        |
| `header.txt`    | `template-version`. Distinct from `linting.yml`'s `lint` header, so the two comments never collide.                                                                                                                                                                            |
| `comment.md`    | Present only when the pipeline is behind the latest release. **Absent** means "up to date", not "unknown" or an error.                                                                                                                                                         |
| `resolved.md`   | Present only when the pipeline is up to date. States that it now matches the latest release; see [The `post-comment` action](#the-post-comment-action). Lets `post-comment` update away an earlier "behind" comment, instead of leaving it standing once the version is fixed. |

## The `template-version-comment.yml` workflow

[`template-version-comment.yml`](.github/workflows/template-version-comment.yml)
replaces a vendored workflow that read the pipeline's template version and
reported it on the pull request. An earlier version of that vendored workflow
was a private security advisory: it ran on `pull_request_target`, read a version
the pull request itself controlled, and posted a comment with a bot token in the
same job — a pull request could set `nf_core_version` to arbitrary text that
then reached a privileged step. The vendored workflow this replaces already
carries the fix, splitting the check from the posting; this stage centralises
that fixed shape and rewrites the check itself in TypeScript.

**This workflow is only the unprivileged half.** It triggers on `pull_request`,
not `pull_request_target`; its one job holds `contents: read` and no secret; and
no job in it holds any write permission at all. It produces a `pr-comment`
artifact and nothing else — it never posts a comment, and never holds a
credential that could. [`pr-comment.yml`](#the-pr-commentyml-workflow) posts it
separately, from a completely different, privileged job that never runs pull
request code.

```yaml
# .github/workflows/template-version-comment.yml in a pipeline repo
name: nf-core template version comment

on:
  pull_request:

permissions: {}

jobs:
  run:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/template-version-comment.yml@v1
```

`run:` grants `contents: read`, the only permission the workflow's one job
requests, needed to check out `.nf-core.yml`. No secret is passed: the ephemeral
`GITHUB_TOKEN` used inside is forwarded automatically as `github.token`, not
through a `secrets:` block.

**Add this workflow's stub `name:` to the pipeline's `pr-comment.yml`
`workflows:` list.** Without that, this workflow still runs and still produces
the artifact, but nothing ever posts it: see
[The `pr-comment.yml` workflow](#the-pr-commentyml-workflow).

### `.nf-core.yml` keys

One key, already read for other reusable workflows here: the pipeline's own
`nf_core_version`, resolved by [`read-config`](#the-ci-config-block) as its
`nf-core-version` output and passed straight through to the `template-version`
action. Nothing new was added to `.nf-core.yml` for this workflow.

### Migrating from the vendored workflow

- **The comparison is now version-aware, not a plain string match.** The
  vendored workflow's `[ "$PR_VERSION" != "$latest_version" ]` flags any
  mismatch, including one where the pipeline is technically ahead; this workflow
  only flags the pipeline being genuinely behind. See
  [Version comparison](#version-comparison) above.
- **`nichmor/minimal-read-yaml` and installing `nf-core` via `pip` are both
  gone.** `nf_core_version` now comes from `read-config`, the same action every
  other reusable workflow here uses, and the latest release comes from the
  GitHub API directly, not from installing the package to ask it its own
  version.
- **The artifact contract is unchanged.** `pr_number.txt`, `header.txt`
  (`template-version`) and an optional `comment.md` are the same three files the
  vendored workflow already built; `pr-comment.yml`'s poster reads them
  unchanged.
- **Nothing here posts a comment any more.** The vendored workflow already only
  produced an artifact too (it never ran `pull_request_target` or held a token
  itself); this is a straight rewrite of that same shape, not a new security
  split. A pipeline stub still pointing at an older, combined,
  `pull_request_target` version of this check should migrate to the stub above
  and drop any `secrets:` it passes: this workflow needs none.

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
