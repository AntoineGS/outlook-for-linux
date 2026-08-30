const test = require('node:test');
const assert = require('node:assert/strict');
const { createVimEditing } = require('../../app/browser/tools/vimEditing');

class ElementStub {
	constructor(tagName = 'div', attributes = {}) {
		this.tagName = tagName.toUpperCase();
		this.attributes = attributes;
		this.parentElement = null;
		this.children = [];
		this.style = {};
		this.className = '';
		this.textContent = '';
		this.isContentEditable = attributes.contenteditable === 'true';
		this.rect = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
	}

	getAttribute(name) { return this.attributes[name] ?? null; }
	setAttribute(name, value) { this.attributes[name] = String(value); }
	append(child) { child.parentElement = this; this.children.push(child); }
	remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
	contains(node) { return node === this || this.children.some(child => child.contains(node)); }
	focus() { this.ownerDocument.activeElement = this; }
	getBoundingClientRect() { return this.rect; }
	closest(selector) {
		if (selector === '[contenteditable="true"][role="textbox"]' && this.isContentEditable && this.getAttribute('role') === 'textbox') return this;
		return this.parentElement?.closest(selector) || null;
	}
}

function createDocument() {
	const body = new ElementStub('body');
	const view = {
		innerHeight: 500,
		innerWidth: 800,
		listeners: [],
		addEventListener(type, listener, capture) { this.listeners.push({ type, listener, capture }); },
		removeEventListener(type, listener, capture) {
			this.listeners = this.listeners.filter(item => item.type !== type || item.listener !== listener || item.capture !== capture);
		},
	};
	const document = {
		body,
		activeElement: null,
		scrollY: 0,
		scrollX: 0,
		defaultView: view,
		listeners: [],
		createElement: tagName => {
			const element = new ElementStub(tagName);
			if (tagName === 'span') element.rect = { left: 0, top: 0, right: 40, bottom: 20, width: 40, height: 20 };
			element.ownerDocument = document;
			return element;
		},
		addEventListener(type, listener, capture) { this.listeners.push({ type, listener, capture }); },
		removeEventListener(type, listener, capture) {
			this.listeners = this.listeners.filter(item => item.type !== type || item.listener !== listener || item.capture !== capture);
		},
	};
	body.ownerDocument = document;
	return document;
}

function createMutationObserverClass() {
	class MutationObserverStub {
		constructor(callback) { this.callback = callback; this.disconnected = false; MutationObserverStub.instances.push(this); }
		observe() {}
		disconnect() { this.disconnected = true; }
		notify(records) { this.callback(records); }
	}
	MutationObserverStub.instances = [];
	return MutationObserverStub;
}

function createEditor(document, label = 'Message body') {
	const editor = new ElementStub('div', { contenteditable: 'true', role: 'textbox', 'aria-label': label });
	editor.ownerDocument = document;
	const context = new ElementStub('div', { role: 'dialog', 'data-compose-context': 'new-message' });
	const toolbar = new ElementStub('div', { role: 'toolbar' });
	const send = new ElementStub('button', { 'aria-label': 'Send', 'data-compose-action': 'send' });
	context.append(toolbar);
	toolbar.append(send);
	context.append(editor);
	document.body.append(context);
	return editor;
}

function event(editor, overrides = {}) {
	return {
		key: 'h', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
		target: editor, composedPath: () => [editor],
		preventDefault() { this.prevented = true; },
		stopPropagation() { this.stopped = true; },
		...overrides,
	};
}

function core() {
	return { Vim: { findKey: () => () => {} } };
}

function createDriver(mode = 'normal', outcome = 'handled') {
	return {
		handleKey(event) {
			if (outcome instanceof Error) throw outcome;
			if (outcome === 'consume-then-throw') {
				event.preventDefault();
				event.stopPropagation();
				throw new Error('driver failed after consuming');
			}
			return outcome;
		},
		mode: () => mode,
		destroy() {},
	};
}

test('passes through synchronously while the Vim engine is loading or failed', () => {
	const document = createDocument();
	const editor = createEditor(document);
	const loading = createVimEditing({ loadCore: () => new Promise(() => {}), document });
	loading.init({ shortcuts: { vim: { enabled: true } } });
	assert.equal(loading.handleKeydown(event(editor)), 'pass-through');

	const failed = createVimEditing({ loadCore: async () => { throw new Error('load failed'); }, document });
	failed.init({ shortcuts: { vim: { enabled: true } } });
	assert.equal(failed.handleKeydown(event(editor)), 'pass-through');
});

