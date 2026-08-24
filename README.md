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
  awsfulltest_required_approvals: 2
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
      - nf-core branch protection
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

The vendored workflow this replaces watched four producers. This stub now lists
all four: [`branch.yml`](#the-branchyml-workflow) is the last one, added by this
same stage. Add a future producer's name to this list too, in the pull request
that adds the producer itself, as described above.

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

## The `branch` action

The [`branch`](actions/branch) action decides whether a pull request's source
branch is one this pipeline's release branch (`main`/`master`) accepts, and
writes a `pr-comment` artifact: a comment only when it is not. It fails itself
when the source is not allowed — that failure, not the artifact, is what branch
protection reads — and never posts a comment.

```yaml
- name: Check the pull request's source branch
  uses: nf-core/actions/actions/branch@v1
  with:
    event-name: ${{ github.event_name }}
    head-repo: ${{ github.event.pull_request.head.repo.full_name }}
    head-ref: ${{ github.event.pull_request.head.ref }}
    base-ref: ${{ github.event.pull_request.base.ref }}
    repository: ${{ github.repository }}
    pr-user: ${{ github.event.pull_request.user.login }}
    pr-number: ${{ github.event.pull_request.number }}
```

| Input           | Required | Purpose                                                                                                                     |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `event-name`    | Yes      | Event that triggered the run. Must be `pull_request`; see below.                                                            |
| `head-repo`     | Yes      | Pull request head repository, full name (`owner/repo`).                                                                     |
| `head-ref`      | Yes      | Pull request head branch.                                                                                                   |
| `base-ref`      | Yes      | Pull request base branch. Checked against the release branches, and recorded in the comment when the source is not allowed. |
| `repository`    | Yes      | This pipeline's own canonical repository, full name (`owner/repo`).                                                         |
| `pr-user`       | Yes      | Pull request author's login. Recorded in the comment when the source is not allowed.                                        |
| `pr-number`     | Yes      | Pull request number to record in `pr_number.txt`.                                                                           |
| `artifact-path` | No       | Directory to write the `pr-comment` artifact files into. Defaults to `pr-comment`.                                          |

### Allowed sources are an nf-core convention, not a pipeline setting

Every nf-core pipeline's release branch accepts exactly two sources: its own
`dev` branch, or its own `patch` branch, pushed for a hotfix based on the last
release. Both names, and the rule itself, are the same across every nf-core
pipeline; nothing here is pipeline-specific, so `decide.ts` hardcodes them
instead of reading a `.nf-core.yml` setting. A pipeline that genuinely needs a
different rule does not call this workflow.

`isAllowedSource()` also requires `head-repo` to equal `repository` for a
`patch` branch, not only for `dev`. **This is a deliberate change, not a bug
fix.** The vendored check allowed `patch` from any repository on purpose: its
own comment reads "the nf-core repo `dev` or any `patch` branches", so
`[[ "$GITHUB_HEAD_REF" == "patch" ]]` standing alone was intended, and a fork
branch named `patch` passed by design.

nf-core chose to drop that allowance. A hotfix straight to a release branch is
rare, and it belongs in the pipeline's own repository: rnaseq's `patch` merges
have always come from `nf-core/rnaseq:patch`, never a fork. The cost is that a
contributor without write access can no longer open a hotfix pull request
directly against a release branch from their fork. They target `dev` instead,
and the rejection comment tells them so.

Do not widen this back on the assumption that a repository check is missing from
`patch`. It was removed knowingly.

### `base-ref` must be a release branch, or the check does not apply

`isReleaseBranch()` checks `base-ref` against `main`/`master` before
`isAllowedSource()` runs at all. When it is not one of them, the source-branch
rule has nothing to say — a pull request against `dev` is never subject to it —
so the action passes and logs why, without evaluating the source at all. This
guards a pipeline stub that omits its own `branches: [main, master]` filter (see
the `branch.yml` example below): without this check, every fork pull request
into `dev` would fail, telling the contributor to retarget to `dev`, which is
where they already are.

### The action fails on an unexpected event, instead of the job skipping

`branch.yml`'s job carries no `if: github.event_name == 'pull_request'` guard
(see below): this is a required status check, and GitHub counts a skipped
required check as passed, so a guard that skips would silently remove branch
protection instead of enforcing it. Passing `event-name` in and checking it here
means an unexpected event fails loudly, naming the event received and what the
stub must trigger on, instead of disappearing.

### The `pr-comment` artifact

| File            | Contents                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pr_number.txt` | The pull request number, as plain text.                                                                                                 |
| `header.txt`    | `branch`. Distinct from `linting.yml`'s `lint` and `template-version`'s `template-version`, so none of the three comments ever collide. |
| `comment.md`    | Present only when the source branch is not allowed.                                                                                     |

No `resolved.md`: a pull request's head repository, head branch, and this
pipeline's own canonical repository are fixed for its whole life, so a blocked
decision can never later flip to allowed on the same pull request. The only way
for a pull request to become acceptable is to retarget its base branch — which
this check does not consider, and which also takes the pull request outside
`branch.yml`'s own `branches: [main, master]` filter, so this workflow stops
running for it entirely. **If a contributor follows the comment's instruction
and retargets to `dev`, this workflow no longer runs for that pull request, so
the blocked comment is left standing.** A maintainer can hide it manually. This
is a known, accepted consequence, not a gap to work around with an extra
trigger.

### The comment does not @mention the contributor the way the vendored one did

The vendored workflow's failure comment opened with `Hi @${PR_USER},`, a real
GitHub mention that notified the pull request's author. `post-comment` (see
[above](#the-post-comment-action)) turns every `@mention` in a producer's
`comment.md` into inline code, for every producer, so nobody it posts for can
ping an arbitrary account through a report it did not write itself. This
comment's `@${prUser}` is no exception: it still names the author, but renders
as text, not a notification. This is a real behaviour change from the vendored
workflow, and a deliberate consequence of `post-comment`'s own design (stage 7),
not something this action works around.

## The `branch.yml` workflow

[`branch.yml`](.github/workflows/branch.yml) replaces a vendored workflow that
checked a pull request's source branch with a shell one-liner, and built its own
three-file `pr-comment` artifact by hand for a separate poster to publish.

```yaml
# .github/workflows/branch.yml in a pipeline repo
name: nf-core branch protection

on:
  pull_request:
    branches: [main, master]

permissions: {}

jobs:
  run:
    permissions: {}
    uses: nf-core/actions/.github/workflows/branch.yml@v1
```

`run:` grants nothing: the one job inside `branch.yml` never checks out anything
and holds `permissions: {}` itself, so there is nothing for the stub to grant
back. No job needs a secret either, so the stub passes none.

**Add this workflow's stub `name:` to the pipeline's `pr-comment.yml`
`workflows:` list.** Without that, this workflow still runs and still produces
the artifact, but nothing ever posts it: see
[The `pr-comment.yml` workflow](#the-pr-commentyml-workflow), whose own example
stub above already includes `nf-core branch protection`.

### `.nf-core.yml` keys

None. See
[Allowed sources are an nf-core convention, not a pipeline setting](#allowed-sources-are-an-nf-core-convention-not-a-pipeline-setting)
above for why.

### Migrating from the vendored workflow

- **Check name**: keep the stub's `name:` as `nf-core branch protection`. The
  job inside it is now called `branch`, not `test`, so the full check name
  changes from `nf-core branch protection / test` to
  `nf-core branch protection / branch`. Update branch protection to the new
  name.
- **The `github.repository == '<pipeline name>'` outer gate is gone.** The
  vendored workflow needed it so a fork that copied the file verbatim, without
  re-templating the pipeline's own name into it, would skip the check instead of
  enforcing it incorrectly against itself. This workflow computes its own
  canonical repository from `github.repository` at run time instead of from a
  baked-in name, so that drift is no longer possible, and the gate has nothing
  left to guard against.
- **The failure comment no longer @mentions the contributor.** See
  [above](#the-comment-does-not-mention-the-contributor-the-way-the-vendored-one-did).
- **A branch named `patch` in an unrelated fork no longer passes.** See
  [above](#allowed-sources-are-an-nf-core-convention-not-a-pipeline-setting).
- **Posting the comment moves to `pr-comment.yml`.** The vendored workflow
  already only built an artifact for a separate poster to read (it never held a
  comment-posting token itself); add this workflow's stub name to that poster's
  `workflows:` list, as shown above.
- **The stub must trigger `on: pull_request`.** This is a required status check,
  and GitHub counts a skipped required check as passed, so the job runs
  unconditionally and the action fails loudly, naming the event, when the
  trigger is anything else. See
  [above](#the-action-fails-on-an-unexpected-event-instead-of-the-job-skipping).
  Keep the stub's own `branches: [main, master]` filter too: it is what keeps
  this workflow from running at all once a pull request is retargeted away from
  a release branch (see
  [above](#base-ref-must-be-a-release-branch-or-the-check-does-not-apply)).

## The `clean-up.yml` workflow

[`clean-up.yml`](.github/workflows/clean-up.yml) replaces a vendored workflow
that ran `actions/stale` directly on a weekly schedule: it labels, and for an
issue also closes, anything an nf-core contributor tagged `awaiting-changes` or
`awaiting-feedback` that nobody followed up on.

```yaml
# .github/workflows/clean-up.yml in a pipeline repo
name: nf-core clean-up

on:
  schedule:
    - cron: '0 0 * * 0' # Once a week

permissions: {}

jobs:
  run:
    permissions:
      issues: write
      pull-requests: write
    uses: nf-core/actions/.github/workflows/clean-up.yml@v1
```

The `schedule` trigger stays in the pipeline's own stub: `workflow_call`, the
only trigger `clean-up.yml` itself declares, has no schedule of its own to
inherit. `run:` grants `issues: write` and `pull-requests: write`, the same two
permissions the one job inside `clean-up.yml` requests, to label, comment on,
and close stale items.

### Guarding a forked schedule

A scheduled trigger runs from whichever repository holds the copy of the
workflow file that declares it — here, the pipeline's own stub — so a fork that
keeps this stub inherits the schedule too, and would otherwise label and close
the fork's own issues and pull requests on the same cadence as the pipeline it
was forked from. The intent is exactly that: skip a fork. A first step checks
`github.event.repository.fork` directly and, when true, logs why and lets the
job end there; the `actions/stale` step itself runs only
`if: '!github.event.repository.fork'`.

An earlier version of this guard checked `github.repository_owner == 'nf-core'`
instead, on the reasoning that every nf-core pipeline shares that one owner.
That check has two problems `repository.fork` does not: it does not exempt a
fork that happens to live under the `nf-core` organisation itself, and it skips
outright — with nothing in the log explaining why — for any other organisation
that uses the nf-core pipeline template, rather than the fork it was actually
meant to guard against.

### No third-party action in a privileged job — and no exception needed

This repo's own rule (see CONTRIBUTING.md) is that a privileged job — one
holding a secret or a push credential, here `issues: write` and
`pull-requests: write` — runs no third-party action. `clean-up.yml`'s one job is
privileged by that definition, and its one step runs `actions/stale`. This still
honours the rule rather than needing an exception from it: `actions/stale` is
published by GitHub's own `actions` organisation, the same publisher as
`actions/checkout` and `actions/upload-artifact`, both of which this repo
already runs inside a privileged job elsewhere (`fix-linting.yml`'s `push-fix`
job, which holds `issues: write` and a push credential). The rule exists to keep
an unreviewed third party's code out of a job that holds something worth
stealing; `actions/stale`, pinned to a commit SHA the same way every other
external action here is, sits in the same trust tier this repo already relies
on, not a lower one.

### `.nf-core.yml` keys

None. The day counts, labels and messages below are the vendored workflow's own
exact values, unchanged: no pipeline has ever set them to anything else, and
this is a plain pass-through to `actions/stale` with no decision of its own to
put in TypeScript. Add a `ci:` setting for one, the same way `nextflow_lint` or
`profiles` were added, only once a pipeline genuinely needs a different value.

| Setting                | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| `days-before-stale`    | `30`                                                              |
| `days-before-close`    | `20`                                                              |
| `days-before-pr-close` | `-1` (a pull request is labelled, never closed, by this workflow) |
| `any-of-labels`        | `awaiting-changes,awaiting-feedback`                              |
| `exempt-issue-labels`  | `WIP`                                                             |
| `exempt-pr-labels`     | `WIP`                                                             |

### Migrating from the vendored workflow

- **Check name**: `clean-up.yml` is not a required status check (it never runs
  on a pull request), so branch protection is unaffected.
- **The stale-action pin moves from v10 to v11.** rnaseq's own copy of the
  vendored workflow was still pinned to
  `actions/stale@b5d41d4e1d5dceea10e7104786b73624c18a190f # v10`; the current
  pipeline template had already moved to `v11`. This workflow uses the current
  template's pin.
- **The scheduled run now skips a fork.** See
  [Guarding a forked schedule](#guarding-a-forked-schedule) above; the vendored
  workflow had no such guard.

## The `verify-offline-run` action

The [`verify-offline-run`](actions/verify-offline-run) action checks that a
downloaded pipeline ran without fetching anything: it compares a container cache
directory's file listing from before and after the run.

```yaml
- name: Verify the run stayed offline
  uses: nf-core/actions/actions/verify-offline-run@v1
  with:
    before-path: ${{ runner.temp }}/containers-before.txt
    after-path: ${{ runner.temp }}/containers-after.txt
```

| Input         | Required | Purpose                                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------------------- |
| `before-path` | Yes      | Path to a file listing the cache directory's contents before the run, one filename per line. |
| `after-path`  | Yes      | Path to a file listing the cache directory's contents after the run, in the same format.     |

Any name present in `after-path` but not in `before-path` was fetched while the
pipeline ran. That means `nf-core pipelines download` did not cache everything
the pipeline needs, so the point of downloading it — running fully offline —
failed. The action fails and lists the offending image names; a shrunk cache
(nothing new, some entries gone) still passes.

An empty `after-path` listing also fails, naming the reason instead of the usual
missing-image list: no pipeline run legitimately downloads zero containers, so
an empty listing means the listing step itself did not run correctly, not that
the run stayed offline.

## The `download-pipeline.yml` workflow

[`download-pipeline.yml`](.github/workflows/download-pipeline.yml) replaces a
vendored workflow that downloaded the pipeline with
`nf-core pipelines download`, ran the download with Nextflow, and diffed
container counts in shell to catch anything fetched at runtime instead of from
the cache. The comparison itself now lives in `verify-offline-run` (above), in
TypeScript, with its own tests; everything else is the same tool calls the
vendored workflow made.

```yaml
# .github/workflows/download-pipeline.yml in a pipeline repo
name: nf-core download

on:
  workflow_dispatch:
    inputs:
      revision:
        description: 'Pipeline revision (branch, tag, or commit) to test.'
        required: true
        default: 'dev'
  pull_request:
    branches: [main, master]

permissions: {}

jobs:
  download:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/download-pipeline.yml@v1
    with:
      revision: ${{ github.event.inputs.revision || 'dev' }}
```

`download:` grants `contents: read`, the most any job inside
`download-pipeline.yml` requests: only the `config` job checks out the pipeline,
to read `.nf-core.yml`. `download` and `confirm-pass` check out nothing —
`download` fetches the pipeline itself through `nf-core pipelines download`, and
running the pull request's own checkout there would let it override the
downloaded, trusted revision's own `nextflow.config` from the launch directory.

The workflow downloads the pipeline at `revision`, runs it (the stub profile
first, falling back to a full run when the pipeline does not support `-stub`),
and fails if that run pulled a container image the download step had not already
cached, or if the after-run container listing came back empty (see
`verify-offline-run` above) — neither is a state a legitimate run produces. It
always uploads `.nextflow.log*` as an artifact, including on failure, so a run
that failed offline still leaves a log to read.

### Inputs

| Input      | Default | Purpose                                                                                                                                                                          |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revision` | `'dev'` | Pipeline revision (branch, tag, or commit) to download and test.                                                                                                                 |
| `runner`   | `''`    | Overrides the RunsOn runner label for this call only. Forwarded to `read-config`'s own `runner` input, so it wins over `.nf-core.yml` the same way any `read-config` input does. |

### `.nf-core.yml` keys

None beyond what `read-config` already resolves for every workflow:
`nf_core_version` (the `nf-core` tool version to install) and `ci.runner` (the
runner label, the same setting `nf-test.yml` reads). Which revision to download
is a per-run choice, not a pipeline setting, so it stays a `workflow_call` input
instead of a `.nf-core.yml` key.

The `download` job guards `nf_core_version` and `template.name` (read by
`read-config` as `pipeline-name`, and used to name the download's output
directory) before either is used: an unset or malformed value fails with a clear
error naming the setting, instead of a cryptic one further down the job.

### Migrating from the vendored workflow

- **Check names change.** The vendored workflow's jobs were `configure` and
  `download`; this workflow's are `config`, `download`, and `confirm-pass`. If
  branch protection lists this workflow as a required check (most pipelines do
  not, since it is a download smoke test rather than a merge gate), point it at
  `<stub name> / confirm-pass`, the single stable name across every run — see
  [`linting.yml`'s `confirm-pass` job](#jobs) for the reasoning this repo uses
  throughout: a required check that reports `skipped` counts as satisfied.
- **The manual `testbranch` input is now `revision`, on the reusable workflow
  itself, read through `env:`.** The vendored workflow interpolated
  `github.event.inputs.testbranch` directly into two shell command lines (the
  `nextflow run` invocations). A workflow_dispatch input is set by whoever
  triggers the run — normally a maintainer, but branch protection cannot see a
  manual dispatch coming — so this workflow reads it from an environment
  variable instead, never a `${{ }}` expression inside a `run:` block,
  regardless of that lower risk.
- **The Nextflow log now uploads on failure too.** The vendored workflow's
  upload step had no `if:` condition, so it only ran when every earlier step
  succeeded — exactly when the log is least interesting. This workflow's
  equivalent step runs `if: always()`.
- **The stub-run fallback behaves as before.** The vendored workflow already
  guarded it correctly, with `continue-on-error: true` on the stub run and
  `steps.<id>.outcome == 'failure'` on the fallback. `outcome` is the result
  before `continue-on-error` applies, so that condition does fire; `conclusion`
  would not have. This workflow keeps the same pair.
- **No `jlumbroso/free-disk-space` step.** The vendored workflow ran it to work
  around a GitHub-hosted runner's small disk. This workflow instead runs on a
  `runner=`-labelled RunsOn runner with `volume=80gb`, the same as
  `nf-test.yml`'s heavy job, so there is no small disk to work around.
- **The pipeline directory name comes from `.nf-core.yml`'s `template.name`, not
  from `basename "$GITHUB_REPOSITORY"`.** Both give the same value for a
  correctly configured pipeline; this one also does not need a shell lowercasing
  trick to get it.

## The `authorize-launch` action

The [`authorize-launch`](actions/authorize-launch) action decides whether to
launch the AWS full test, and, when it does, which revision to launch. It is the
gate the security review asked for: launching spends real money on
organisation-level cloud credentials, so a pull request review alone must not be
enough to trigger it.

```yaml
- name: Decide whether to launch
  id: authorize
  uses: nf-core/actions/actions/authorize-launch@v1
  with:
    event-name: ${{ github.event_name }}
    github-token: ${{ github.token }}
    repository: ${{ github.repository }}
    sha: ${{ github.sha }}
    required-approvals: ${{ needs.config.outputs.required-approvals }}
    review-state: ${{ github.event.review.state }}
    review-user: ${{ github.event.review.user.login }}
    review-id: ${{ github.event.review.id }}
    pr-number: ${{ github.event.pull_request.number }}
    pr-author: ${{ github.event.pull_request.user.login }}
    base-ref: ${{ github.event.pull_request.base.ref }}
```

The last six inputs describe a pull request review, so they only matter, and are
only checked, for the `pull_request_review` event.

### The gate, in plain words

- On `workflow_dispatch` or a published `release`, it always launches. Both
  already need write access to trigger (dispatching a workflow, or publishing a
  release), so neither needs a second check here.
- On a pull request review, it launches only when **this exact review** is the
  one that brings the count of distinct, trusted approvals to the required
  threshold. "Trusted" means the reviewer holds `write` or `admin` permission on
  the repository, resolved through
  `GET /repos/{owner}/{repo}/collaborators/{username}/permission`, not through
  the review's own `author_association`. `author_association` describes a
  relationship (member, contributor, none) fixed at the time GitHub renders it,
  not a permission level, so a removed collaborator can still show `MEMBER` on
  an old review. Stage 5's `branch` action made the same correction for a
  different check; this stage makes it here too.
- A repeat approval by someone who already has a counted approval does not add
  to the count. An approval later dismissed, or changed to request changes,
  stops counting from the moment it changes. A pull request's own author is
  excluded from every count, and can never be the reviewer whose approval
  triggers a launch — the same rule GitHub itself already enforces on
  self-review, checked again here defensively.
- Firing on the exact review that crosses the threshold, rather than on every
  approval once the threshold is met, is what stops a third approval from
  launching a second run. `authorize-launch` looks only at reviews strictly
  before the triggering one to compute the count "before"; the triggering review
  itself is what carries it over the line, or does not.
- The base branch must be a release branch (`main`/`master`); see
  [`isReleaseBranch`](#base-ref-must-be-a-release-branch-or-the-check-does-not-apply)
  above, the same check `branch` uses, moved to `src/lib` once this became its
  second user.
- An approval given before the pull request's base branch was last retargeted
  does not count towards the current base branch's threshold; see
  [The base branch must not have changed since an earlier approval](#the-base-branch-must-not-have-changed-since-an-earlier-approval)
  below.

### Trusted revision

`authorize-launch` never resolves a pull request's own commits as the revision
to launch. For `workflow_dispatch` and `release`, the revision is the commit the
workflow itself runs on — already maintainer-controlled by the event, not
pull-request-controlled. For an approved pull request review, the revision is
always the fixed string `'dev'`: the pipeline's own development branch, whatever
it currently contains, never the reviewed pull request's branch. **The full test
launched by an approval never runs the code under review.** This matches the
hardened design this stage is built from (see below): reviewing and approving a
pull request is a statement about that pull request's diff, not a request to run
arbitrary code with organisation credentials, and the two must stay separate. A
maintainer who wants to test the pull request's own commits uses
`workflow_dispatch` after merging, or tests locally.

### Configurable approval count, with a fixed default

`required-approvals` comes from `read-config`'s own
`awsfulltest-required-approvals` output (`ci.awsfulltest_required_approvals` in
`.nf-core.yml`, default **2**), following the same
[configuration precedence](#configuration-precedence) as every other setting in
this repo. Two is deliberately not hardcoded: a pipeline with only one active
maintainer cannot reach two trusted approvals at all, and this stage must not
lock such a pipeline out of its own full test. Lowering it to `1` in
`.nf-core.yml` is a real, supported choice for that pipeline — one trusted
approval is still strictly more than the "any reviewer, no count" gap this stage
closes. Raising it is equally supported for a pipeline that wants a stricter
bar. Nothing here reads `required-approvals` as `0` or lower: `read-config`'s
own number validation rejects that before `authorize-launch` ever sees it.

### What it deliberately does not check

`authorize-launch` does not re-verify that the pull request itself still targets
a release branch independently of the payload, and does not re-fetch the pull
request to confirm `pr-number` and `pr-author` match `base-ref`: all four come
from the same `pull_request_review` event payload, which GitHub itself populates
consistently. It also does not check whether the pull request is still open, or
whether it was already merged: an approval on a merged pull request is unusual
but not dangerous, since the revision launched is always `'dev'`, never the pull
request's own commits.

## The `awstest.yml` workflow

[`awstest.yml`](.github/workflows/awstest.yml) replaces a vendored, per-pipeline
workflow that launched the pipeline's small-scale test on Seqera Platform.
Manual only: nothing here runs it automatically.

```yaml
# .github/workflows/awstest.yml in a pipeline repo
name: nf-core AWS test

on:
  workflow_dispatch:

permissions: {}

jobs:
  test:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/awstest.yml@v1
    secrets:
      TOWER_ACCESS_TOKEN: ${{ secrets.TOWER_ACCESS_TOKEN }}
```

`test:` grants `contents: read`, the most any job inside `awstest.yml` asks for
(`config`, to read `.nf-core.yml`). `TOWER_WORKSPACE_ID`, `TOWER_COMPUTE_ENV`
and `AWS_S3_BUCKET` are repository or organisation **variables**, not secrets:
GitHub makes the `vars` context available to a called reusable workflow the same
way it makes `github` available, with no `with:` or `secrets:` needed to forward
them. Only `TOWER_ACCESS_TOKEN`, a real secret, needs the explicit line above.

### Secrets

| Secret               | Required | Purpose                                                                                                 |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `TOWER_ACCESS_TOKEN` | Yes      | Seqera Platform access token. Optional on `workflow_call` (see below), but the launch fails without it. |

`TOWER_ACCESS_TOKEN` is declared `required: false` on `workflow_call`, never
`secrets: inherit`: a reusable workflow's secrets must be named individually, so
a pipeline can see exactly what it is handing over. `run-platform`'s first step
checks the secret is actually set and fails with a clear message, naming the
secret, before attempting to launch anything — the alternative, letting the
launch action fail on an empty token, would still stop the run but with a far
less obvious error.

### `.nf-core.yml` keys

One, already read for other reusable workflows here: `template.name`, resolved
by `read-config` as its `pipeline-name` output and used to build the S3 work and
output directory paths. Nothing here hardcodes a pipeline name or the `nf-core`
organisation; both the vendored workflow's templating and this workflow's
`read-config` call solve the same problem, but this one reads it from the
pipeline's own configuration instead of from text baked into the workflow file
at template-generation time. `read-config` documents `pipeline-name` as an empty
string when `template.name` is absent, true for an older pipeline; an empty
value would collapse every S3 path below to the bucket root, so `run-platform`
guards it, by name, before its first use — the same guard, in the same words, as
[`download-pipeline.yml`'s](#the-download-pipelineyml-workflow).

### Migrating from the vendored workflow

- **Check names change.** The vendored workflow had one job, `run-platform`.
  This workflow has three: `config`, `run-platform`, and `confirm-pass`. This
  workflow is not normally a required check (it is a manual, on-demand test, not
  a merge gate), but if a pipeline has added it to branch protection anyway,
  point that at `<stub name> / confirm-pass`.
- **The Seqera Platform debug log now uploads on failure too.** The vendored
  workflow's upload step had no `if:` condition, so it only ran when the launch
  step above it succeeded — exactly when the log is least interesting. This
  workflow's equivalent step runs `if: always()`.
- **The pipeline name comes from `.nf-core.yml`, not from the workflow file's
  own templated text.** Both give the same value for a correctly configured
  pipeline; this one does not go stale if the workflow file is ever copied into
  a differently-named repository without re-running the template.

## The `awsfulltest.yml` workflow

[`awsfulltest.yml`](.github/workflows/awsfulltest.yml) replaces a vendored,
per-pipeline workflow that launched the pipeline's full-scale test on Seqera
Platform on `workflow_dispatch`, a published `release`, or a submitted pull
request review. The security review that started this project flagged that last
trigger: the vendored workflow checked `github.event.review.state == 'approved'`
and nothing else about the reviewer, despite a comment in the file claiming two
approvals were required. Anyone who could review the pull request — not
necessarily anyone with commit access — could launch a run against
organisation-level cloud credentials. This workflow closes that gap with
[`authorize-launch`](#the-authorize-launch-action): see
[The gate, in plain words](#the-gate-in-plain-words) above for the exact rule,
and [Trusted revision](#trusted-revision) for why an approval never runs the
reviewed pull request's own code.

**This design follows a hardened branch of rnaseq (`gha-security`, its own
author's design for this exact gate) rather than the shipped template.** That
branch already resolves permission through the API, counts distinct trusted
approvals against the review that crosses the threshold, and always launches
`'dev'`, never the pull request's own commits. This workflow follows all three
decisions. It diverges in two places: the required count is configurable here
(see
[Configurable approval count](#configurable-approval-count-with-a-fixed-default)
above) rather than fixed at 2, and the decision logic lives in a tested
TypeScript action rather than an inline `actions/github-script` block, per this
repo's own [conventions](CONTRIBUTING.md) for where decisions belong.

```yaml
# .github/workflows/awsfulltest.yml in a pipeline repo
name: nf-core AWS full size tests

on:
  workflow_dispatch:
  pull_request_review:
    types: [submitted]
  release:
    types: [published]

permissions: {}

jobs:
  test:
    permissions:
      contents: read
      pull-requests: read
      issues: read
    uses: nf-core/actions/.github/workflows/awsfulltest.yml@v1
    with:
      parameters: '{"aligner":"star_salmon"}'
      slack-channel: '#pipeline-ci'
    secrets:
      TOWER_ACCESS_TOKEN: ${{ secrets.TOWER_ACCESS_TOKEN }}
      SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
```

`test:` grants `contents: read`, `pull-requests: read` and `issues: read`, the
most any job inside `awsfulltest.yml` asks for (`config` reads `.nf-core.yml`;
`authorize` reads collaborator permission, pull request reviews, and the pull
request's timeline). As with `awstest.yml`, `TOWER_WORKSPACE_ID`,
`TOWER_COMPUTE_ENV` and `AWS_S3_BUCKET` come from the `vars` context
automatically; only the two secrets need declaring, and only when a pipeline
actually uses Slack notification.

### Inputs and secrets

| Input             | Required | Purpose                                                                                                                                                                                   |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parameters`      | No       | Extra Nextflow parameters for the full test, as a JSON object string, for example `'{"aligner":"star_salmon"}'`. Merged with the `outdir` this workflow computes. Defaults to `'{}'`.     |
| `nextflow-config` | No       | Extra Nextflow config for the full test, for example a completion notification block that names no secret. Defaults to `''`.                                                              |
| `slack-channel`   | No       | Slack channel to notify on completion, for example `'#pipeline-ci'`. See [Do not route a secret through a string input](#do-not-route-a-secret-through-a-string-input). Defaults to `''`. |

| Secret               | Required | Purpose                                                                                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOWER_ACCESS_TOKEN` | Yes      | Seqera Platform access token. Optional on `workflow_call`, but the launch fails without it, with a clear message, the same as `awstest.yml`. |
| `SLACK_BOT_TOKEN`    | No       | Slack bot token for the completion notification. Omit both this and `slack-channel` to skip notification.                                    |

### Where the full test's parameters live, and why

`parameters` and `nextflow-config` are `workflow_call` inputs on the stub, not
`.nf-core.yml` keys. Every other setting in this repo lives centrally, per
PLAN.md's principle 1: a value here needs one tag move, a value in 141 pipeline
repos needs a 141-repo campaign. The full test's own Nextflow parameters do not
fit that principle, because they are not a shared CI setting — they are the
pipeline's own science. rnaseq's full test runs a `aligner` matrix
(`star_salmon`, `star_rsem`); sarek's would need a genome reference; a third
pipeline's would need neither. Centralising these would mean this repo carries a
per-pipeline branch for every pipeline's own parameters, growing without bound
and needing this repo's own maintainers to understand every pipeline's science
to add one. Keeping them on the stub, in the pipeline's own repo, under that
pipeline's own review, is the smaller diff and the correct owner. A pipeline
that needs more than one parameter set, the way rnaseq's `aligner` matrix does
today, calls this workflow more than once, from separate jobs with separate
`parameters` inputs — the same pattern `nf-test.yml`'s own `variant` input
already establishes for a pipeline that needs to call it more than once.

`parameters` is read from the stub file as committed on the pipeline's default
branch, the same as every other `workflow_call` input: GitHub always evaluates a
caller's own workflow file from the ref appropriate to the triggering event, not
from pull request content, for every event this workflow supports. A pull
request cannot change what `parameters` resolves to by editing the stub in its
own branch.

`run-platform` merges `parameters` with a centrally-computed `outdir` (so the
stub does not have to know the S3 bucket, the pipeline name, or the resolved
revision) before passing the result to the launch action. A top-level `outdir`
key in the stub's own `parameters` is overridden by the computed one.

### `.nf-core.yml` keys

`template.name` (as `pipeline-name`, the same as `awstest.yml`) and
`ci.awsfulltest_required_approvals` (as `required-approvals`, default `2`; see
[Configurable approval count](#configurable-approval-count-with-a-fixed-default)
above). `run-platform` guards `pipeline-name` before its first use, the same as
`awstest.yml`'s own guard above.

### Reading the approval threshold from a ref the pull request cannot change

`ci.awsfulltest_required_approvals` gates whether a launch happens at all, so
`config` must not read it from anything the pull request under review controls.
On every other reusable workflow in this repository, `config`'s checkout has no
`ref:` and that is fine, because what it reads only configures a test the pull
request is meant to influence (which Nextflow versions to run, how many shards,
whether an opt-in lint check runs). Here it is different: the value decides
whether a review authorises spending organisation cloud credentials.

`actions/checkout` with no `ref:` on a `pull_request_review` run checks out the
pull request's own merge commit. Reading `.nf-core.yml` from that commit would
let the diff under review set `ci.awsfulltest_required_approvals: 1` in its own
change and be approved once, reproducing the "any single approval launches" gap
this stage exists to close. `config` instead checks out
`github.event.pull_request.base.sha`: a commit on the release branch, already
there before this pull request existed, never something this pull request's own
diff can set. For `workflow_dispatch` and `release`, there is no `pull_request`
context at all, so the expression is empty and checkout falls back to its own
default — the ref the event already runs on, already maintainer-controlled
either way.

Every other `config` job in this repository was checked for the same pattern
while fixing this one. None of the others feed a decision like this one:

- `nf-test.yml`, `linting.yml`, and `download-pipeline.yml`'s `config` jobs read
  test settings (Nextflow versions, shard limits, the opt-in `nextflow-lint`
  flag, the runner label, the nf-core version to install) — values a pull
  request is meant to influence for its own run, not something that gates spend
  or bypasses a security check. A pull request that sets its own `nextflow-lint`
  flag, for example, can only add a check against itself, never remove one or
  spend anything.
- `template-version-comment.yml`'s single job reads `nf-core-version` only to
  compare it in a report; it holds no secret and only ever writes a comment
  artifact.
- `fix-linting.yml`'s `prepare-fix` job checks out with no `ref:` too, but its
  trigger is `issue_comment`, whose default ref is always the repository's
  default branch — an `issue_comment` event has no pull-request merge ref to
  check out in the first place, so this is safe by construction, not by
  accident.
- `branch.yml` and `clean-up.yml` have no `config` job and no checkout at all.

### Do not route a secret through a string input

An earlier version of this note told a pipeline to move its template's
`nextflow_config` block, Slack notification included, into the stub's own
`nextflow-config` input. That block carries a Slack bot token, and
`nextflow-config` is a plain string `workflow_call` input, not a secret: a token
passed that way arrives in `run-platform` without ever having been declared a
secret to that job, so GitHub registers no mask for its value, and it then
reaches `seqeralabs/action-tower-launch`, a third-party action whose debug log
this workflow uploads as an artifact on every run, success or failure. That is
an unmasked credential inside a downloadable artifact.

The token is now a named, optional `workflow_call` secret, `SLACK_BOT_TOKEN`,
paired with a plain `slack-channel` input for the (non-secret) channel name.
`run-platform`'s "Build the Slack notification config block" step reads the
secret only through `env:`, builds the notification block itself, and appends it
to the pipeline's own `nextflow-config`, writing the result to `$GITHUB_OUTPUT`
rather than echoing it. The token is registered as a secret for that job the
moment it is referenced, so GitHub masks it in the log regardless; it never
crosses a job boundary as a plain string, and the stub never has to build the
notification block by hand.

Every other input and secret documented for `awsfulltest.yml` and `awstest.yml`
was checked for the same fault: `parameters` is Nextflow parameters, not a
credential; `TOWER_ACCESS_TOKEN` was already a declared `secrets:` input, never
a `with:` one. `SLACK_BOT_TOKEN` above was the only one that had been documented
the wrong way.

### The base branch must not have changed since an earlier approval

Reviews are listed for the whole pull request, with no regard for what base
branch the pull request targeted when each one was submitted. Without a check, a
pull request could collect approvals while targeting `dev` — where a reviewer
has no reason to treat an approval as authorising spend — and then have its base
retargeted to a release branch, where one further approval crosses the threshold
using approvals nobody gave with that in mind.

`authorize-launch` reads the pull request's timeline for a `base_ref_changed`
event. When one exists, every review submitted at or before the most recent one
is dropped before counting: a retarget requires every needed approval to be
given again, against the base branch actually being gated, rather than carrying
old approvals across the change. A pull request whose base branch never changed
is unaffected; every one of its reviews still counts.

### One launch per crossing

Nothing before this stage recorded that a crossing already launched, and there
was no `concurrency` group, so re-running the workflow on the same review event
could launch a second time. This workflow now sets a `concurrency` group keyed
on the pull request (`awsfulltest-<repository>-<pr number>`), with
`cancel-in-progress: false` — the same pattern `pr-comment.yml` and
`release.yml` already use, and for the same reason: cancelling a run here would
abandon a launch already in flight, not prevent one, so the second run must
wait, not pre-empt the first.

This closes the real race: two reviews submitted close enough together that both
runs' `authorize` jobs read the review list before either one committed the
other's, and both independently concluded "this is the crossing review". Queuing
the second run behind the first means it reads the review list only after the
first has finished, so it correctly sees the threshold already met.

It does not add a persisted record of which review already triggered a launch,
and does not need one: reaching this gate at all needs a trusted approval, and
re-running a finished workflow run through GitHub's own UI needs write access to
the repository — the same tier `workflow_dispatch` already needs. Per
[What the gate does, and does not, guarantee](#what-the-gate-does-and-does-not-guarantee)
below, anyone who can re-run a finished run already has a standing route to the
same spend; the concurrency group closes the race between independent runs,
which is the part a write-access holder could not already do some other way.

### What the gate does, and does not, guarantee

- A fork pull request cannot trigger a launch. GitHub withholds secrets from a
  fork pull request's run, so `TOWER_ACCESS_TOKEN` is never present and the
  launch fails before it starts, independently of anything `authorize-launch`
  decides.
- For a release pull request, the gate raises the bar from one approval — from
  anyone who could leave a review at all — to the configured number of
  approvals, each from a reviewer with write permission on the repository.
- **It does not constrain someone who already has write access.** They can
  launch the full test directly with `workflow_dispatch`, no review needed. And
  because a review-triggered run reads the stub's own inputs from the pull
  request's own copy of the file, a write-access contributor can already change
  what a launch runs with, or repoint `uses:` entirely, on their own pull
  request. Relying on this gate as a boundary against someone who already has
  write access is a mistake; it was never built to be one. See PLAN.md's own
  open decision on the equivalent question for the Sentieon secrets.
- An approval authorises a launch of the trusted revision (`'dev'`, or a
  maintainer-controlled `sha`; see [Trusted revision](#trusted-revision) above)
  — never of the code under review.

### Migrating from the vendored workflow

- **A pull request review no longer launches on state alone.** See
  [The gate, in plain words](#the-gate-in-plain-words) above. **A pipeline
  adopting this workflow will find that approvals now have to come from
  reviewers with write permission on the repository**, and that reaching the
  required count (2 by default) is enforced, not just claimed in a comment. A
  reviewer without write access can still leave a review; it is simply never the
  one that launches anything.
- **Check names change.** The vendored workflow had one job, `run-platform`.
  This workflow has four: `config`, `authorize`, `run-platform`, and
  `confirm-pass`. This workflow is not normally a required check; if a pipeline
  has added it to branch protection anyway, point that at
  `<stub name> / confirm-pass`.
- **The launched revision for an approved review is unchanged (`'dev'`), but is
  now computed centrally, not by an inline
  `github.event_name == 'workflow_dispatch' ...` expression in the stub.** See
  [Trusted revision](#trusted-revision) above.
- **The repository guard (`github.repository == '<pipeline name>'`) is gone**,
  for the same reason `branch.yml` dropped its own copy: calling this workflow
  through `workflow_call` already scopes every job to whichever repository calls
  it. A forked pipeline repository that keeps the stub gets its own
  `vars`/`secrets`, normally unset, rather than a guard that depended on a name
  baked into the file at template-generation time.
- **The Seqera Platform debug log now uploads on failure too**, the same fix as
  `awstest.yml`'s own migration note above.
- **The `aligner` parameter matrix moves to the stub's own `with:` inputs.** See
  [Where the full test's parameters live, and why](#where-the-full-tests-parameters-live-and-why)
  above.
- **The Slack notification token moves to the stub's own `secrets:` block, not
  `with:`.** A pipeline whose template's `nextflow_config` carries a Slack bot
  token passes it as `SLACK_BOT_TOKEN` and the channel name as `slack-channel`;
  this workflow builds the notification block itself. See
  [Do not route a secret through a string input](#do-not-route-a-secret-through-a-string-input)
  above for why.

## The `announce-release` action

The [`announce-release`](actions/announce-release) action composes a release
announcement from a GitHub release payload and posts it to one channel, either
Mastodon or Bluesky. `release-announcements.yml` (below) calls it once per
channel.

```yaml
- name: Compose and post to Mastodon
  uses: nf-core/actions/actions/announce-release@v1
  with:
    channel: mastodon
    tag-name: ${{ github.event.release.tag_name }}
    release-name: ${{ github.event.release.name }}
    body: ${{ github.event.release.body }}
    html-url: ${{ github.event.release.html_url }}
    prerelease: ${{ github.event.release.prerelease }}
    pipeline-name: ${{ needs.config.outputs.pipeline-name }}
    repository: ${{ github.repository }}
    max-length: '500'
    mastodon-host: mstdn.science
    mastodon-token: ${{ secrets.MASTODON_ACCESS_TOKEN }}
```

| Input                | Required | Purpose                                                                                                                                                                                                                            |
| -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channel`            | Yes      | `'mastodon'` or `'bluesky'`.                                                                                                                                                                                                       |
| `tag-name`           | Yes      | The release's tag. Announced as written; see [A tag is announced, not validated](#a-tag-is-announced-not-validated) below.                                                                                                         |
| `release-name`       | No       | The release's title. Empty when the release has none, or when it repeats the tag (after the same `v`-prefix normalisation `tag-name` gets, so a title GitHub pre-filled from the tag still dedupes).                               |
| `body`               | No       | The release's notes (Markdown). Empty when the release has none.                                                                                                                                                                   |
| `html-url`           | Yes      | The release's URL.                                                                                                                                                                                                                 |
| `prerelease`         | No       | `'true'` or `'false'`. Empty is treated as `'false'`.                                                                                                                                                                              |
| `pipeline-name`      | No       | Display name. Falls back to `repository`'s last path segment when empty.                                                                                                                                                           |
| `repository`         | Yes      | `owner/repo`, for the fallback above.                                                                                                                                                                                              |
| `max-length`         | Yes      | Maximum length of the posted text, in UTF-16 code units, as a JSON number.                                                                                                                                                         |
| `mastodon-host`      | No       | Mastodon instance host, for example `mstdn.science`. Required, and used, only for the `mastodon` channel. Must be a bare host name: a value containing a scheme or a slash (for example `https://mstdn.science`) fails validation. |
| `mastodon-token`     | No       | Mastodon access token. Required, and used, only for the `mastodon` channel.                                                                                                                                                        |
| `bluesky-identifier` | No       | Bluesky account handle or DID. Required, and used, only for the `bluesky` channel.                                                                                                                                                 |
| `bluesky-password`   | No       | Bluesky app password. Required, and used, only for the `bluesky` channel.                                                                                                                                                          |

Output `post-url` is the posted status's or post's own public URL.

### Composing the text

The composed message is a head line (pipeline name, tag, and either "has been
released" or, for a pre-release, "pre-release is available"), an optional
plain-text excerpt of the release body, the release's own URL, and a fixed set
of hashtags (`#nfcore #openscience #nextflow #bioinformatics`). A release title
that repeats the tag (the common case for an auto-generated release, where
GitHub's own UI pre-fills the title from the tag) is not appended a second time
— the comparison normalises a leading `v` on both sides first, so a title of
`v3.14.0` on tag `v3.14.0` dedupes exactly like a title of `3.14.0` does.

The body is degraded from GitHub-flavoured Markdown to plain text — headings,
bullets, emphasis, inline code, fenced code and links all render literally on a
channel that interprets none of it, so `**bold**` would otherwise reach the post
as four literal asterisks around the word. This is a regular-expression pass
over the shapes nf-core's own release notes actually use, not a full Markdown
parser: an unsupported construct passes through as plain text rather than
crashing the action. Italic emphasis is recognised by asterisks only
(`*italic*`), not underscores: nf-core release notes routinely name snake_case
parameters (`--skip_pseudo_alignment`) and link to URLs containing underscores,
and treating `_` as an emphasis delimiter would eat characters out of both.

Every free-text field (`tag-name`, `release-name`, `body`) is stripped of C0
control characters and DEL before it reaches the composed text, the log, or a
channel's API: a release is normally written by a trusted maintainer through
GitHub's own UI, but the payload is still external, author-controlled text, and
this repo's own conventions treat it that way.

### A tag is announced, not validated

`tag-name` is not required to look like a version. `composeAnnouncement` strips
a leading `v` before a digit (`v3.14.0` and `3.14.0` display the same way) and
otherwise announces whatever the release was tagged, exactly as written.
Rejecting an unexpected tag shape would turn a release with an unconventional
tag into a silent non-announcement instead of the (slightly odd, but readable)
text a human would write by hand.

### The length limit is enforced here, not left to the channel

Mastodon's own default limit is 500 characters; Bluesky's protocol limit is 300.
`max-length` is enforced inside `composeAnnouncement`, not left to the channel's
own API to reject.

When the full text does not fit, space is sacrificed in this order:

1. The body excerpt is shortened (with an ellipsis marking the cut).
2. The body excerpt is dropped entirely.
3. The release title is shortened (with an ellipsis marking the cut).
4. The release title is dropped entirely.

The release's own URL and the fixed hashtags are never shortened or dropped: a
post that fits `max-length` but links nowhere is worse than one that keeps less
body text or a shortened title. (An announcement whose URL and hashtags alone
are already longer than `max-length` is a configuration error this action cannot
compose around; in that unreachable-in-practice case, the URL and hashtags are
what gets cut, because nothing else is left to sacrifice.) Truncation never
splits a UTF-16 surrogate pair, the same guarantee `post-comment`'s own comment
body truncation makes (both now share
[`trimToCodeUnitBoundary`](src/lib/trim-to-code-unit-boundary.ts), moved to
`src/lib` when this action became its second user).

### A re-run does not duplicate the Mastodon post

The Mastodon request carries an `Idempotency-Key` header derived from
`repository` and `tag-name`. If the request reaches Mastodon but its response is
lost (a network blip, the job cancelled mid-request), the step fails and a
"re-run failed jobs" retry sends the same key: Mastodon recognises it and
returns the original status instead of creating a duplicate. Bluesky has no
equivalent header in its `com.atproto.repo.createRecord` call — a deterministic
record key would need computing the AT Protocol's own `rkey` scheme, which is
more machinery than this residual, rare duplicate-post risk is worth taking on
for; a re-run that hits the same failure window can still post to Bluesky twice.

### Where the network call lives, and why no third-party action

Both channels need one authenticated HTTP call: Mastodon is a single
`POST /api/v1/statuses`; Bluesky is a login call
(`com.atproto.server.createSession`) followed by one
`com.atproto.repo.createRecord`. Neither is complex enough to justify a
third-party action inside a job that holds a real credential — this repo's own
reviewed code makes both calls directly, with Node's built-in `fetch`, the same
way `authorize-launch` and `template-version` call the GitHub API directly with
`@actions/github` rather than through a third-party action.

**Bluesky's own trade-off:** the third-party action this replaces
(`zentered/bluesky-post-action`) uses `@atproto/api` to compute rich-text facets
— byte-offset spans that make a link or hashtag inside the post text clickable.
This action does not compute facets: the post still carries the full text,
including the URL, as plain text, but a reader has to copy it rather than tap
it. Computing a facet correctly needs a UTF-8 byte offset, not a UTF-16
code-unit one everything else in this file uses, which is a real chunk of extra
logic for a cosmetic upgrade. Add it if clickable links become worth that cost;
nothing else about this action's design would need to change.

## The `release-announcements.yml` workflow

[`release-announcements.yml`](.github/workflows/release-announcements.yml)
replaces a vendored, per-pipeline workflow that posted a release announcement to
Mastodon and Bluesky on every published release. It also supported
`workflow_dispatch`, but the vendored workflow read the same
`github.event.release.*` fields regardless of trigger, so a manual run with no
release in the event payload silently composed an announcement out of empty
strings. This workflow drops that trigger (see
[Migrating from the vendored workflow](#migrating-from-the-vendored-workflow-8)
below) and fails clearly instead if it is ever reached without one (see
[Requiring a release event](#requiring-a-release-event) below).

```yaml
# .github/workflows/release-announcements.yml in a pipeline repo
name: nf-core release announcements

on:
  release:
    types: [published]

permissions: {}

jobs:
  announce:
    permissions:
      contents: read
    uses: nf-core/actions/.github/workflows/release-announcements.yml@v1
    secrets:
      MASTODON_ACCESS_TOKEN: ${{ secrets.MASTODON_ACCESS_TOKEN }}
      BLUESKY_IDENTIFIER: ${{ secrets.BLUESKY_IDENTIFIER }}
      BLUESKY_APP_PASSWORD: ${{ secrets.BLUESKY_APP_PASSWORD }}
```

`announce:` grants `contents: read`, the most any job inside
`release-announcements.yml` asks for (`config`, to read `.nf-core.yml`; the
`mastodon` and `bluesky` jobs ask for nothing). All three `secrets:` lines are
independently optional: a pipeline that only wants to announce to Mastodon omits
the two Bluesky ones, and vice versa. Omitting all three is valid too — every
channel is skipped, and every job still passes — but is almost certainly not
what a maintainer wants; see
[A missing secret skips, it does not fail — or silently do nothing](#a-missing-secret-skips-it-does-not-fail--or-silently-do-nothing)
below for why that is the intended behaviour anyway.

### Inputs

| Input                 | Required | Default         | Purpose                                                                                                                                         |
| --------------------- | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `mastodon-host`       | No       | `mstdn.science` | Mastodon instance host to post to. A bare host name; see the `announce-release` action's own note on why a URL is rejected.                     |
| `mastodon-max-length` | No       | `'500'`         | Maximum length of the Mastodon post. Mastodon's own default is 500; lower this to match a self-hosted instance configured with a smaller limit. |

### Secrets

| Secret                  | Required | Purpose                                                                                                        |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `MASTODON_ACCESS_TOKEN` | No       | Mastodon access token, scoped to `write:statuses`. Omit to skip the Mastodon announcement.                     |
| `BLUESKY_IDENTIFIER`    | No       | Bluesky account handle or DID. Paired with `BLUESKY_APP_PASSWORD`; omit both to skip the Bluesky announcement. |
| `BLUESKY_APP_PASSWORD`  | No       | Bluesky app password, from Bluesky's own Settings > App Passwords, not the account's login password.           |

### `.nf-core.yml` keys

One: `template.name`, resolved by `read-config` as `pipeline-name` and used as
the announcement's display name. There is no `.nf-core.yml` key for which
channels are enabled; see
[Where channel enablement lives, and why](#where-channel-enablement-lives-and-why)
below.

### A missing secret skips, it does not fail — or silently do nothing

Each channel job (`mastodon`, `bluesky`) runs unconditionally and starts with a
step that checks its own secret (or secret pair) directly, with `env:`, and
writes a `skipped` output — `true` with an `::notice::` line naming the missing
secret, or `false`. The channel's actual "compose and post" step then runs only
`if: steps.check.outputs.skipped != 'true'`.

This is deliberately not a job-level `if:` on the secret. A job skipped that way
still shows as "skipped" in the checks list, which reads as pass either way, but
carries no line of log explaining why: a maintainer who expected an announcement
and got none has nothing to search for. Running the job unconditionally, and
skipping only the step, means the `::notice::` always appears in that job's own
log, and still shows up as an annotation on the run.

It is also deliberately not a hard failure. A pipeline that only ever wants to
announce to one channel must not be forced to configure both, the same reasoning
`awstest.yml`'s optional `TOWER_ACCESS_TOKEN` already established for a
single-channel case — but here there are two independent channels, so an
all-or-nothing choice (fail unless every secret is set) would block a pipeline
that only wants one of them.

### Where channel enablement lives, and why

There is no `ci.mastodon_enabled`-style flag in `.nf-core.yml`. Whether a
channel is announced to is decided by whether the calling stub forwards that
channel's secret at all — already a per-pipeline decision, made in the
pipeline's own repo, under that pipeline's own review, the same way every other
`secrets:` line in every stub in this repo is. A second, `.nf-core.yml`-based
toggle would not add a capability this design lacks; it would only add a way for
the two to disagree — a secret forwarded but the flag left off, or the reverse —
which is a worse failure mode than the one lever this design has.

### Requiring a release event

`config`'s first step checks `github.event.release.tag_name` and fails the whole
run, with `::error::`, if it is empty. This workflow's only sensible trigger is
a published `release`; a stub that calls it from anything else (most plausibly a
leftover `workflow_dispatch:` copied from another workflow) would otherwise
reach `mastodon`/`bluesky` with every `github.event.release.*` field empty, and
compose an announcement that names no tag and links to nothing. Failing once, in
`config`, is clearer than each channel job separately discovering the same empty
payload and posting anyway.

### Why the network call is not gated the way `awsfulltest.yml`'s is

`mastodon` and `bluesky` hold no `permissions:` beyond the default deny and
check out nothing: unlike `awsfulltest.yml`'s `run-platform`, posting an
announcement spends no compute and grants no elevated access, so there is
nothing here for `authorize-launch`-style reviewer gating to protect. The only
thing worth gating is the credential itself, which is what the per-channel
secret check above already does.

### Migrating from the vendored workflow

- **Check names change.** The vendored workflow had two jobs, `toot` and
  `bsky-post`. This workflow has four: `config`, `mastodon`, `bluesky`, and
  `confirm-pass`. This workflow is not normally a required check; if a pipeline
  has added it to branch protection anyway, point that at
  `<stub name> / confirm-pass`.
- **`workflow_dispatch` is gone.** See this section's own introduction above for
  why: the vendored trigger did not actually work without a release event behind
  it.
- **The Bluesky secret is renamed.** `BSKY_IDENTIFIER`/`BSKY_PASSWORD` become
  `BLUESKY_IDENTIFIER`/`BLUESKY_APP_PASSWORD` — the same values, spelled out in
  full, and named for what Bluesky itself calls the second one (an app password,
  not the account's own login password).
- **The Mastodon hashtags are no longer fetched from `nf-co.re`.** The vendored
  workflow called `https://nf-co.re/pipelines.json` at announce time to build a
  per-pipeline hashtag list from the pipeline's own topics. This workflow uses a
  fixed set (`#nfcore #openscience #nextflow #bioinformatics`) instead, so an
  outage on that endpoint can no longer fail, or silently blank, an announcement
  for an unrelated reason.
- **The release body is now included.** The vendored workflow announced the tag,
  the release title, and (for Mastodon only) the pipeline's own description from
  `nf-co.re/pipelines.json` — never the release's own notes. Both channels now
  carry a plain-text excerpt of the release body itself, truncated to fit; see
  [Composing the text](#composing-the-text) above.
- **The Seqera Platform debug-log migration note does not apply here**: this
  workflow calls no third-party action at all, so there is no equivalent
  artifact upload to fix.

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
