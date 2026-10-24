/** Escapes a value for an HTML text or attribute position, dropping invisible bidi controls. */
export const esc = (v: unknown) => String(v ?? '').replace(/[​-‏‪-‮⁦-⁩]/g, '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
