const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listPackage, extractFile, extractAll } = require('@electron/asar');

const ARCHIVE_PATH = path.join(process.cwd(), 'dist/linux-unpacked/resources/app.asar');
const CORE_PACKAGE_SUFFIX = '/node_modules/@replit/codemirror-vim-core/package.json';
const RUNTIME_MODULES = [
	'/app/browser/tools/outlookComposer.js',
	'/app/browser/tools/richTextPositionMap.js',
	'/app/browser/tools/richTextVimAdapter.js',
	'/app/browser/tools/vimBindings.js',
	'/app/browser/tools/vimCore.js',
	'/app/browser/tools/vimEditing.js',
];
const FORBIDDEN_IDENTIFIERS = [
	'__vimRichText',
	'vimRichTextSpikeBridge',
	'task6-vim-editor',
	'task6-vim-controls',
	'fixture-mention',
];
const FORBIDDEN_PATH = /(?:^|\/)(?:tests|\.superpowers|test-results|playwright-report|docs\/(?:plans|specs|superpowers\/plans|superpowers\/specs)|Cookies|Local Storage|session)(?:\/|$)/i;

function evaluateVimEditingPackage(files, contents, extractionFailures = []) {
	const failures = [];
	if (extractionFailures.length > 0) failures.push('relevant package archive entries could not be extracted');
	const corePackagePath = files.find(file => file.endsWith(CORE_PACKAGE_SUFFIX));
	let coreVersion;
	try {
		coreVersion = JSON.parse(contents.get(corePackagePath)).version;
	} catch (error) {
		void error;
	}
	if (coreVersion !== '0.1.0') failures.push('@replit/codemirror-vim-core version must be exactly 0.1.0');
	for (const modulePath of RUNTIME_MODULES) {
		if (!files.includes(modulePath)) failures.push(`runtime module is missing: ${modulePath}`);
	}
	try {
		const dependencies = JSON.parse(contents.get('/package.json')).dependencies || {};
		if (dependencies['@replit/codemirror-vim-core'] !== '0.1.0') {
			failures.push('packed package dependency must pin @replit/codemirror-vim-core to 0.1.0');
		}
	} catch {
		failures.push('packed package.json dependencies are missing or invalid');
	}
	if (files.some(file => FORBIDDEN_PATH.test(file))) {
		failures.push('forbidden tests/reports/plans/session artifacts are present');
	}
	const sourceText = [...contents.values()].join('\n');
	if (!sourceText.includes("import('@replit/codemirror-vim-core')")) {
		failures.push('runtime Vim dynamic import is missing');
	}
	if (FORBIDDEN_IDENTIFIERS.some(identifier => sourceText.includes(identifier))) {
		failures.push('forbidden Vim spike or fixture identifiers are present');
	}
	return failures;
}

function readArchive(archivePath) {
	const files = listPackage(archivePath);
	const contents = new Map();
	const extractionFailures = [];
	for (const file of files) {
		try {
			contents.set(file, extractFile(archivePath, file.replace(/^\/+/, '')).toString('utf8'));
		} catch {
			if (isRelevantTextEntry(file)) extractionFailures.push(file);
		}
	}
	return { files, contents, extractionFailures };
}

function isRelevantTextEntry(file) {
	return file.endsWith(CORE_PACKAGE_SUFFIX) || /\.(?:js|json|md|txt|ya?ml|html|css)$/i.test(file);
}

async function main() {
	if (!fs.existsSync(ARCHIVE_PATH)) throw new Error(`Missing package archive: ${ARCHIVE_PATH}`);
	const failures = evaluateVimEditingPackage(...Object.values(readArchive(ARCHIVE_PATH)));
	const rules = [
		'exact @replit/codemirror-vim-core version 0.1.0',
		'no Vim spike globals, bridge, or fixed fixture identifiers',
		'no Cookies, Local Storage, session artifacts, tests, reports, or plan files',
	];
	for (const rule of rules) console.log(`rule: ${rule}`);
	if (failures.length > 0) {
		for (const failure of failures) console.error(`FAIL: ${failure}`);
		process.exitCode = 1;
		return;
	}
	try {
		const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vim-package-'));
		try {
			extractAll(ARCHIVE_PATH, extractionRoot);
			const runtime = await import(pathToFileURL(path.join(extractionRoot, 'app/browser/tools/vimCore.js')).href);
			await runtime.loadVimCore();
		} finally {
			fs.rmSync(extractionRoot, { recursive: true, force: true });
		}
		console.log('PASS: packed Vim runtime dynamic import smoke');
	} catch {
		console.error('FAIL: packed Vim runtime dynamic import smoke');
		process.exitCode = 1;
		return;
	}
	for (const rule of rules) console.log(`PASS: ${rule}`);
}

if (require.main === module) void main();

module.exports = { evaluateVimEditingPackage };
