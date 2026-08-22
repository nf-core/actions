// Pure composition of a release announcement, and the plain-text cleanup a
// GitHub release's own free-text fields (name, body) need before they reach
// a channel that renders no markdown and no HTML. No I/O here: mastodon.ts
// and bluesky.ts own posting the result.

import { trimToCodeUnitBoundary } from '../../lib/trim-to-code-unit-boundary.js'

export interface ReleasePayload {
  /** 'github.event.release.tag_name'. Not assumed to be a version: an old or malformed tag is still announced, as written. */
  tagName: string
  /** 'github.event.release.name'. Empty when the release has no title. */
  releaseName: string
  /** 'github.event.release.body'. Empty when the release has no notes. */
  body: string
  htmlUrl: string
  prerelease: boolean
}

export interface ComposeOptions {
  /** Normally read-config's own 'pipeline-name' output. Falls back to `repository` when empty (true for a pipeline pre-dating 'template.name'). */
  pipelineName: string
  /** 'github.event.repository.full_name' / 'github.repository', owner/repo. */
  repository: string
  /** Maximum length of the result, in UTF-16 code units. */
  maxLength: number
}

const HASHTAGS = '#nfcore #openscience #nextflow #bioinformatics'
const ELLIPSIS = '…'
// Blank line between the head line, the body excerpt and the footer.
const JOIN = '\n\n'

// Removes C0 controls and DEL. Keeps \t, \n and \r: those are ordinary
// whitespace in release text, not control codes a channel's own renderer or
// this repo's Actions log could misread.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS, '')
}