test('reconciles the active composer when the Vim engine finishes loading', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	let resolveCore;
	let adapterCount = 0;
	const controller = createVimEditing({
		loadCore: () => new Promise(resolve => { resolveCore = resolve; }), document, listenFocus: true,
		createAdapter: () => { adapterCount++; return { state: { vim: {} }, destroy() {} }; },
	});
	document.activeElement = editor;
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.listeners.find(listener => listener.type === 'focusin').listener(event(editor));
	assert.equal(adapterCount, 0);
	resolveCore(core());
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(adapterCount, 1);
	assert.equal(document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true').textContent, 'NORMAL');
});

test('retains verified Send geometry while the driver becomes ready asynchronously', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	let resolveCore;
	let resolveDriver;
	const controller = createVimEditing({
		loadCore: () => new Promise(resolve => { resolveCore = resolve; }), document, listenFocus: true,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => new Promise(resolve => { resolveDriver = resolve; }),
	});
	editor.rect = { left: 10, top: 100, right: 210, bottom: 140, width: 200, height: 40 };
	const send = editor.parentElement.children[0].children[0];
	send.rect = { left: 10, top: 148, right: 100, bottom: 168, width: 90, height: 20 };
	document.activeElement = editor;
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.listeners.find(listener => listener.type === 'focusin').listener(event(editor));
	resolveCore(core());
	await new Promise(resolve => setImmediate(resolve));
	resolveDriver(createDriver());
	await new Promise(resolve => setImmediate(resolve));
	const badge = document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true');
	const badgeRect = { left: Number.parseFloat(badge.style.left), top: Number.parseFloat(badge.style.top),
		right: Number.parseFloat(badge.style.left) + badge.rect.width,
		bottom: Number.parseFloat(badge.style.top) + badge.rect.height };
	assert.equal(badge.style.visibility, 'visible');
	assert.ok(badgeRect.bottom <= editor.rect.top || badgeRect.top >= editor.rect.bottom);
	assert.ok(badgeRect.bottom <= send.rect.top || badgeRect.top >= send.rect.bottom ||
		badgeRect.right <= send.rect.left || badgeRect.left >= send.rect.right);
});

test('creates one normal-mode session per composer and renders an accessible badge', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	const controller = createVimEditing({
		loadCore: async () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		listenFocus: true,
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	await new Promise(resolve => setImmediate(resolve));
	document.activeElement = editor;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(editor));
	await new Promise(resolve => setImmediate(resolve));
	const first = event(editor);
	assert.equal(controller.handleKeydown(first), 'handled');
	assert.equal(first.prevented, true);
	assert.equal(document.body.children.filter(child => child.getAttribute('data-vim-mode-badge') === 'true').length, 1);
	const badge = document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true');
	assert.equal(badge.textContent, 'NORMAL');
	assert.equal(badge.getAttribute('aria-live'), 'polite');
	assert.equal(controller.handleKeydown(event(editor)), 'handled');
	assert.equal(document.body.children.filter(child => child.getAttribute('data-vim-mode-badge') === 'true').length, 1);
});

