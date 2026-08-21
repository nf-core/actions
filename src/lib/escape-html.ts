// Shared by every action that writes untrusted values into a job summary
// table (nf-test, read-config): core.summary.addTable() writes cell data as
// raw HTML, unescaped.

/** Escapes text for a job summary table cell. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
