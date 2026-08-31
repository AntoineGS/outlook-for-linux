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
const vimSectionStart = configurationGuide.indexOf('#### Vim Shortcuts');
const vimSectionEnd = configurationGuide.indexOf('### MQTT Integration', vimSectionStart);
const vimSection = configurationGuide.slice(vimSectionStart, vimSectionEnd);
const normalizedVimSection = vimSection.replace(/\s+/g, ' ');

function inlineCode(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('documents the Vim prerequisite and every mailbox binding', () => {
	const vimField = options.shortcuts.fields['vim.enabled'];
	assert.match(vimField.describe, /Outlook default keyboard shortcuts/);
	assert.match(vimField.describe, /Settings > General > Accessibility > Keyboard shortcuts/);
	assert.notEqual(vimSectionStart, -1);
	assert.ok(vimSectionEnd > vimSectionStart);
	assert.match(
		normalizedVimSection,
		/In a message list, `q` toggles the selected conversation read\/unread; in the reading pane, it marks only the selected individual message unread\./,
	);
	for (const { sequence, action } of MAILBOX_BINDINGS) {
		assert.match(
			vimSection,
			new RegExp('\\| `' + inlineCode(sequence) + '` \\| `' + inlineCode(action) + '` \\|'),
		);
	}
});
