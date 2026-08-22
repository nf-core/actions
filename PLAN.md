# nf-core/actions — build plan

Centralised GitHub Actions for nf-core pipelines. Pipelines keep thin stub
workflows that call the reusable workflows here, pinned to the major tag
(`@v1`). All logic, and all security fixes, live here and reach every pipeline
when the tag moves.

## Principles

1. **One place.** A value in a pipeline repo needs a 141-repo campaign to
   change. A value here needs a tag move. Keep values here.
2. **Config precedence.** Every setting resolves in this order: workflow input →
   `.nf-core.yml` in the calling repo → built-in default. A fallback to the
   built-in default logs a warning to the Actions log.
3. **Version gating.** `.nf-core.yml` records the template version. Central code
   reads it and can change behaviour for old pipelines instead of breaking them.
4. **Trust boundary.** Jobs that run pull request code get no secrets and
   read-only scopes. Jobs that hold credentials never run pull request code.
   Data crosses between them as a validated artifact.
5. **TypeScript for logic.** Shell steps handle process invocation only.
   Parsing, validation and decisions live in bundled TypeScript actions: faster,
   testable, and free of shell injection.
6. **Third parties pinned by SHA.** Pipelines pin nf-core by tag; nf-core pins
   external actions by commit SHA. The trust chain ends at code nf-core reviews.

## Repository layout

```
actions/<name>/          Composite or TypeScript action, with its own action.yml
src/actions/<name>/      TypeScript source for that action
src/lib/                 Shared library code (config, github, exec helpers)
__tests__/               Unit tests, mirroring src/
.github/workflows/       Reusable workflows called by pipelines, plus this repo's own CI
```

## Stages

Each stage is specified, implemented and tested on its own, then reviewed for
simplification and correctness before the next stage starts.

| #   | Stage                                       | Delivers                                                                                                                                                                         | Status |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0   | Foundation                                  | Monorepo build (multi-entry bundling), lint, type-check, test, this repo's own CI, release workflow with a moving major tag, governance files. All template boilerplate removed. | Done   |
| 1   | `read-config` action                        | Resolves settings by input → `.nf-core.yml` → default, with warnings. Exposes the template version for gating. Every later stage depends on this.                                | Done   |
| 2   | `get-shards` action                         | Replaces the vendored bash action. Runs an nf-test dry run, parses the count, emits the shard matrix. Fixes the shell injection in the current version.                          | Done   |
| 3   | `nf-test` action                            | Runs one nf-test shard and parses TAP into a job summary. Tool setup stays in the stage-4 workflow.                                                                              | Done   |
| 4   | `nf-test.yml` workflow                      | Reusable workflow: shard discovery, test matrix, pass confirmation, failure reporting. Covers the ARM and GPU variants through config, not separate files.                       | Done   |
| 5   | `fix-linting.yml` workflow                  | Hardened three-job design: gate on commenter, run the fixer unprivileged, validate and push the patch in a separate job. Includes the patch validation action.                   | Done   |
| 6   | `linting.yml` workflow                      | nf-core lint, prettier, editorconfig, plus the Nextflow lint check.                                                                                                              | Done   |
| 7   | `pr-comment.yml` workflow                   | Posts and updates comments from artifacts produced by unprivileged workflows.                                                                                                    | Done   |
| 8   | `template-version-comment.yml` workflow     | Compares the pipeline's template version against the current release and reports it on the pull request.                                                                         | Done   |
| 9   | `branch.yml` + `clean-up.yml` workflows     | Branch protection check for release pull requests; stale issue and pull request handling.                                                                                        | Done   |
| 10  | `download_pipeline.yml` workflow            | Tests `nf-core pipelines download` against the pipeline, including the stub run.                                                                                                 | Done   |
| 11  | `awstest.yml` + `awsfulltest.yml` workflows | Launches small and full tests on Seqera Platform. Adds the reviewer permission check the security review requires.                                                               | Done   |
| 12  | `release-announcements.yml` workflow        | Posts release announcements to the configured channels.                                                                                                                          | Done   |

## Out of scope for now

Cloud test workflows specific to single pipelines (`cloud_tests_full.yml`,
`cloud_tests_small.yml` in rnaseq) stay in those pipelines. They are still out
of scope now that stage 12 is done, for the same reason as before: the shared
workflows above need more time proven in production first.

