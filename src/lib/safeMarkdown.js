// LLM text is rendered with dangerouslySetInnerHTML, so it is HTML-escaped first and the only
// real markup is the tags these markdown replacements add.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** **bold** only. */
export function renderBold(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** **bold**, "## heading" lines and "- item" / "• item" lines. */
export function renderMarkdown(text) {
  return renderBold(text)
    .replace(/^##\s+(.+)$/gm, '<p class="font-semibold text-[13px] mt-2 mb-1">$1</p>')
    .replace(/^[•\-]\s+(.+)$/gm, '<li class="mr-3 list-disc text-[12px]">$1</li>');
}