test('renders a filled block cursor only in Normal mode and restores the native caret', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	document.defaultView.getComputedStyle = element => ({
		color: element === editor ? 'rgb(245, 245, 245)' : 'rgb(230, 230, 230)',
		backgroundColor: element === editor ? 'rgba(0, 0, 0, 0)' : 'rgb(32, 33, 36)',
		fontFamily: 'sans-serif',
		fontSize: '14px',
		fontStyle: 'normal',
		fontWeight: '400',
		fontVariant: 'normal',
	});
	editor.style.caretColor = 'rgb(1, 2, 3)';
	let mode = 'normal';
	const adapter = {
		state: { vim: {} },
		getCursorVisual: () => ({
			text: 'A',
			atLineEnd: false,
			rect: { left: 12, top: 24, right: 20, bottom: 40, width: 8, height: 16 },
		}),
		destroy() {},
	};
	const driver = {
		handleKey: () => 'handled',
		mode: () => mode,
		destroy() {},
	};
	const controller = createVimEditing({
		loadCore: () => core(),
		document,
		createAdapter: () => adapter,
		createDriver: () => driver,
		listenFocus: true,
	});
	document.activeElement = editor;
	controller.init({ shortcuts: { vim: { enabled: true } } });

	const cursor = () => document.body.children.find(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	);
	assert.equal(cursor().textContent, 'A');
	assert.equal(cursor().getAttribute('aria-hidden'), 'true');
	assert.equal(cursor().style.position, 'fixed');
	assert.equal(cursor().style.left, '12px');
	assert.equal(cursor().style.top, '24px');
	assert.equal(cursor().style.width, '8px');
	assert.equal(cursor().style.height, '16px');
	assert.equal(cursor().style.backgroundColor, 'rgb(245, 245, 245)');
	assert.equal(cursor().style.color, 'rgb(32, 33, 36)');
	assert.equal(editor.style.caretColor, 'transparent');
	assert.equal(editor.contains(cursor()), false);

	mode = 'insert';
	controller.handleKeydown(event(editor));
	assert.equal(cursor(), undefined);
	assert.equal(editor.style.caretColor, 'rgb(1, 2, 3)');

	mode = 'normal';
	controller.handleKeydown(event(editor));
	assert.ok(cursor());
	assert.equal(editor.style.caretColor, 'transparent');

	mode = 'visual';
	controller.handleKeydown(event(editor));
	assert.equal(cursor(), undefined);
	assert.equal(editor.style.caretColor, 'rgb(1, 2, 3)');

	mode = 'normal';
	controller.handleKeydown(event(editor));
	controller.destroy();
	assert.equal(cursor(), undefined);
	assert.equal(editor.style.caretColor, 'rgb(1, 2, 3)');
});

test('renders an end-of-line block and refreshes its geometry on scroll', () => {
	const document = createDocument();
	const editor = createEditor(document);
	let visual = {
		text: '',
		atLineEnd: true,
		rect: { left: 5, top: 7, right: 5, bottom: 27, width: 0, height: 20 },
	};
	const adapter = {
		state: { vim: {} },
		getCursorVisual: () => visual,
		destroy() {},
	};
	const controller = createVimEditing({
		loadCore: () => core(),
		document,
		createAdapter: () => adapter,
		createDriver: () => createDriver('normal'),
		listenFocus: true,
	});
	document.activeElement = editor;
	controller.init({ shortcuts: { vim: { enabled: true } } });
	const cursor = () => document.body.children.find(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	);

	assert.equal(cursor().textContent, '\u00a0');
	assert.equal(cursor().style.width, '12px');
	visual = {
		text: 'Z',
		atLineEnd: false,
		rect: { left: 30, top: 40, right: 39, bottom: 58, width: 9, height: 18 },
	};
	document.listeners.find(listener => listener.type === 'scroll').listener();
	assert.equal(cursor().textContent, 'Z');
	assert.equal(cursor().style.left, '30px');
	assert.equal(cursor().style.top, '40px');
	assert.equal(cursor().style.width, '9px');
	assert.equal(cursor().style.height, '18px');
});

test('uses an opaque ancestor and contrasting fill when editor colors are transparent', () => {
	const document = createDocument();
	const editor = createEditor(document);
	document.defaultView.getComputedStyle = element => {
		if (element === editor) {
			return { color: 'rgba(0, 0, 0, 0)', backgroundColor: 'rgba(20, 20, 20, 0.25)' };
		}
		if (element === editor.parentElement) {
			return { color: 'rgb(230, 230, 230)', backgroundColor: 'rgba(25, 25, 25, 0.5)' };
		}
		return { color: 'rgb(230, 230, 230)', backgroundColor: 'rgb(30, 31, 34)' };
	};
	const controller = createVimEditing({
		loadCore: () => core(),
		document,
		createAdapter: () => ({
			state: { vim: {} },
			getCursorVisual: () => ({
				text: 'A',
				atLineEnd: false,
				rect: { left: 10, top: 20, right: 18, bottom: 36, width: 8, height: 16 },
			}),
			destroy() {},
		}),
		createDriver: () => createDriver('normal'),
		listenFocus: true,
	});
	document.activeElement = editor;
	controller.init({ shortcuts: { vim: { enabled: true } } });
	const cursor = document.body.children.find(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	);

	assert.equal(cursor.style.backgroundColor, 'rgb(255, 255, 255)');
	assert.equal(cursor.style.color, 'rgb(30, 31, 34)');
});