**What a future stage needs to cover.** rnaseq's `cloud_tests_small.yml` and
`cloud_tests_full.yml` each launch on AWS, Azure, and GCP, chosen through a
`workflow_dispatch` `platform` input (`all`, `aws`, `azure`, or `gcp`), one job
per provider. Stage 11's `awstest.yml`/`awsfulltest.yml` already cover the AWS
job of each: the same `test`/`test_full` profiles, the same `outdir` and
`workdir` construction from a pipeline name and a commit SHA, and (for the full
test) the same `aligner` parameter matrix. What they do not cover is Azure and
GCP: each provider needs its own compute environment and bucket variables
(`TOWER_CE_AZURE_CPU`/`TOWER_BUCKET_AZURE`/`TOWER_IGENOMES_BASE_AZURE`,
`TOWER_CE_GCP_CPU`/`TOWER_BUCKET_GCP`, mirroring the AWS ones `awstest.yml`
already reads from `vars`), and Azure's launch additionally passes
`igenomes_base`, which AWS's does not. A future stage would extend
`awstest.yml`/`awsfulltest.yml` with a `provider` input (or add sibling
`azuretest.yml`/`gcptest.yml` workflows sharing their jobs' shape), and would
need to decide whether the `platform: all` case becomes a matrix inside one
workflow or three separate calls from the stub — the same "call it more than
once for more than one parameter set" pattern `awsfulltest.yml`'s own `aligner`
matrix already establishes for a single provider.

## Follow-ups

- nf-core/tools' `NFCoreYamlConfig` Pydantic model rebuilds `.nf-core.yml` from
  known fields. It does not know about the `ci:` block that stage 1 introduced,
  so a rebuild could silently drop it. Add `ci:` to that model as an optional,
  permissive field so nf-core/tools round-trips it.
- Config loading (`loadConfig`, the ENOENT check, workspace-relative path
  resolution) lives in `src/actions/read-config/run.ts`. Extract it to
  `src/lib/config.ts` when a second action needs to read `.nf-core.yml`, so it
  is not re-derived or copy-pasted.
- `nf-test.yml` (stage 4) does not build a PR-comment artifact for a failed
  `latest-everything` run. `pr-comment.yml` (stage 7) now exists to post it;
  wire the producer side into `nf-test.yml` as a follow-up, instead of bundling
  it into stage 7 itself.
- `.github/actionlint.yaml` ignores one specific error so `nf-test.yml`'s `$/`
  sibling-action references lint clean: actionlint v1.7.12 predates that GitHub
  Actions syntax. Remove the ignore once actionlint recognises `$/`.
- `$/` needs Actions runner 2.336.0 or later and does not exist on GitHub
  Enterprise Server. Confirm with whoever maintains the RunsOn fleet that its
  runners are kept at 2.336.0 or later, since a lagging fleet fails every job in
  every pipeline at action resolution. See README.md's "Referencing the sibling
  actions" note.
- Open decision: a contributor with write access can open a same-repository pull
  request that reads the Sentieon secrets, for the small number of pipelines
  whose stub passes them. This matches current behaviour and is documented in
  README.md's "Sentieon secret exposure" section, but whether to restrict it
  further (for example gating on a reviewer approval, the way stage 11's
  `authorize-launch` now does for `awsfulltest.yml`) is still open.
- `linting.yml` (stage 6)'s `nextflow-lint` job is opt-in through
  `ci.nextflow_lint` in `.nf-core.yml` (default `false`), fixed after review so
  adopting `@v1` cannot hand a pipeline a new failing check. rnaseq should set
  `ci.nextflow_lint: true`, since it already runs this check today from its own
  `nextflow-lint.yml`.
- `linting.yml` (stage 6) has no `ci:` setting for `nextflow lint`'s `-exclude`
  flag: its own default list already covers every generated or tool directory a
  pipeline has, and no pipeline has needed a different one since. Add
  `ci.nextflow_lint_exclude` (a string-list, the same shape as `profiles`) if
  one genuinely does.
- Resolved by stage 9: `pr-comment.yml` (stage 7)'s example stub now lists all
  four producer workflows the vendored workflow it replaces watched, including
  `nf-core branch protection` (`branch.yml`, stage 9).
- Resolved by stage 9: the shared `pr-comment` artifact writer moved to
  `src/lib/pr-comment-artifact.ts`, once `branch.yml`'s own `branch` action
  became the second user, per this file's own convention of moving shared code
  at the point a second user needs it. `template-version/artifact.ts` now
  delegates to it.
- Stage 9's `branch.yml` fixed a gap in the vendored check it replaces: a pull
  request from an unrelated fork with a branch literally named `patch` used to
  pass the branch-protection check (`[[ "$GITHUB_HEAD_REF" == "patch" ]]` alone,
  with no repository check). The new `isAllowedSource()` requires the head
  repository to match the pipeline's own canonical repository for `patch`, the
  same as it already did for `dev`. See README.md's `branch` action section.
- Stage 9's `clean-up.yml` keeps `actions/stale` (GitHub's own `actions`
  organisation, the same publisher as `actions/checkout` and
  `actions/upload-artifact`) inside its privileged job, rather than
  reimplementing stale-issue handling by hand. This honours, rather than needs
  an exception from, the "no third-party action in a privileged job" rule: see
  README.md's `clean-up.yml` section for why that publisher is the same trust
  tier this repo already relies on elsewhere.
- Stage 11's `awsfulltest.yml` follows rnaseq's own `gha-security` branch (the
  security reviewer's own hardened design for this exact gate) for the
  permission check, the approval count, and the always-`'dev'` revision. It
  diverges on two points: the required approval count is configurable through
  `ci.awsfulltest_required_approvals` in `.nf-core.yml` (default 2), so a
  pipeline with one active maintainer is not locked out of its own full test;
  and the decision logic lives in a tested TypeScript action
  (`actions/authorize-launch`) rather than an inline `actions/github-script`
  block, per this file's own "TypeScript for logic" principle. See README.md's
  `authorize-launch` section.
- Stage 11's full-test Nextflow parameters (rnaseq's `aligner` matrix, for
  example) stay on the pipeline's own stub as a `workflow_call` input, not in
  `.nf-core.yml`. Unlike every other setting in this repo, they are not a shared
  CI value: they are the pipeline's own science, and centralising them would
  need this repo's maintainers to understand every pipeline's biology to add
  one. See README.md's "Where the full test's parameters live, and why" for the
  reasoning, and its own note on calling the workflow more than once for a
  pipeline that needs more than one parameter set.
