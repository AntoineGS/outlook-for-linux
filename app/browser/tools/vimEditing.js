const { findOutlookComposerDetails } = require('./outlookComposer');
const { createRichTextVimAdapter } = require('./richTextVimAdapter');
const { createVimDriver, loadVimCore } = require('./vimCore');

function createVimEditing({
	loadCore = loadVimCore,
	document: rootDocument = globalThis.document,
	MutationObserverClass = globalThis.MutationObserver,
	createAdapter = createRichTextVimAdapter,
	createDriver = createVimDriver,
	listenFocus = false,
} = {}) {
	const sessions = new Map();
	let core = null;
	let destroyed = false;
	let initialized = false;
	let observer = null;
	const badges = new Map();
	const cursorBlocks = new Map();
	const quarantinedEditors = new WeakSet();
	let focusHandler = null;
	let focusoutHandler = null;
	let blurHandler = null;
	let selectionHandler = null;
	let scrollHandler = null;
	let resizeHandler = null;
	let windowBlurHandler = null;

	const isAttached = editor => {
		const document = editor.ownerDocument || rootDocument;
		for (let current = editor; current; current = current.parentElement) {
			if (current === document.body || current === document.documentElement) return true;
		}
		return false;
	};

	const removeBadge = document => {
		const badge = badges.get(document);
		badge?.remove?.();
		badges.delete(document);
	};
	const removeCursorBlock = document => {
		const cursor = cursorBlocks.get(document);
		cursor?.remove?.();
		cursorBlocks.delete(document);
	};
	const restoreNativeCaret = session => {
		if (!session?.caretColorSaved) return;
		session.editor.style.caretColor = session.previousCaretColor;
		session.previousCaretColor = undefined;
		session.caretColorSaved = false;
	};
	const clearCursor = session => {
		if (!session) return;
		restoreNativeCaret(session);
		if (!activeSession || activeSession === session || activeSession.document !== session.document) {
			removeCursorBlock(session.document);
		}
	};

	const destroyResource = resource => {
		try { resource?.destroy?.(); } catch { return; }
	};

	const positionBadge = (editor, sendControl) => {
		const document = editor?.ownerDocument || rootDocument;
		const badge = badges.get(document);
		if (!badge || !editor) return;
		const rect = editor.getBoundingClientRect?.();
		const badgeRect = badge.getBoundingClientRect?.();
		if (!rect || !badgeRect) return;
		const gap = 8;
		const view = document.defaultView || document;
		const maxLeft = Math.max(0, (view.innerWidth || 0) - badgeRect.width);
		const maxTop = Math.max(0, (view.innerHeight || 0) - badgeRect.height);
		const overlaps = candidate => {
			const control = sendControl?.getBoundingClientRect?.();
			return [rect, control].some(controlRect => controlRect && candidate.left < controlRect.right && candidate.right > controlRect.left &&
				candidate.top < controlRect.bottom && candidate.bottom > controlRect.top);
		};
		const clamp = (value, maximum) => Math.min(Math.max(value, 0), maximum);
		const candidate = (left, top) => {
			const clampedLeft = clamp(left, maxLeft);
			const clampedTop = clamp(top, maxTop);
			return { left: clampedLeft, right: clampedLeft + badgeRect.width,
				top: clampedTop, bottom: clampedTop + badgeRect.height };
		};
		const horizontalPositions = [...new Set([
			rect.left, rect.right - badgeRect.width,
			rect.left - badgeRect.width - gap, rect.right + gap, 0, maxLeft,
		])];
		const verticalPositions = [rect.bottom + gap, rect.top - gap - badgeRect.height];
		const safeCandidate = verticalPositions.flatMap(top => horizontalPositions.map(left => candidate(left, top)))
			.find(value => !overlaps(value));
		if (!safeCandidate) {
			badge.style.visibility = 'hidden';
			return;
		}
		badge.style.visibility = 'visible';
		badge.style.left = `${safeCandidate.left}px`;
		badge.style.top = `${safeCandidate.top}px`;
	};

	const renderBadge = (editor, mode, sendControl) => {
		const document = editor?.ownerDocument || rootDocument;
		if (!document?.createElement) return;
		let badge = badges.get(document);
		if (!badge) {
			badge = document.createElement('span');
			badge.setAttribute('data-vim-mode-badge', 'true');
			badge.setAttribute('aria-live', 'polite');
			badge.setAttribute('aria-atomic', 'true');
			badge.setAttribute('aria-hidden', 'false');
			badge.tabIndex = -1;
			badge.style.pointerEvents = 'none';
			badge.style.backgroundColor = 'rgb(0, 0, 0)';
			badge.style.color = 'rgb(255, 255, 255)';
			badge.style.zIndex = '2147483647';
			badge.style.position = 'fixed';
			document.body?.append?.(badge);
			badges.set(document, badge);
		}
		badge.textContent = mode.toUpperCase();
		positionBadge(editor, sendControl);
	};
	const colorParts = color => String(color || '').match(/\d*\.?\d+%?/g) || [];
	const colorAlpha = color => {
		if (!color || color === 'transparent') return 0;
		if (!/^(?:rgba|hsla|rgb|hsl)\(/.test(color)) return 1;
		const parts = colorParts(color);
		if (parts.length < 4) return 1;
		const alpha = Number.parseFloat(parts.at(-1));
		return parts.at(-1).endsWith('%') ? alpha / 100 : alpha;
	};
	const isOpaqueColor = color => colorAlpha(color) >= 1;
	const contrastingColor = background => {
		const parts = colorParts(background).slice(0, 3).map(part => {
			const value = Number.parseFloat(part);
			return part.endsWith('%') ? value * 2.55 : value;
		});
		if (parts.length < 3 || parts.some(value => !Number.isFinite(value))) return 'rgb(0, 0, 0)';
		const luminance = (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000;
		return luminance >= 128 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
	};
	const editorBackground = (editor, view) => {
		for (let current = editor; current; current = current.parentElement) {
			const color = view?.getComputedStyle?.(current)?.backgroundColor;
			if (isOpaqueColor(color)) return color;
		}
		return 'rgb(255, 255, 255)';
	};
	const renderCursor = (session, mode) => {
		if (!session || mode !== 'normal' || typeof session.adapter?.getCursorVisual !== 'function') {
			clearCursor(session);
			return;
		}
		let visual;
		try {
			visual = session.adapter.getCursorVisual();
		} catch {
			clearCursor(session);
			return;
		}
		const rect = visual?.rect;
		if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
			clearCursor(session);
			return;
		}
		const height = Math.max(1, rect.height || rect.bottom - rect.top || 16);
		const width = visual.atLineEnd ? Math.max(1, Math.round(height * 0.6)) :
			Math.max(1, rect.width || rect.right - rect.left || Math.round(height * 0.6));
		let cursor = cursorBlocks.get(session.document);
		if (!cursor) {
			cursor = session.document.createElement('span');
			cursor.setAttribute('data-vim-block-cursor', 'true');
			cursor.setAttribute('aria-hidden', 'true');
			cursor.tabIndex = -1;
			cursor.style.pointerEvents = 'none';
			cursor.style.position = 'fixed';
			cursor.style.display = 'flex';
			cursor.style.alignItems = 'center';
			cursor.style.boxSizing = 'border-box';
			cursor.style.overflow = 'hidden';
			cursor.style.whiteSpace = 'pre';
			cursor.style.zIndex = '2147483647';
			session.document.body?.append?.(cursor);
			cursorBlocks.set(session.document, cursor);
		}
		if (!session.caretColorSaved) {
			session.previousCaretColor = session.editor.style.caretColor;
			session.caretColorSaved = true;
		}
		session.editor.style.caretColor = 'transparent';
		const view = session.document.defaultView;
		const editorStyle = view?.getComputedStyle?.(session.editor);
		const background = editorBackground(session.editor, view);
		cursor.style.backgroundColor = isOpaqueColor(editorStyle?.color) ? editorStyle.color : contrastingColor(background);
		cursor.style.color = background;
		for (const property of ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'fontVariant']) {
			if (editorStyle?.[property]) cursor.style[property] = editorStyle[property];
		}
		cursor.textContent = visual.text || '\u00a0';
		cursor.style.left = `${rect.left}px`;
		cursor.style.top = `${rect.top}px`;
		cursor.style.width = `${width}px`;
		cursor.style.height = `${height}px`;
		cursor.style.lineHeight = `${height}px`;
	};
	const renderSession = session => {
		if (!session?.driver) return;
		const mode = session.driver.mode();
		renderBadge(session.editor, mode, session.sendControl);
		renderCursor(session, mode);
	};

	const destroySession = editor => {
		const session = sessions.get(editor);
		if (!session) return;
		clearCursor(session);
		destroyResource(session.driver);
		destroyResource(session.adapter);
		sessions.delete(editor);
		if (session === activeSession) {
			activeSession = null;
			removeBadge(session.document);
		}
	};

	let activeSession = null;
	const cleanup = () => {
		for (const editor of sessions.keys()) if (!isAttached(editor)) destroySession(editor);
		if (activeSession) {
			const document = activeSession.document;
			if (document.activeElement && !activeSession.editor.contains?.(document.activeElement)) {
				removeBadge(document);
				clearCursor(activeSession);
			}
		}
	};
	const positionActiveUi = () => {
		positionBadge(activeSession?.editor, activeSession?.sendControl);
		if (activeSession?.driver) renderCursor(activeSession, activeSession.driver.mode());
	};

	const ensureSession = (editor, sendControl) => {
		if (!core || sessions.has(editor) || destroyed) return sessions.get(editor);
		if (quarantinedEditors.has(editor)) return null;
		let adapter;
		try {
			adapter = createAdapter(editor, { MutationObserverClass });
			const driver = createDriver(adapter, Promise.resolve(core));
			const session = { editor, document: editor.ownerDocument || rootDocument, adapter, driver: null, sendControl,
				caretColorSaved: false, previousCaretColor: undefined };
			sessions.set(editor, session);
			const activate = readyDriver => {
				if (sessions.get(editor) !== session || destroyed) {
					destroyResource(readyDriver);
					return;
				}
				session.driver = readyDriver;
				if (session.document.activeElement === editor) {
					activeSession = session;
					renderSession(session);
				}
			};
			if (driver && typeof driver.then === 'function') Promise.resolve(driver).then(activate).catch(() => destroySession(editor));
			else activate(driver);
			return session;
		} catch {
			destroyResource(adapter);
			return null;
		}
	};

	const eventWasConsumed = event => Boolean(event?.defaultPrevented || event?.prevented || event?.preventDefaultCalled);
	const isExactNormalCtrlR = event => event?.key === 'r' && event.ctrlKey &&
		!event.altKey && !event.metaKey && !event.shiftKey;
	const activateFocusedComposer = document => {
		const focused = document?.activeElement;
		if (!focused) return;
		const event = { target: focused, composedPath: () => [focused] };
		const details = findOutlookComposerDetails(event, document);
		if (!details) return;
		if (activeSession && activeSession.editor !== details.editor) suspend(activeSession.document);
		const session = ensureSession(details.editor, details.sendControl);
		if (session?.driver) {
			session.sendControl = details.sendControl;
			activeSession = session;
			renderSession(session);
		}
	};

	const handleKeydown = (event, eventDocument = rootDocument) => {
		if (destroyed) return 'pass-through';
		cleanup();
		const details = findOutlookComposerDetails(event, eventDocument);
		if (!details) {
			suspend(eventDocument);
			return 'pass-through';
		}
		if (quarantinedEditors.has(details.editor)) return 'pass-through';
		if (!core) return 'pass-through';
		if ((event.ctrlKey || event.altKey || event.metaKey) && !isExactNormalCtrlR(event)) return 'pass-through';
		if (activeSession && activeSession.editor !== details.editor) suspend(activeSession.document);
		const session = ensureSession(details.editor, details.sendControl);
		if (!session?.driver) return 'pass-through';
		session.sendControl = details.sendControl;
		activeSession = session;
		try {
			const outcome = session.driver.handleKey(event);
			if (outcome !== 'handled' && outcome !== 'rejected' && outcome !== 'pass-through') return 'pass-through';
			renderSession(session);
			return outcome;
		} catch {
			console.warn('[VIM_MODE] Composer session disabled after command failure');
			quarantinedEditors.add(details.editor);
			destroySession(details.editor);
			return eventWasConsumed(event) ? 'handled' : 'pass-through';
		}
	};

	const init = config => {
		if (config?.shortcuts?.vim?.enabled !== true || destroyed || initialized) return;
		initialized = true;
		let coreLoad;
		try { coreLoad = loadCore(); } catch { coreLoad = Promise.reject(); }
		if (coreLoad && typeof coreLoad.then === 'function') {
			Promise.resolve(coreLoad).then(loadedCore => {
				core = loadedCore;
				activateFocusedComposer(rootDocument);
			}).catch(() => console.warn('[VIM_MODE] Vim core failed to load'));
		} else {
			core = coreLoad;
			activateFocusedComposer(rootDocument);
		}
		if (typeof MutationObserverClass === 'function' && rootDocument.body) {
			observer = new MutationObserverClass(cleanup);
			observer.observe(rootDocument.body, { childList: true, subtree: true });
		}
		focusHandler = event => {
			const details = findOutlookComposerDetails(event, rootDocument);
			if (!details) {
				suspend(rootDocument);
				return;
			}
			try {
				activateFocusedComposer(rootDocument);
			} catch {
				suspend(rootDocument);
			}
		};
		if (listenFocus) rootDocument.addEventListener?.('focusin', focusHandler, true);
		const suspendOnDeparture = event => {
			if (!activeSession) return;
			const relatedTarget = event?.relatedTarget;
			const focused = rootDocument.activeElement;
			if ((relatedTarget && activeSession.editor.contains?.(relatedTarget)) ||
				(focused && activeSession.editor.contains?.(focused))) return;
			suspend(rootDocument);
		};
		focusoutHandler = suspendOnDeparture;
		blurHandler = suspendOnDeparture;
		windowBlurHandler = () => suspend(rootDocument);
		rootDocument.addEventListener?.('focusout', focusoutHandler, true);
		rootDocument.addEventListener?.('blur', blurHandler, true);
		selectionHandler = () => {
			if (!activeSession || activeSession.document !== rootDocument) return;
			const selection = rootDocument.getSelection?.();
			if (!selection?.anchorNode || !activeSession.editor.contains?.(selection.anchorNode) ||
				!activeSession.editor.contains?.(selection.focusNode)) suspend(rootDocument);
			else renderSession(activeSession);
		};
		rootDocument.addEventListener?.('selectionchange', selectionHandler, true);
		scrollHandler = positionActiveUi;
		resizeHandler = positionActiveUi;
		rootDocument.addEventListener?.('scroll', scrollHandler, true);
		const view = rootDocument.defaultView || rootDocument;
		view.addEventListener?.('resize', resizeHandler);
		view.addEventListener?.('blur', windowBlurHandler);
	};

	const destroyDocument = document => {
		for (const editor of sessions.keys()) {
			if ((editor.ownerDocument || rootDocument) === document) destroySession(editor);
		}
		removeBadge(document);
		removeCursorBlock(document);
	};
	const suspend = document => {
		for (const session of sessions.values()) {
			if ((session.editor.ownerDocument || rootDocument) === document) {
				(session.driver?.reset || session.driver?.resetGrammar)?.call(session.driver);
				restoreNativeCaret(session);
			}
		}
		if (activeSession?.document === document) activeSession = null;
		removeBadge(document);
		removeCursorBlock(document);
	};

	const destroy = () => {
		if (destroyed) return;
		destroyed = true;
		observer?.disconnect?.();
		if (focusHandler) rootDocument.removeEventListener?.('focusin', focusHandler, true);
		if (focusoutHandler) rootDocument.removeEventListener?.('focusout', focusoutHandler, true);
		if (blurHandler) rootDocument.removeEventListener?.('blur', blurHandler, true);
		if (selectionHandler) rootDocument.removeEventListener?.('selectionchange', selectionHandler, true);
		if (scrollHandler) rootDocument.removeEventListener?.('scroll', scrollHandler, true);
		const view = rootDocument.defaultView || rootDocument;
		if (resizeHandler) view.removeEventListener?.('resize', resizeHandler);
		if (windowBlurHandler) view.removeEventListener?.('blur', windowBlurHandler);
		for (const editor of sessions.keys()) destroySession(editor);
		for (const document of badges.keys()) removeBadge(document);
		for (const document of cursorBlocks.keys()) removeCursorBlock(document);
	};

	return { init, handleKeydown, destroyDocument, suspend, destroy };
}

const singleton = createVimEditing();
singleton.createVimEditing = createVimEditing;
module.exports = singleton;
