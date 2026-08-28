const fs = require('node:fs');
const path = require('node:path');
const product = require('../product');

const BUNDLE_PATH = path.join(__dirname, '..', 'browser', 'generated', 'outlookBrowserRuntime.js');
const scheduledWebContents = new WeakSet();

function createOutlookBrowserRuntimeInjector({
	loadBundle = () => fs.readFileSync(BUNDLE_PATH, 'utf8'),
	logger = console,
} = {}) {
	let bundle;
	return async function injectOutlookBrowserRuntime(webContents, config) {
		try {
			const targetUrl = typeof webContents.getURL === 'function' ? webContents.getURL() : webContents.url;
			const url = new URL(targetUrl);
			if (url.protocol !== 'https:' || !product.isAppHost(url.hostname)) return false;
			bundle ??= loadBundle();
			const runtimeConfig = {
				shortcuts: { vim: { enabled: config?.shortcuts?.vim?.enabled === true } },
			};
			const source = `(() => {
				const runtimeKey = Symbol.for('outlook-for-linux.browser-runtime');
				if (globalThis[runtimeKey]) return;
				const __OFL_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig)});
				${bundle}
				globalThis[runtimeKey] = true;
			})()`;
			await webContents.executeJavaScript(source, false);
			return true;
		} catch {
			logger.warn('[OUTLOOK_RUNTIME] Browser runtime injection failed');
			return false;
		}
	};
}

const injectOutlookBrowserRuntime = createOutlookBrowserRuntimeInjector();

function scheduleOutlookBrowserRuntimeInjection(webContents, config, {
	inject = injectOutlookBrowserRuntime,
	setTimeoutFn = setTimeout,
} = {}) {
	if (scheduledWebContents.has(webContents)) return;
	scheduledWebContents.add(webContents);
	const injectCurrentFrames = () => {
		if (webContents.isDestroyed?.()) {
			scheduledWebContents.delete(webContents);
			return;
		}
		let frames = [];
		try {
			frames = webContents.mainFrame?.framesInSubtree || [];
		} catch {}
		const mainFrame = webContents.mainFrame;
		for (const target of new Set([webContents, ...frames.filter(frame => frame !== mainFrame)])) {
			void inject(target, config);
		}
	};
	injectCurrentFrames();
	setTimeoutFn(injectCurrentFrames, 1000);
	setTimeoutFn(() => {
		injectCurrentFrames();
		scheduledWebContents.delete(webContents);
	}, 3000);
}

module.exports = {
	createOutlookBrowserRuntimeInjector,
	injectOutlookBrowserRuntime,
	scheduleOutlookBrowserRuntimeInjection,
};
