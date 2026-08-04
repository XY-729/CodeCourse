/** Derive a display title from markdown content: first `# H1`, falling back to the basename without `.md`. */
export function titleFromMarkdown(filename: string, content: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/\.md$/i, "");
}
