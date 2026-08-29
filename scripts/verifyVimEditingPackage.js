const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { listPackage, extractFile, extractAll } = require('@electron/asar');
const { buildOutlookBrowserRuntime } = require('./buildOutlookBrowserRuntime');

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
const GENERATED_RUNTIME_PATH = '/app/browser/generated/outlookBrowserRuntime.js';
const FORBIDDEN_IDENTIFIERS = [
	'__vimRichText',
	'vimRichTextSpikeBridge',
	'task6-vim-editor',
	'task6-vim-controls',
	'fixture-mention',
];
const FORBIDDEN_PATH = /(?:^|\/)(?:tests|\.worktrees|\.superpowers|test-results|playwright-report|docs\/(?:plans|specs|superpowers\/(?:plans|specs|reports))|Cookies|Local Storage|session)(?:\/|$)/i;

function evaluateVimEditingPackage(files, contents, extractionFailures = [], expectedGeneratedSource) {
	const failures = [];
	if (extractionFailures.length > 0) failures.push('relevant package archive entries could not be extracted');
	if (typeof expectedGeneratedSource !== 'string') failures.push('fresh expected Outlook browser runtime is missing');
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
		'exact @replit/codemirror-vim-core version 0.1.0',
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
