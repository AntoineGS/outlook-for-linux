const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

test('registers a profile session preload before constructing its Outlook view', () => {
	const events = [];
	const profileSession = {
		getPreloadScripts: () => [],
		registerPreloadScript: () => events.push('register'),
	};
	let profileViewOptions;
	class WebContentsView {
		constructor(options) {
			if (options.webPreferences.partition) {
				profileViewOptions = options;
				events.push('construct');
			}
			this.webContents = new EventEmitter();
			this.webContents.session = profileSession;
			this.webContents.loadURL = () => {};
			this.webContents.loadFile = () => {};
			this.webContents.isDestroyed = () => false;
			this.webContents.send = () => {};
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

	assert.deepEqual(events.slice(0, 2), ['register', 'construct']);
	assert.equal(profileViewOptions.webPreferences.preload, undefined);
});
