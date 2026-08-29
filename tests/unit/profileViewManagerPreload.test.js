const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('configures the direct preload on profile Outlook views', () => {
	let preloadRegistrationCount = 0;
	const profileSession = {
		getPreloadScripts: () => [],
		registerPreloadScript: () => preloadRegistrationCount++,
	};
	let profileViewOptions;
	let profileWebContents;
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
			session: {
				fromPartition: partition => {
					assert.equal(partition, 'persist:outlook-profile-test');
					return profileSession;
				},
			},
		},
	};

	const managerPath = require.resolve('../../app/mainAppWindow/profileViewManager');
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
	assert.equal(profileWebContents.listenerCount('dom-ready'), 0);
	assert.equal(profileWebContents.listenerCount('did-frame-finish-load'), 0);
});