const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)]*)\)/g
const HEADING = /^#{1,6}[ \t]+/gm
const CODE_FENCE_LINE = /^```.*$/gm
const INLINE_CODE = /`([^`]*)`/g
const BOLD = /\*\*([^*]+)\*\*|__([^_]+)__/g
// Asterisks only: an underscore is not an emphasis delimiter here, so a
// snake_case parameter name and a URL containing underscores survive
// unchanged. nf-core release notes never rely on single-underscore italics.
const ITALIC = /(?<!\*)\*([^*\n]+)\*(?!\*)/g
const BULLET = /^[ \t]*[*-][ \t]+/gm
const BLANK_RUN = /\n{3,}/g

/**
 * Degrades common GitHub-flavoured markdown to plain text: a channel here
 * renders none of it, so a literal '**', '#' or '[text](url)' would just be
 * clutter. Not a full markdown parser (ponytail: covers the shapes nf-core
 * release notes actually use — headings, bullets, links, emphasis, fenced
 * code — not every CommonMark construct; widen it if a release note starts
 * using one this misses).
 */
function toPlainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(MARKDOWN_LINK, (_match, label: string, url: string) =>
      label.trim() ? `${label} (${url})` : url
    )
    .replace(CODE_FENCE_LINE, '')
    .replace(INLINE_CODE, '$1')
    .replace(HEADING, '')
    .replace(BOLD, (_match, a?: string, b?: string) => a ?? b ?? '')
    .replace(ITALIC, '$1')
    .replace(BULLET, '• ')
    .replace(BLANK_RUN, '\n\n')
    .trim()
}

/**
 * Strips a leading 'v' before a digit, so 'v3.14.0' and '3.14.0' display the
 * same way. Anything else — including a tag that is not version-shaped at
 * all — passes through unchanged: an unexpected tag is still announced,
 * exactly as the release named it, rather than rejected.
 */
function displayTag(tagName: string): string {
  return tagName.replace(/^v(?=\d)/, '')
}

// Both sides are normalised the same way `displayTag` normalises the tag
// itself: a title GitHub pre-filled from the tag (for example title
// 'v3.14.0' on tag 'v3.14.0') must dedupe just as well as a title that was
// typed without the 'v'.
function sameRelease(tagDisplay: string, releaseName: string): boolean {
  return (
    displayTag(releaseName).trim().toLowerCase() ===
    tagDisplay.trim().toLowerCase()
  )
}

/** The fixed part of the head line: pipeline name, tag, and verb. Never shrunk or dropped. */
function buildBase(
  payload: ReleasePayload,
  displayName: string
): { base: string; tagDisplay: string } {
  const tagDisplay = stripControlChars(displayTag(payload.tagName)).trim()
  const verb = payload.prerelease
    ? 'pre-release is available'
    : 'has been released'
  const subject = [displayName, tagDisplay].filter(Boolean).join(' ')
  return { base: `${subject} ${verb}!`.trim(), tagDisplay }
}

/** The release title, or '' when there is none or it only repeats the tag. */
function releaseNameFor(payload: ReleasePayload, tagDisplay: string): string {
  const releaseName = stripControlChars(payload.releaseName).trim()
  return !releaseName || sameRelease(tagDisplay, releaseName) ? '' : releaseName
}

function withReleaseName(base: string, releaseName: string): string {
  return releaseName ? `${base} ${releaseName}` : base
}

/** Truncates `text` to `maxLength` UTF-16 code units, appending an ellipsis when anything is cut. Never splits a surrogate pair. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const budget = Math.max(maxLength - ELLIPSIS.length, 0)
  return trimToCodeUnitBoundary(text, budget) + ELLIPSIS
}

/**
 * Composes a release announcement from `payload`, truncated to fit
 * `options.maxLength`. Space is sacrificed in this order: the body excerpt
 * first (shrunk, then dropped), then the release title (shrunk, then
 * dropped). The footer — the release link and the hashtags — is never
 * shrunk: a post that cannot link anywhere is worse than one with less body
 * text. (Only if `options.maxLength` is smaller than the footer itself,
 * a misconfiguration this action cannot compose around, does the footer
 * get cut too; there is nothing else left to sacrifice at that point.)
 */
export function composeAnnouncement(
  payload: ReleasePayload,
  options: ComposeOptions
): string {
  const displayName =
    stripControlChars(options.pipelineName).trim() ||
    (options.repository.split('/').pop() ?? options.repository)

  const footer = `${stripControlChars(payload.htmlUrl).trim()}${JOIN}${HASHTAGS}`
  const { base, tagDisplay } = buildBase(payload, displayName)
  const releaseName = releaseNameFor(payload, tagDisplay)
  const bodyExcerpt = toPlainText(stripControlChars(payload.body))

  // Room for everything except the footer, which is joined on afterwards
  // and always kept whole.
  const budget = options.maxLength - footer.length - JOIN.length
  if (budget <= 0) {
    return truncate(footer, options.maxLength)
  }

  const headFull = withReleaseName(base, releaseName)

  if (bodyExcerpt) {
    const withBody = `${headFull}${JOIN}${bodyExcerpt}`
    if (withBody.length <= budget) {
      return `${withBody}${JOIN}${footer}`
    }
    // Shrink the body to whatever room the full head line leaves.
    const bodyBudget = budget - headFull.length - JOIN.length
    if (bodyBudget > 0) {
      return `${headFull}${JOIN}${truncate(bodyExcerpt, bodyBudget)}${JOIN}${footer}`
    }
    // No room for any body text: fall through and drop it entirely.
  }

  if (headFull.length <= budget) {
    return `${headFull}${JOIN}${footer}`
  }

  // The head line alone does not fit next to the footer. Shrink the
  // release title; the base (pipeline name, tag, verb) does not shrink.
  if (releaseName) {
    const nameBudget = budget - base.length - 1 // 1: the joining space
    if (nameBudget > 0) {
      return `${base} ${truncate(releaseName, nameBudget)}${JOIN}${footer}`
    }
  }

  // Last resort: even the base does not fit next to the footer. The footer
  // still does not shrink.
  return `${truncate(base, budget)}${JOIN}${footer}`
}
