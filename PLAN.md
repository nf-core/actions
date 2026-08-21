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

| #   | Stage                                       | Delivers                                                                                                                                                                         | Status      |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0   | Foundation                                  | Monorepo build (multi-entry bundling), lint, type-check, test, this repo's own CI, release workflow with a moving major tag, governance files. All template boilerplate removed. | Done        |
| 1   | `read-config` action                        | Resolves settings by input → `.nf-core.yml` → default, with warnings. Exposes the template version for gating. Every later stage depends on this.                                | Done        |
| 2   | `get-shards` action                         | Replaces the vendored bash action. Runs an nf-test dry run, parses the count, emits the shard matrix. Fixes the shell injection in the current version.                          | Done        |
| 3   | `nf-test` action                            | Runs one nf-test shard and parses TAP into a job summary. Tool setup stays in the stage-4 workflow.                                                                              | Done        |
| 4   | `nf-test.yml` workflow                      | Reusable workflow: shard discovery, test matrix, pass confirmation, failure reporting. Covers the ARM and GPU variants through config, not separate files.                       | Done        |
| 5   | `fix-linting.yml` workflow                  | Hardened three-job design: gate on commenter, run the fixer unprivileged, validate and push the patch in a separate job. Includes the patch validation action.                   | Done        |
| 6   | `linting.yml` workflow                      | nf-core lint, prettier, editorconfig, plus the Nextflow lint check.                                                                                                              | Not started |
| 7   | `pr-comment.yml` workflow                   | Posts and updates comments from artifacts produced by unprivileged workflows.                                                                                                    | Not started |
| 8   | `template-version-comment.yml` workflow     | Compares the pipeline's template version against the current release and reports it on the pull request.                                                                         | Not started |
| 9   | `branch.yml` + `clean-up.yml` workflows     | Branch protection check for release pull requests; stale issue and pull request handling.                                                                                        | Not started |
| 10  | `download_pipeline.yml` workflow            | Tests `nf-core pipelines download` against the pipeline, including the stub run.                                                                                                 | Not started |
| 11  | `awstest.yml` + `awsfulltest.yml` workflows | Launches small and full tests on Seqera Platform. Adds the reviewer permission check the security review requires.                                                               | Not started |
| 12  | `release-announcements.yml` workflow        | Posts release announcements to the configured channels.                                                                                                                          | Not started |

## Out of scope for now

Cloud test workflows specific to single pipelines (`cloud_tests_full.yml`,
`cloud_tests_small.yml` in rnaseq) stay in those pipelines until the shared
workflows above are proven. Revisit after stage 12.

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
  `latest-everything` run. Wire that in once stage 7's `pr-comment.yml` exists,
  instead of duplicating its contract early.
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
  further (for example gating on a reviewer approval, as stage 11's
  awstest/awsfulltest reviewer check will do) is still open.
