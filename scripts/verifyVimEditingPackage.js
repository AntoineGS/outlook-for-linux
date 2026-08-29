const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { listPackage, extractFile } = require('@electron/asar');
const { buildOutlookBrowserRuntime } = require('./buildOutlookBrowserRuntime');

const ARCHIVE_PATH = path.join(process.cwd(), 'dist/linux-unpacked/resources/app.asar');
const GENERATED_RUNTIME_PATH = '/app/browser/generated/outlookBrowserRuntime.js';
const FORBIDDEN_IDENTIFIERS = [
	'__vimRichText',
	'vimRichTextSpikeBridge',
	'task6-vim-editor',
	'task6-vim-controls',
	'fixture-mention',
];
const FORBIDDEN_PATH = /(?:^|\/)(?:tests|\.worktrees|\.superpowers|test-results|playwright-report|docs\/(?:plans|specs|superpowers\/(?:plans|specs|reports))|docs-site|scripts|app\/assets\/icons\/T4L Logo 2024\.zip|app\/browser\/outlookBrowserRuntime\.js|app\/browser\/tools\/(?:outlookActions|outlookComposer|richTextPositionMap|richTextVimAdapter|vimBindings|vimCore|vimEditing)\.js|node_modules\/@replit\/codemirror-vim-core|Cookies|Local Storage|session)(?:\/|$)/i;

function evaluateVimEditingPackage(files, contents, extractionFailures = [], expectedGeneratedSource) {
	const failures = [];
	if (extractionFailures.length > 0) failures.push('relevant package archive entries could not be extracted');
	if (typeof expectedGeneratedSource !== 'string') failures.push('fresh expected Outlook browser runtime is missing');
	if (!files.includes(GENERATED_RUNTIME_PATH)) {
		failures.push('generated Outlook browser runtime is missing');
	} else {
		const generatedRuntime = contents.get(GENERATED_RUNTIME_PATH);
		if (typeof generatedRuntime !== 'string') {
			failures.push('generated Outlook browser runtime could not be inspected');
		} else {
			try {
				new vm.Script(generatedRuntime);
			} catch {
				failures.push('generated Outlook browser runtime source is not valid JavaScript');
			}
			if (!/^\s*(?:["']use strict["'];\s*)?\(\(\)\s*=>\s*\{[\s\S]*\}\)\(\);\s*$/.test(generatedRuntime)) {
				failures.push('generated Outlook browser runtime is not an IIFE');
			}
			if (typeof expectedGeneratedSource === 'string' && generatedRuntime !== expectedGeneratedSource) {
				failures.push('packaged Outlook browser runtime differs from the fresh expected build');
			}
			const configTokenCount = generatedRuntime.split('__OFL_CONFIG__').length - 1;
			if (configTokenCount !== 1) {
				failures.push('generated Outlook browser runtime must contain exactly one __OFL_CONFIG__ token');
			}
			if (!generatedRuntime.includes('__oflOutlookVimInitialized')) {
				failures.push('generated Outlook browser runtime initialization marker is missing');
			}
			if (/\brequire\s*\(/.test(generatedRuntime)) {
				failures.push('generated Outlook browser runtime contains unresolved CommonJS require calls');
			}
			if (/\bprocess\b/.test(generatedRuntime)) {
				failures.push('generated Outlook browser runtime contains a browser-unsafe process dependency');
			}
			if (/outlookAdSuppressor|adSuppressor/i.test(generatedRuntime)) {
				failures.push('generated Outlook browser runtime contains ad suppressor code');
			}
		}
	}
	if (files.some(file => FORBIDDEN_PATH.test(file))) {
		failures.push('forbidden tests/reports/plans/session artifacts are present');
	}
	const generatedRuntime = contents.get(GENERATED_RUNTIME_PATH);
	if (typeof generatedRuntime === 'string' && FORBIDDEN_IDENTIFIERS.some(identifier => generatedRuntime.includes(identifier))) {
		failures.push('forbidden Vim spike or fixture identifiers are present');
	}
	return failures;
}

function readArchive(archivePath) {
	const files = listPackage(archivePath);
	const contents = new Map();
	const extractionFailures = [];
	if (files.includes(GENERATED_RUNTIME_PATH)) {
		try {
			contents.set(GENERATED_RUNTIME_PATH, extractFile(archivePath, GENERATED_RUNTIME_PATH.slice(1)).toString('utf8'));
		} catch {
			extractionFailures.push(GENERATED_RUNTIME_PATH);
		}
	}
	return { files, contents, extractionFailures };
}

async function main() {
	if (!fs.existsSync(ARCHIVE_PATH)) throw new Error(`Missing package archive: ${ARCHIVE_PATH}`);
	let expectedGeneratedSource;
	const expectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-runtime-'));
	try {
		const expectedPath = path.join(expectedRoot, 'outlookBrowserRuntime.js');
		await buildOutlookBrowserRuntime({ outputFile: expectedPath });
		expectedGeneratedSource = fs.readFileSync(expectedPath, 'utf8');
	} catch {
		// A missing fresh output must make package verification fail closed.
	} finally {
		fs.rmSync(expectedRoot, { recursive: true, force: true });
	}
	const failures = evaluateVimEditingPackage(...Object.values(readArchive(ARCHIVE_PATH)), expectedGeneratedSource);
	const rules = [
		'no bundled @replit/codemirror-vim-core package',
		'no Vim spike globals, bridge, or fixed fixture identifiers',
		'no Cookies, Local Storage, session artifacts, tests, reports, or plan files',
		'generated Outlook browser runtime is present and browser-safe',
	];
	for (const rule of rules) console.log(`rule: ${rule}`);
	if (failures.length > 0) {
		for (const failure of failures) console.error(`FAIL: ${failure}`);
		process.exitCode = 1;
		return;
	}
	for (const rule of rules) console.log(`PASS: ${rule}`);
}

if (require.main === module) void main();

module.exports = { evaluateVimEditingPackage };
