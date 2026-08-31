const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const options = require('../../app/config/options');
const { MAILBOX_BINDINGS } = require('../../app/browser/tools/vimMailboxKeymap');

const configurationGuide = fs.readFileSync(
	path.join(__dirname, '../../docs-site/docs/configuration.md'),
	'utf8',
);

test('documents the Vim prerequisite and every mailbox sequence', () => {
	const vimField = options.shortcuts.fields['vim.enabled'];
	assert.match(vimField.describe, /Outlook default keyboard shortcuts/);
	assert.match(vimField.describe, /Settings > General > Accessibility > Keyboard shortcuts/);
	for (const { sequence } of MAILBOX_BINDINGS) {
		assert.ok(configurationGuide.includes('`' + sequence + '`'));
	}
});