test('passes mailbox events through and removes the badge on detach and destroy', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	const observerClass = createMutationObserverClass();
	const controller = createVimEditing({ loadCore: () => core(), document, MutationObserverClass: observerClass,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({ handleKey: () => 'handled', mode: () => 'normal', destroy() {} }) });
	controller.init({ shortcuts: { vim: { enabled: true } } });
	assert.equal(controller.handleKeydown(event(editor)), 'pass-through');
	assert.equal(controller.handleKeydown(event(new ElementStub('div'))), 'pass-through');
	editor.remove();
	observerClass.instances[0].notify([]);
	assert.equal(document.body.children.some(child => child.getAttribute('data-vim-mode-badge') === 'true'), false);
	controller.destroy();
	assert.equal(observerClass.instances[0].disconnected, true);
});

test('focusin activates each existing session and focus outside hides the badge immediately', async () => {
	const document = createDocument();
	const first = createEditor(document);
	const second = createEditor(document);
	const drivers = [];
	const controller = createVimEditing({
		loadCore: () => core(), document, listenFocus: true,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => { const driver = createDriver(drivers.length === 0 ? 'normal' : 'insert'); drivers.push(driver); return driver; },
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = first;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(first));
	await Promise.resolve();
	const badge = () => document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true');
	assert.equal(badge().textContent, 'NORMAL');
	document.activeElement = second;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(second));
	await Promise.resolve();
	assert.equal(drivers.length, 2);
	assert.equal(badge().textContent, 'INSERT');
	document.activeElement = first;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(first));
	assert.equal(drivers.length, 2);
	assert.equal(badge().textContent, 'NORMAL');
	document.activeElement = new ElementStub('input');
	document.listeners.find(listener => listener.type === 'focusin').listener(event(document.activeElement));
	assert.equal(badge(), undefined);
});

test('suspends the previous composer before activating the newly focused composer', async () => {
	const document = createDocument();
	const first = createEditor(document);
	const second = createEditor(document);
	const resets = [];
	const controller = createVimEditing({
		loadCore: () => core(), document, listenFocus: true,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => {
			const index = resets.length;
			resets.push(0);
			return { handleKey: () => 'handled', mode: () => 'normal', reset: () => { resets[index]++; }, destroy() {} };
		},
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = first;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(first));
	await Promise.resolve();
	document.activeElement = second;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(second));
	assert.equal(resets[0], 1);
});

