const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('configures the direct preload on profile Outlook views', async () => {
	let preloadRegistrationCount = 0;
	const profileSession = {
		getPreloadScripts: () => [],
		registerPreloadScript: () => preloadRegistrationCount++,
	};
	let profileViewOptions;
	let profileWebContents;
	let runtimeInjectionCount = 0;
	let adCssApplicationCount = 0;
	let rejectInjection = false;
	let frameLookupArguments;
	let frameLookupCount = 0;
	let adFrame;
	let vimFrame;
	let rejectAd = false;
	class WebContentsView {
		constructor(options) {
			if (options.webPreferences.partition) {
				profileViewOptions = options;
			}
			this.webContents = new EventEmitter();
			this.webContents.session = profileSession;
			this.webContents.loadURL = () => {};
			this.webContents.loadFile = () => {};
			this.webContents.isDestroyed = () => false;
			this.webContents.getURL = () => 'https://outlook.live.com/mail/';
			this.webContents.url = 'https://outlook.live.com/mail/';
			this.webContents.detached = false;
			this.webContents.insertCSS = async () => {};
			this.webContents.send = () => {};
			if (options.webPreferences.partition) profileWebContents = this.webContents;
		}
		setBounds() {}
		setBackgroundColor() {}
	}
	const ipcMain = new EventEmitter();
	ipcMain.handle = () => {};
	ipcMain.removeHandler = () => {};
	const electronPath = require.resolve('electron');
	require.cache[electronPath] = {
		id: electronPath,
		filename: electronPath,
		loaded: true,
		exports: {
			WebContentsView,
			ipcMain,
			webFrameMain: {
				fromId: (...args) => {
					frameLookupCount++;
					frameLookupArguments = args;
				return profileWebContents;
				},
			},
			session: {
				fromPartition: partition => {
					assert.equal(partition, 'persist:outlook-profile-test');
					return profileSession;
				},
			},
		},
	};

	const managerPath = require.resolve('../../app/mainAppWindow/profileViewManager');
	const injectorPath = require.resolve('../../app/mainAppWindow/outlookMainDocumentRuntimeInjector');
	const adCssPath = require.resolve('../../app/mainAppWindow/outlookAdCss');
	require.cache[injectorPath] = {
		id: injectorPath,
		filename: injectorPath,
		loaded: true,
			exports: {
			injectOutlookMainDocumentRuntime: async (frame) => {
				vimFrame = frame;
				if (rejectInjection) throw new Error('injection failed');
				runtimeInjectionCount++;
			},
		},
	};
	require.cache[adCssPath] = {
		id: adCssPath,
		filename: adCssPath,
		loaded: true,
		exports: {
			applyOutlookAdCss: async (frame) => {
				adFrame = frame;
				if (rejectAd) throw new Error('ad CSS failed');
				adCssApplicationCount++;
			},
		},
	};
	delete require.cache[managerPath];
	const ProfileViewManager = require(managerPath);
	const window = new EventEmitter();
	window.webContents = new EventEmitter();
	window.contentView = { addChildView: () => {}, removeChildView: () => {} };
	window.getContentSize = () => [1200, 800];
	const profilesManager = new EventEmitter();
	profilesManager.list = () => [{
		id: 'profile-test',
		partition: 'persist:outlook-profile-test',
		url: 'https://outlook.live.com/mail/',
	}];
	profilesManager.getActive = () => null;
	profilesManager.getLegacyProfile = () => null;
	const manager = new ProfileViewManager(window, profilesManager, {
		url: 'https://outlook.live.com/mail/',
		chromeUserAgent: 'test-agent',
	}, () => {});

	manager.initialize();

	assert.equal(
		profileViewOptions.webPreferences.preload,
		require.resolve('../../app/browser/preload.js'),
	);
	assert.equal(preloadRegistrationCount, 0);
	assert.equal(profileWebContents.listenerCount('did-finish-load'), 0);
	assert.equal(profileWebContents.listenerCount('did-navigate-in-page'), 0);
	assert.equal(profileWebContents.listenerCount('dom-ready'), 0);
	assert.equal(profileWebContents.listenerCount('did-frame-finish-load'), 1);
	profileWebContents.emit('did-frame-finish-load', {}, true, 12, 34);
	assert.equal(runtimeInjectionCount, 1);
	assert.equal(adCssApplicationCount, 1);
	assert.equal(frameLookupCount, 1);
	profileWebContents.emit('did-frame-finish-load', {}, false, 56, 78);
	assert.equal(runtimeInjectionCount, 1);
	assert.equal(adCssApplicationCount, 1);
	assert.equal(frameLookupCount, 1);
	assert.deepEqual(frameLookupArguments, [12, 34]);
	assert.equal(adFrame, vimFrame);
	assert.equal(adFrame, profileWebContents);

	const unhandled = [];
	const onUnhandledRejection = (reason) => unhandled.push(reason);
	rejectAd = true;
	process.once('unhandledRejection', onUnhandledRejection);
	profileWebContents.emit('did-frame-finish-load', {}, true, 12, 34);
	await Promise.resolve();
	await Promise.resolve();
	process.removeListener('unhandledRejection', onUnhandledRejection);
	assert.deepEqual(unhandled, []);
	assert.equal(runtimeInjectionCount, 2);

	rejectAd = false;
	rejectInjection = true;
	process.once('unhandledRejection', onUnhandledRejection);
	profileWebContents.emit('did-frame-finish-load', {}, true, 12, 34);
	await Promise.resolve();
	await Promise.resolve();
	process.removeListener('unhandledRejection', onUnhandledRejection);
	assert.deepEqual(unhandled, []);
	assert.equal(adCssApplicationCount, 2);

	delete require.cache[injectorPath];
	delete require.cache[adCssPath];
});
