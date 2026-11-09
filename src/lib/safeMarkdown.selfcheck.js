// Self-check for safeMarkdown — run: node src/lib/safeMarkdown.selfcheck.js
import { strict as assert } from 'node:assert';
import { renderBold, renderMarkdown } from './safeMarkdown.js';

// Model output is text: tags and attributes in it come out inert.
assert.equal(renderBold('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(renderMarkdown('**<b>x</b>**'), '<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
assert.ok(!/<(?!\/?(strong|p|li)\b)/.test(renderMarkdown('## <svg onload=alert(1)>\n- "a" & \'b\'')));

// The markdown it supports still renders.
assert.equal(renderBold('a **b** c'), 'a <strong>b</strong> c');
assert.equal(renderMarkdown('## כותרת\n- פריט\n• עוד'),
  '<p class="font-semibold text-[13px] mt-2 mb-1">כותרת</p>\n<li class="mr-3 list-disc text-[12px]">פריט</li>\n<li class="mr-3 list-disc text-[12px]">עוד</li>');

console.log('safeMarkdown selfcheck: ok');