test('focusout, document blur, and window blur suspend and clean up their listeners', () => {
	const document = createDocument();
	const editor = createEditor(document);
	let resets = 0;
	const controller = createVimEditing({
		loadCore: () => core(), document, listenFocus: true,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({ handleKey: () => 'handled', mode: () => 'normal', reset: () => { resets++; }, destroy() {} }),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(editor));
	const focusout = document.listeners.find(listener => listener.type === 'focusout');
	const blur = document.listeners.find(listener => listener.type === 'blur');
	const windowBlur = document.defaultView.listeners.find(listener => listener.type === 'blur');
	assert.ok(focusout && blur && windowBlur);
	document.activeElement = new ElementStub('input');
	focusout.listener({ relatedTarget: document.activeElement });
	blur.listener({});
	windowBlur.listener({});
	assert.ok(resets >= 1);
	controller.destroy();
	assert.equal(document.listeners.some(listener => ['focusout', 'blur'].includes(listener.type)), false);
	assert.equal(document.defaultView.listeners.some(listener => listener.type === 'blur'), false);
});

test('renders all driver modes as text and positions the badge below without overlap', async () => {
	const document = createDocument();
	const editor = createEditor(document);
	editor.rect = { left: 10, top: 100, right: 210, bottom: 140, width: 200, height: 40 };
	let mode = 'normal';
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		listenFocus: true,
		createDriver: () => {
			const driver = createDriver('normal');
			driver.mode = () => mode;
			return driver;
		},
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	assert.equal(controller.handleKeydown(event(editor)), 'handled');
	const badge = () => document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true');
	assert.equal(badge().style.position, 'fixed');
	assert.ok(Number.parseFloat(badge().style.top) >= editor.rect.bottom + 8);
	for (const nextMode of ['insert', 'visual']) {
		mode = nextMode;
		assert.equal(controller.handleKeydown(event(editor)), 'handled');
		assert.equal(badge().textContent, nextMode.toUpperCase());
	}
	document.defaultView.innerHeight = 150;
	editor.rect = { ...editor.rect, top: 100, bottom: 140 };
	controller.handleKeydown(event(editor));
	assert.equal(badge().style.visibility, 'visible');
	const boundedTop = Number.parseFloat(badge().style.top);
	const boundedLeft = Number.parseFloat(badge().style.left);
	const badgeIntersectsEditor = boundedLeft < editor.rect.right && boundedLeft + badge().rect.width > editor.rect.left &&
		boundedTop < editor.rect.bottom && boundedTop + badge().rect.height > editor.rect.top;
	assert.equal(badgeIntersectsEditor, false);
	document.defaultView.innerHeight = 55;
	editor.rect = { ...editor.rect, top: 10, bottom: 50, right: 800 };
	document.defaultView.listeners.find(({ type }) => type === 'resize').listener();
	assert.equal(badge().style.visibility, 'hidden');
	document.defaultView.innerHeight = 500;
	document.defaultView.listeners.find(({ type }) => type === 'resize').listener();
	assert.equal(badge().style.visibility, 'visible');
	assert.ok(Number.parseFloat(badge().style.top) >= editor.rect.bottom + 8);
	assert.equal(badge().style.backgroundColor, 'rgb(0, 0, 0)');
	assert.equal(badge().style.color, 'rgb(255, 255, 255)');
});

test('clamps badge candidates before collision and shifts horizontally around Send', () => {
	const document = createDocument();
	const editor = createEditor(document);
	const send = editor.parentElement.children[0].children[0];
	editor.rect = { left: 10, top: 100, right: 210, bottom: 140, width: 200, height: 40 };
	send.rect = { left: 10, top: 148, right: 100, bottom: 168, width: 90, height: 20 };
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => createDriver(),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	controller.handleKeydown(event(editor));
	const badge = () => document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true');
	const top = Number.parseFloat(badge().style.top);
	const left = Number.parseFloat(badge().style.left);
	assert.ok(top >= editor.rect.bottom + 8 || top + badge().rect.height <= editor.rect.top - 8);
	assert.ok(left >= send.rect.right || left + badge().rect.width <= send.rect.left);

	editor.rect = { ...editor.rect, left: -30, right: 170 };
	send.rect = { left: 0, top: 148, right: 80, bottom: 168, width: 80, height: 20 };
	document.defaultView.innerHeight = 150;
	document.defaultView.innerWidth = 100;
	document.defaultView.listeners.find(({ type }) => type === 'resize').listener();
	assert.equal(badge().style.visibility, 'visible');
	assert.ok(Number.parseFloat(badge().style.left) >= 0);
	assert.ok(Number.parseFloat(badge().style.left) + badge().rect.width <= document.defaultView.innerWidth);
});

test('repositions the active badge on named scroll and resize listeners and removes them on destroy', () => {
	const document = createDocument();
	const editor = createEditor(document);
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => createDriver(),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	controller.handleKeydown(event(editor));
	assert.deepEqual(document.listeners.map(({ type }) => type), ['focusout', 'blur', 'selectionchange', 'scroll']);
	assert.deepEqual(document.defaultView.listeners.map(({ type }) => type), ['resize', 'blur']);
	const before = document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true').style.top;
	editor.rect = { ...editor.rect, top: 80, bottom: 100 };
	document.listeners.find(listener => listener.type === 'scroll').listener();
	const after = document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true').style.top;
	assert.notEqual(before, after);
	controller.destroy();
	assert.deepEqual(document.listeners, []);
	assert.deepEqual(document.defaultView.listeners, []);
});

test('destroys adapters and sessions when driver construction throws or rejects', async () => {
	for (const createDriverImpl of [
		() => { throw new Error('construction failed'); },
		() => Promise.reject(new Error('driver failed')),
	]) {
		const document = createDocument();
		const editor = createEditor(document);
		let adapterDestroyed = 0;
		const controller = createVimEditing({
			loadCore: () => core(), document,
			createAdapter: () => ({ state: { vim: {} }, destroy() { adapterDestroyed++; } }),
			createDriver: createDriverImpl,
		});
		controller.init({ shortcuts: { vim: { enabled: true } } });
		document.activeElement = editor;
		assert.equal(controller.handleKeydown(event(editor)), 'pass-through');
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(adapterDestroyed, 1);
		assert.equal(document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true'), undefined);
	}
});

test('returns typed pass-through for unconsumed driver or badge errors and handled after consumption', () => {
	for (const outcome of [new Error('driver failed'), 'consume-then-throw']) {
		const document = createDocument();
		const editor = createEditor(document);
		const controller = createVimEditing({
			loadCore: () => core(), document,
			createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
			createDriver: () => createDriver('normal', outcome),
		});
		controller.init({ shortcuts: { vim: { enabled: true } } });
		document.activeElement = editor;
		const keyEvent = event(editor);
		assert.equal(controller.handleKeydown(keyEvent), outcome === 'consume-then-throw' ? 'handled' : 'pass-through');
		assert.equal(typeof controller.handleKeydown(event(editor)), 'string');
	}
	const document = createDocument();
	const editor = createEditor(document);
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({ handleKey: () => 'handled', mode: () => { throw new Error('badge failed'); }, destroy() {} }),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	assert.equal(controller.handleKeydown(event(editor)), 'pass-through');
});

test('disables a failed consumed session and warns without exposing the error', () => {
	const document = createDocument();
	const editor = createEditor(document);
	const warnings = [];
	let adapterCreated = 0;
	let adapterDestroyed = 0;
	let driverCreated = 0;
	let driverDestroyed = 0;
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	try {
		const controller = createVimEditing({
			loadCore: () => core(), document,
			createAdapter: () => {
				adapterCreated++;
				return { state: { vim: {} }, destroy() { adapterDestroyed++; } };
			},
			createDriver: () => {
				driverCreated++;
				if (driverCreated === 1) {
					return {
						handleKey(keyEvent) {
							keyEvent.preventDefault();
							keyEvent.stopPropagation();
							throw new Error('secret driver fixture');
						},
						mode: () => 'normal',
						destroy() { driverDestroyed++; },
					};
				}
				return { handleKey: () => 'handled', mode: () => 'normal', destroy() { driverDestroyed++; } };
			},
		});
		controller.init({ shortcuts: { vim: { enabled: true } } });
		document.activeElement = editor;
		const keyEvent = event(editor);

		assert.equal(controller.handleKeydown(keyEvent), 'handled');
		assert.equal(document.body.children.find(child => child.getAttribute('data-vim-mode-badge') === 'true'), undefined);
		assert.equal(adapterDestroyed, 1);
		assert.equal(driverDestroyed, 1);
		assert.equal(controller.handleKeydown(event(editor)), 'pass-through');
		assert.equal(adapterCreated, 1);
		assert.equal(driverCreated, 1);
	} finally {
		console.warn = originalWarn;
	}
	assert.deepEqual(warnings, [['[VIM_MODE] Composer session disabled after command failure']]);
});

test('quarantines a failed editor but activates a fresh replacement node', () => {
	const document = createDocument();
	const first = createEditor(document);
	let adapterCreated = 0;
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => { adapterCreated++; return { state: { vim: {} }, destroy() {} }; },
		createDriver: () => ({
			handleKey(keyEvent) { keyEvent.preventDefault(); keyEvent.stopPropagation(); throw new Error('failure'); },
			mode: () => 'normal', destroy() {},
		}),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = first;
	assert.equal(controller.handleKeydown(event(first)), 'handled');
	assert.equal(controller.handleKeydown(event(first)), 'pass-through');
	const replacement = createEditor(document);
	document.activeElement = replacement;
	assert.equal(controller.handleKeydown(event(replacement)), 'handled');
	assert.equal(adapterCreated, 2);
});

test('uses the supplied iframe document for composer identity and session teardown', () => {
	const rootDocument = createDocument();
	const iframeDocument = createDocument();
	const editor = createEditor(iframeDocument, 'Message body');
	let destroyed = 0;
	const controller = createVimEditing({
		loadCore: () => core(), document: rootDocument,
		createAdapter: () => ({ state: { vim: {} }, destroy() { destroyed++; } }),
		createDriver: () => createDriver(),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	iframeDocument.activeElement = editor;

	assert.equal(controller.handleKeydown(event(editor), iframeDocument), 'handled');
	controller.destroyDocument(iframeDocument);
	controller.destroyDocument(iframeDocument);
	assert.equal(destroyed, 1);
	assert.equal(controller.handleKeydown(event(editor), iframeDocument), 'handled');
});

test('restores the previous document cursor when switching composers across documents', () => {
	const rootDocument = createDocument();
	const iframeDocument = createDocument();
	const rootEditor = createEditor(rootDocument, 'Root message body');
	const iframeEditor = createEditor(iframeDocument, 'Iframe message body');
	rootEditor.style.caretColor = 'root-caret';
	iframeEditor.style.caretColor = 'iframe-caret';
	const controller = createVimEditing({
		loadCore: () => core(),
		document: rootDocument,
		createAdapter: editor => ({
			state: { vim: {} },
			getCursorVisual: () => ({
				text: editor === rootEditor ? 'R' : 'I',
				atLineEnd: false,
				rect: { left: 10, top: 20, right: 18, bottom: 36, width: 8, height: 16 },
			}),
			destroy() {},
		}),
		createDriver: () => createDriver('normal'),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	rootDocument.activeElement = rootEditor;
	assert.equal(controller.handleKeydown(event(rootEditor), rootDocument), 'handled');
	assert.equal(rootEditor.style.caretColor, 'transparent');
	assert.ok(rootDocument.body.children.some(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	));

	iframeDocument.activeElement = iframeEditor;
	assert.equal(controller.handleKeydown(event(iframeEditor), iframeDocument), 'handled');
	assert.equal(rootEditor.style.caretColor, 'root-caret');
	assert.equal(rootDocument.body.children.some(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	), false);
	assert.equal(iframeEditor.style.caretColor, 'transparent');
	assert.ok(iframeDocument.body.children.some(
		child => child.getAttribute('data-vim-block-cursor') === 'true',
	));
});

test('passes every modified composer shortcut through before invoking Vim', () => {
	const document = createDocument();
	const editor = createEditor(document);
	let driverCalls = 0;
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({
			handleKey() { driverCalls++; return 'handled'; },
			mode: () => 'normal', destroy() {}
		}),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;

	assert.equal(controller.handleKeydown(event(editor, { key: 'Enter', ctrlKey: true })), 'pass-through');
	assert.equal(driverCalls, 0);
});

test('routes exact Normal Ctrl-r to Vim while other modified keys pass through', () => {
	const document = createDocument();
	const editor = createEditor(document);
	const keys = [];
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({
			handleKey(keyEvent) { keys.push(keyEvent); return 'handled'; },
			mode: () => 'normal', destroy() {},
		}),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;

	assert.equal(controller.handleKeydown(event(editor, { key: 'r', ctrlKey: true })), 'handled');
	assert.equal(controller.handleKeydown(event(editor, { key: 'b', ctrlKey: true })), 'pass-through');
	assert.equal(controller.handleKeydown(event(editor, { key: 'u', altKey: true })), 'pass-through');
	assert.equal(keys.length, 1);
});

test('resets every active grammar when selection departs the focused editor', () => {
	const document = createDocument();
	const editor = createEditor(document);
	let resets = 0;
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		createDriver: () => ({
			handleKey: () => 'handled', mode: () => 'normal', reset: () => { resets++; }, destroy() {},
		}),
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	controller.handleKeydown(event(editor));
	document.getSelection = () => ({ anchorNode: new ElementStub('div'), focusNode: new ElementStub('div') });
	document.listeners.find(listener => listener.type === 'selectionchange').listener();
	assert.equal(resets, 1);
});

test('suspends without quarantining on external selection and reactivates the same session', () => {
	const document = createDocument();
	const editor = createEditor(document);
	let resets = 0;
	let created = 0;
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = message => warnings.push(message);
	try {
	const controller = createVimEditing({
		loadCore: () => core(), document,
		createAdapter: () => ({ state: { vim: {} }, destroy() {} }),
		listenFocus: true,
		createDriver: () => {
			created++;
			return { handleKey: () => 'handled', mode: () => 'normal', reset: () => { resets++; }, destroy() {} };
		},
	});
	controller.init({ shortcuts: { vim: { enabled: true } } });
	document.activeElement = editor;
	controller.handleKeydown(event(editor));
	const external = new ElementStub('div');
	document.getSelection = () => ({ anchorNode: external, focusNode: external });
	document.listeners.find(listener => listener.type === 'selectionchange').listener();
	assert.equal(resets, 1);
	assert.equal(document.body.children.some(child => child.getAttribute('data-vim-mode-badge') === 'true'), false);

	document.activeElement = editor;
	document.listeners.find(listener => listener.type === 'focusin').listener(event(editor));
	assert.equal(created, 1);
	assert.equal(controller.handleKeydown(event(editor)), 'handled');
	} finally {
		console.warn = originalWarn;
	}
	assert.deepEqual(warnings, []);
});
