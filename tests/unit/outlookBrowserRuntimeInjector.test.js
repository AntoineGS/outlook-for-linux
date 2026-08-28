const test = require('node:test');
const assert = require('node:assert/strict');

function loadFactory() {
	try {
		return require('../../app/mainAppWindow/outlookBrowserRuntimeInjector').createOutlookBrowserRuntimeInjector;
	} catch {
		return undefined;
	}
}

function loadScheduler() {
	return require('../../app/mainAppWindow/outlookBrowserRuntimeInjector').scheduleOutlookBrowserRuntimeInjection;
}

test('injects the browser runtime into approved Outlook HTTPS documents with minimal config', async () => {
	const createOutlookBrowserRuntimeInjector = loadFactory();
	assert.equal(typeof createOutlookBrowserRuntimeInjector, 'function');
	const scripts = [];
	const inject = createOutlookBrowserRuntimeInjector({
		loadBundle: () => 'globalThis.__runtimeConfig = __OFL_CONFIG__;',
		logger: { info() {}, warn() {} },
	});
	const webContents = {
		getURL: () => 'https://outlook.live.com/mail/',
		executeJavaScript: async (script, userGesture) => {
			assert.equal(userGesture, false);
			scripts.push(script);
		},
	};

	assert.equal(await inject(webContents, {
		shortcuts: { vim: { enabled: true } },
		mqtt: { password: 'must-not-cross-renderer-boundary' },
	}), true);
	assert.equal(scripts.length, 1);
	assert.match(scripts[0], /"enabled":true/);
	assert.doesNotMatch(scripts[0], /must-not-cross-renderer-boundary|mqtt|password/);
});

test('injects into an approved WebFrameMain target', async () => {
	const createOutlookBrowserRuntimeInjector = loadFactory();
	let executed = false;
	const inject = createOutlookBrowserRuntimeInjector({
		loadBundle: () => 'void __OFL_CONFIG__;',
		logger: { info() {}, warn() {} },
	});
	assert.equal(await inject({
		url: 'https://outlook.live.com/mail/',
		executeJavaScript: async () => { executed = true; },
	}, {}), true);
	assert.equal(executed, true);
});

test('rejects auth, insecure, and unrelated documents without reading the bundle', async () => {
	const createOutlookBrowserRuntimeInjector = loadFactory();
	assert.equal(typeof createOutlookBrowserRuntimeInjector, 'function');
	let bundleReads = 0;
	const inject = createOutlookBrowserRuntimeInjector({
		loadBundle: () => { bundleReads++; return 'runtime'; },
		logger: { info() {}, warn() {} },
	});
	for (const url of [
		'https://login.live.com/',
		'http://outlook.live.com/mail/',
		'https://example.com/',
	]) {
		assert.equal(await inject({ getURL: () => url, executeJavaScript: async () => {} }, {}), false);
	}
	assert.equal(bundleReads, 0);
});

test('fails closed when bundle loading or execution fails', async () => {
	const createOutlookBrowserRuntimeInjector = loadFactory();
	assert.equal(typeof createOutlookBrowserRuntimeInjector, 'function');
	const warnings = [];
	const loadFailure = createOutlookBrowserRuntimeInjector({
		loadBundle: () => { throw new Error('sensitive path'); },
		logger: { info() {}, warn: message => warnings.push(message) },
	});
	assert.equal(await loadFailure({
		getURL: () => 'https://outlook.live.com/mail/',
		executeJavaScript: async () => {},
	}, {}), false);
	const executionFailure = createOutlookBrowserRuntimeInjector({
		loadBundle: () => 'runtime',
		logger: { info() {}, warn: message => warnings.push(message) },
	});
	assert.equal(await executionFailure({
		getURL: () => 'https://outlook.live.com/mail/',
		executeJavaScript: async () => { throw new Error('page details'); },
	}, {}), false);
	assert.deepEqual(warnings, [
		'[OUTLOOK_RUNTIME] Browser runtime injection failed',
		'[OUTLOOK_RUNTIME] Browser runtime injection failed',
	]);
});

test('retries injection after late Outlook document replacement', async () => {
	const scheduleOutlookBrowserRuntimeInjection = loadScheduler();
	assert.equal(typeof scheduleOutlookBrowserRuntimeInjection, 'function');
	const timers = [];
	let injectionCount = 0;
	const childFrame = { url: 'https://outlook.live.com/mail/' };
	const mainFrame = { url: 'https://outlook.live.com/mail/' };
	const webContents = { mainFrame };
	mainFrame.framesInSubtree = [mainFrame, childFrame];
	scheduleOutlookBrowserRuntimeInjection(webContents, {}, {
		inject: async () => { injectionCount++; },
		setTimeoutFn: (callback, delay) => timers.push({ callback, delay }),
	});
	scheduleOutlookBrowserRuntimeInjection(webContents, {}, {
		inject: async () => { injectionCount++; },
		setTimeoutFn: (callback, delay) => timers.push({ callback, delay }),
	});
	await Promise.resolve();
	assert.equal(injectionCount, 2);
	assert.deepEqual(timers.map(timer => timer.delay), [1000, 3000]);
	for (const timer of timers) timer.callback();
	await Promise.resolve();
	assert.equal(injectionCount, 6);
});
