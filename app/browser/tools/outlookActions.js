const DISCLOSURE_SELECTORS = [
  'button[aria-expanded]',
  '[role="button"][aria-expanded]',
];
const NATIVE_SHORTCUTS = {
  archive: { keyCode: 'e', modifiers: [] },
  reply: { keyCode: 'r', modifiers: [] },
  shortcutHelp: { keyCode: '/', modifiers: ['shift'] },
};
const ACTION_LABELS = {
  back: ['Back', 'Close'],
  search: ['Search', 'Search for email, meetings, files and more.'],
  compose: ['New mail', 'New message', 'New email'],
  composeNewTab: ['New mail in new window', 'New message in new window'],
  reply: ['Reply'],
  replyAll: ['Reply all'],
  forward: ['Forward'],
  archive: ['Archive'],
  deleteMessage: ['Delete'],
  toggleRead: ['Mark as read', 'Mark as unread'],
  toggleFlag: ['Flag', 'Unflag', 'Flag for follow up', 'Flag this message', 'Unflag this message'],
  inbox: ['Inbox'],
  sent: ['Sent Items'],
  drafts: ['Drafts'],
  replyNewWindow: ['Reply in new window'],
  replyAllNewWindow: ['Reply all in new window'],
  forwardNewWindow: ['Forward in new window'],
  undo: ['Undo'],
  redo: ['Redo', 'Repeat'],
  flagged: ['Flagged'],
  starred: ['Starred', 'Flagged'],
  snoozed: ['Snoozed'],
  allMail: ['All Mail'],
  tasks: ['Tasks'],
  label: ['Categories/Label', 'Label', 'Categories'],
};
const ACTION_CONTROL_SELECTORS = [
  'button',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="treeitem"]',
  '[role="option"]',
];
const MAIL_SCOPE_SELECTORS = [
  '[role="toolbar"]',
  '[role="option"][aria-selected="true"]',
  '[role="main"]',
  '[role="region"]',
];
const FOLDER_SCOPE_SELECTORS = ['[role="navigation"]', '[role="tree"]'];
const SEARCH_SCOPE_SELECTORS = ['[role="search"]', ...MAIL_SCOPE_SELECTORS];

let logger = {
  debug(...args) {
    console.debug('[VIM_MODE]', ...args);
  },
};

function toArray(value) {
  return value ? Array.from(value) : [];
}

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getAttribute(node, name) {
  return node && typeof node.getAttribute === 'function' ? node.getAttribute(name) : null;
}

function getComputedStyle(node, referenceNode = node) {
  const view = referenceNode && referenceNode.ownerDocument && referenceNode.ownerDocument.defaultView;
  if (view && typeof view.getComputedStyle === 'function') return view.getComputedStyle(node);
  return typeof globalThis.getComputedStyle === 'function' ? globalThis.getComputedStyle(node) : null;
}

function isHidden(node) {
  for (let current = node; current; current = current.parentElement) {
    if (current.hidden || getAttribute(current, 'hidden') !== null
      || getAttribute(current, 'aria-hidden') === 'true' || current.inert
      || getAttribute(current, 'inert') !== null || current.disabled
      || getAttribute(current, 'disabled') !== null || getAttribute(current, 'aria-disabled') === 'true') {
      return true;
    }
    const style = getComputedStyle(current, node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return typeof node.getClientRects !== 'function' ? false : node.getClientRects().length === 0;
}

function isVisible(node) {
  return !isHidden(node);
}

function hasContext(node, roles) {
	for (let current = node; current; current = current.parentElement) {
		if (roles.includes(getAttribute(current, 'role')) || getAttribute(current, 'aria-modal') === 'true'
			|| current.tagName === 'DIALOG') return true;
  }
  return false;
}

function getMessageRows(document, actionId = 'message-list') {
  if (!document || typeof document.querySelectorAll !== 'function') {
    logger.debug(actionId, 'absent');
    return [];
  }
  const candidates = toArray(document.querySelectorAll('[role="listbox"]')).filter((listbox) => {
    if (isHidden(listbox) || hasContext(listbox, ['search', 'combobox', 'dialog'])) return false;
    const rows = toArray(listbox.querySelectorAll?.('[role="option"]'));
    if (rows.length === 0) return false;
    const label = normalizeLabel(getAttribute(listbox, 'aria-label'));
    const hasSemanticLabel = /\b(message|mail|inbox|sent|draft)\b/.test(label);
    const hasMessageRowSemantics = rows.some((row) =>
      /\b(?:unread|read)(?:\s+(?:collapsed|expanded))?\b/.test(normalizeLabel(getAttribute(row, 'aria-label'))));
    return hasSemanticLabel || hasMessageRowSemantics;
  });
  if (candidates.length === 0) {
    logger.debug(actionId, 'absent');
    return [];
  }
  if (candidates.length !== 1) {
    logger.debug(actionId, 'ambiguous');
    return [];
  }
  return toArray(candidates[0].querySelectorAll('[role="option"]')).filter((row) => !isHidden(row));
}

function getSelectedRow(document, rows) {
	const selectedRows = rows.filter((row) => getAttribute(row, 'aria-selected') === 'true');
	if (selectedRows.length > 1) return null;
	if (selectedRows.length === 1) return selectedRows[0];
  const activeElement = document.activeElement;
  const activeRow = activeElement && typeof activeElement.closest === 'function'
    ? activeElement.closest('[role="option"]') : null;
  return rows.includes(activeRow) ? activeRow : null;
}

function selectRow(row) {
  if (!row) return false;
  row.focus({ preventScroll: true });
  row.click();
  row.scrollIntoView({ block: 'nearest' });
  return true;
}

function moveMessage(document, offset) {
  const rows = getMessageRows(document);
  const selectedIndex = rows.indexOf(getSelectedRow(document, rows));
  const targetIndex = selectedIndex + offset;
  if (selectedIndex < 0 || targetIndex < 0 || targetIndex >= rows.length) return false;
  return selectRow(rows[targetIndex]);
}

function getDisclosure(document) {
	const row = getSelectedRow(document, getMessageRows(document));
	if (!row || typeof row.querySelector !== 'function') return null;
	const disclosures = [...new Set(DISCLOSURE_SELECTORS.flatMap((selector) =>
		toArray(row.querySelectorAll?.(selector))))].filter(isVisible);
	return disclosures.length === 1 ? disclosures[0] : null;
}

function setConversationState(document, expanded) {
  const disclosure = getDisclosure(document);
  if (!disclosure || getAttribute(disclosure, 'aria-expanded') !== String(!expanded)) return false;
  disclosure.click();
  return true;
}

function getLabeledMatches(root, labels) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const wanted = new Set(labels.map(normalizeLabel));
  const controls = [...new Set(ACTION_CONTROL_SELECTORS.flatMap((selector) =>
    toArray(root.querySelectorAll(selector))))];
  return controls.flatMap((control) => {
    if (!isVisible(control)) return [];
    const exact = wanted.has(normalizeLabel(getAttribute(control, 'aria-label')))
      || wanted.has(normalizeLabel(control.textContent));
    if (exact) return [{ control, rank: 0 }];
    const childMatch = toArray(control.querySelectorAll?.('*')).some((child) =>
      isVisible(child) && wanted.has(normalizeLabel(child.textContent)));
    return childMatch ? [{ control, rank: 1 }] : [];
  });
}

function findLabeledControl(root, labels) {
  const matches = getLabeledMatches(root, labels);
  const bestRank = Math.min(...matches.map((match) => match.rank));
  const best = matches.filter((match) => match.rank === bestRank);
  return best.length === 1 ? best[0].control : null;
}

function getActionRoots(document, selectors) {
  if (!document || typeof document.querySelectorAll !== 'function') return [];
  return [...new Set(selectors.flatMap((selector) => toArray(document.querySelectorAll(selector))))];
}

function activateLabeledControl(document, labels, selectors = MAIL_SCOPE_SELECTORS) {
  return activateLabeledControls(getActionRoots(document, selectors), labels);
}

function activateLabeledControls(roots, labels, actionId = 'control') {
  const matchesByControl = new Map();
  for (const root of roots) {
    for (const match of getLabeledMatches(root, labels)) {
      const previous = matchesByControl.get(match.control);
      if (!previous || match.rank < previous.rank) matchesByControl.set(match.control, match);
    }
  }
  const matches = [...matchesByControl.values()];
  if (matches.length === 0) {
    logger.debug(actionId, 'absent');
    return null;
  }
  const winningRank = Math.min(...matches.map((match) => match.rank));
  const winners = matches.filter((match) => match.rank === winningRank);
  if (winners.length !== 1) {
    logger.debug(actionId, 'ambiguous');
    return null;
  }
  winners[0].control.click();
  return winners[0].control;
}

function actionForLabel(name, scope = MAIL_SCOPE_SELECTORS) {
  return (document) => Boolean(activateLabeledControls(getActionRoots(document, scope), ACTION_LABELS[name], name));
}

function commandToolbarAction(name) {
  return (document) => {
    const toolbar = getUniqueCommandToolbar(document);
    return Boolean(toolbar && activateLabeledControls([toolbar], ACTION_LABELS[name], name));
  };
}

function search(document) {
  const control = activateLabeledControls(getActionRoots(document, SEARCH_SCOPE_SELECTORS), ACTION_LABELS.search, 'search');
  if (!control) return false;
  const roots = getActionRoots(document, ['[role="search"]']);
  const textboxSelectors = ['[role="textbox"]', '[role="searchbox"]', 'input[type="search"]'];
  let textboxes = [...new Set(roots.flatMap((root) => textboxSelectors.flatMap((selector) =>
    toArray(root.querySelectorAll?.(selector)))))]
    .filter((textbox) => typeof textbox.focus === 'function' && isVisible(textbox));
	if (textboxes.length === 0 && document && typeof document.querySelectorAll === 'function') {
    textboxes = [...new Set(textboxSelectors.slice(1).flatMap((selector) =>
      toArray(document.querySelectorAll(selector))))]
      .filter((textbox) => typeof textbox.focus === 'function' && isVisible(textbox));
  }
  if (textboxes.length === 1) textboxes[0].focus();
  else logger.debug('search', textboxes.length > 1 ? 'ambiguous' : 'absent');
  return true;
}

function getUniqueCommandToolbar(document) {
  const toolbars = getActionRoots(document, ['[role="toolbar"]']).filter(isVisible);
  const candidates = toolbars.filter((toolbar) => {
    if (hasGuardedContext(toolbar)) return false;
    const controls = [...new Set(getLabeledMatches(toolbar, ACTION_LABELS.compose)
      .map(({ control }) => control))];
    return controls.length === 1;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function eventModifiers(event) {
  if (Array.isArray(event?.modifiers)) return event.modifiers.map(String).map((modifier) => modifier.toLowerCase()).sort();
  return [event?.shiftKey && 'shift', event?.ctrlKey && 'control', event?.altKey && 'alt', event?.metaKey && 'cmd']
    .filter(Boolean);
}

function matchesNativeShortcut(id, event) {
  const shortcut = NATIVE_SHORTCUTS[id];
  if (!shortcut) return false;
  const keyCodeFallbacks = { 69: 'e', 82: 'r', 191: '/' };
  const semanticKey = event?.key || keyCodeFallbacks[event?.keyCode] || event?.keyCode;
  const key = String(semanticKey || '').toLowerCase();
  const expectedKey = shortcut.keyCode === '/' && key === '?' ? '/' : key;
  return expectedKey === shortcut.keyCode
    && eventModifiers(event).length === shortcut.modifiers.length
    && eventModifiers(event).every((modifier, index) => modifier === shortcut.modifiers[index]);
}

function isInPath(node, event, document) {
  const path = event?.composedPath?.();
  if (Array.isArray(path) && path.some((entry) => entry === node || containsNode(node, entry))) return true;
  for (let current = event?.target || document?.activeElement; current; current = current.parentElement) {
    if (current === node) return true;
  }
  return false;
}

function isReadingRegion(region, event, document) {
  const label = normalizeLabel(getAttribute(region, 'aria-label'));
  return /\b(?:reading(?:\s+pane)?|message(?:\s+(?:reading|pane|content))?|conversation(?:\s+(?:view|pane|content))?)\b/.test(label)
    && isInPath(region, event, document);
}

function getScopedActionRoots(document, event) {
  const roots = [];
  const rows = getMessageRows(document);
  const selected = getSelectedRow(document, rows);
  if (selected) roots.push(selected);
  roots.push(...getActionRoots(document, ['[role="region"]'])
    .filter((region) => isVisible(region) && isReadingRegion(region, event, document)));
  const commandToolbar = getUniqueCommandToolbar(document);
  if (commandToolbar) roots.push(commandToolbar);
  return [...new Set(roots)];
}

function nodeHasRole(node, roles) {
  return roles.includes(getAttribute(node, 'role')) || node?.tagName === 'DIALOG';
}

function containsNode(root, node) {
  if (!root || !node) return false;
  for (let current = node; current; current = current.parentElement) if (current === root) return true;
  return false;
}

function focusNode(document, event) {
  return event?.target || document?.activeElement || null;
}

function hasGuardedContext(node) {
  for (let current = node; current; current = current.parentElement) {
    if (nodeHasRole(current, ['dialog', 'search', 'combobox'])
      || getAttribute(current, 'contenteditable') === 'true'
      || ['INPUT', 'TEXTAREA'].includes(current.tagName)) return true;
  }
  return false;
}

function uniqueRoots(document, selectors, node, event) {
  return getActionRoots(document, selectors).filter((root) => isVisible(root)
    && (!node || containsNode(root, node) || isInPath(root, event, document)));
}

/**
 * Resolves the semantic mailbox context without relying on global selection alone.
 * Guarded editor/search/dialog roots always win over mailbox roots.
 *
 * @param {object} document browser document-like object
 * @param {object} event keyboard event-like object
 * @returns {'guarded'|'multi-selection'|'folder'|'message-list'|'reading'|null}
 */
function resolveContext(document, event) {
  const node = focusNode(document, event);
  const path = event?.composedPath?.() || [];
  if (hasGuardedContext(node) || path.some(hasGuardedContext)) return 'guarded';
  const globalLists = getActionRoots(document, ['[role="listbox"]']).filter((list) => {
    if (isHidden(list) || hasContext(list, ['search', 'combobox', 'dialog'])) return false;
    const rows = toArray(list.querySelectorAll?.('[role="option"]'));
    return rows.length > 0 && (/\b(?:message|mail|inbox|sent|draft)\b/.test(normalizeLabel(getAttribute(list, 'aria-label')))
      || rows.some((row) => /\b(?:unread|read)\b/.test(normalizeLabel(getAttribute(row, 'aria-label')))));
  });
  const globalSelected = globalLists.flatMap((list) => toArray(list.querySelectorAll?.('[role="option"]')))
    .filter((row) => getAttribute(row, 'aria-selected') === 'true'
      || toArray(row.querySelectorAll?.('input[type="checkbox"], [role="checkbox"]'))
        .some((checkbox) => getAttribute(checkbox, 'aria-checked') === 'true' || checkbox.checked === true));
  if (globalSelected.length > 1) return 'multi-selection';
  if (globalLists.length > 1) return null;
  const active = document?.activeElement;
  if (event?.target && active && event.target !== active) {
    const semanticRoots = [
      ...getActionRoots(document, FOLDER_SCOPE_SELECTORS),
      ...getActionRoots(document, ['[role="listbox"]']),
      ...getActionRoots(document, ['[role="region"]']).filter((region) => isReadingRegion(region, event, document)),
    ];
    const eventRoot = semanticRoots.find((root) => containsNode(root, event.target));
    const activeRoot = semanticRoots.find((root) => containsNode(root, active));
    if (eventRoot && activeRoot && eventRoot !== activeRoot) return null;
  }
  const folders = uniqueRoots(document, FOLDER_SCOPE_SELECTORS, node, event);
  const lists = uniqueRoots(document, ['[role="listbox"]'], node, event)
    .filter((list) => toArray(list.querySelectorAll?.('[role="option"]')).some((row) =>
      /\b(?:unread|read)(?:\s+(?:collapsed|expanded))?\b/.test(normalizeLabel(getAttribute(row, 'aria-label')))
      || /\b(?:message|mail|inbox|sent|draft)\b/.test(normalizeLabel(getAttribute(list, 'aria-label')))));
  const readings = uniqueRoots(document, ['[role="region"]'], node, event)
    .filter((region) => isReadingRegion(region, event, document));
  const candidates = [folders, lists, readings].filter((roots) => roots.length > 0);
  if (candidates.length > 1 || candidates.some((roots) => roots.length > 1)) return null;
  if (lists.length === 1) {
    const rows = toArray(lists[0].querySelectorAll?.('[role="option"]'));
    const selected = rows.filter((row) => getAttribute(row, 'aria-selected') === 'true');
    if (selected.length > 1) return 'multi-selection';
    return 'message-list';
  }
  if (folders.length === 1) return 'folder';
  if (readings.length === 1) return 'reading';
  return null;
}

function replayFor(replayShortcut, id, document, event, legacy) {
  if (event === undefined) return legacy(document);
  return replayShortcut(id, event);
}

function selectedState(row) {
  const tokens = normalizeLabel(getAttribute(row, 'aria-label')).split(/[^a-z]+/).filter(Boolean);
  const read = tokens.includes('unread') ? false : tokens.includes('read') ? true : null;
  const flagged = tokens.includes('flagged') ? true : tokens.includes('unflagged') || tokens.includes('unstarred') ? false : null;
  return { read, flagged };
}

function rowCheckbox(row) {
  const controls = toArray(row?.querySelectorAll?.('input[type="checkbox"], [role="checkbox"]'));
  if (controls.length !== 1) return { control: null, status: controls.length ? 'ambiguous' : 'absent' };
  const control = controls[0];
  if (!isVisible(control) || control.disabled || getAttribute(control, 'aria-disabled') === 'true') {
    return { control: null, status: 'absent' };
  }
  return { control, status: null };
}

function selectMatchingRows(document, predicate, actionId) {
  const rows = getMessageRows(document, actionId);
  const pending = [];
  for (const row of rows) {
    const state = selectedState(row);
    if (!predicate(row, state)) continue;
    const checkbox = rowCheckbox(row);
    if (checkbox.status) {
      logger.debug(actionId, checkbox.status);
      return false;
    }
    if (getAttribute(checkbox.control, 'aria-checked') !== 'true' && checkbox.control.checked !== true) {
      pending.push(checkbox.control);
    }
  }
  let changed = false;
  for (const checkbox of pending) {
    checkbox.click();
    changed = true;
  }
  return changed;
}

function clearMultiSelection(document) {
  const rows = getActionRoots(document, ['[role="listbox"]']).flatMap((list) =>
    toArray(list.querySelectorAll?.('[role="option"]')))
    .filter((row) => getAttribute(row, 'aria-selected') === 'true'
      || rowCheckbox(row).control && (getAttribute(rowCheckbox(row).control, 'aria-checked') === 'true'
        || rowCheckbox(row).control.checked === true));
  let changed = false;
  for (const row of rows) {
    const checkbox = rowCheckbox(row).control;
    if (checkbox && getAttribute(checkbox, 'aria-checked') !== 'true' && checkbox.checked !== true) continue;
    checkbox?.click();
    changed = Boolean(checkbox) || changed;
  }
  return changed;
}

function contextControl(document, labels, event) {
  const reading = getActionRoots(document, ['[role="region"]'])
    .filter((region) => isVisible(region) && isReadingRegion(region, event, document));
  return activateLabeledControls(reading, labels);
}

function activeReadingRoots(document, event) {
  return getActionRoots(document, ['[role="region"]'])
    .filter((region) => isVisible(region) && isReadingRegion(region, event, document));
}

function isContextSignal(document, event) {
  return Boolean(event?.target || document?.activeElement
    || event?.composedPath?.()?.some(Boolean));
}

function isToolbarSurface(document, event) {
  const target = focusNode(document, event);
  return getActionRoots(document, ['[role="toolbar"]']).some((toolbar) =>
    isVisible(toolbar) && containsNode(toolbar, target) && !hasGuardedContext(toolbar));
}

function adjacentConversationMessage(document, event, direction) {
  const roots = activeReadingRoots(document, event);
  if (roots.length !== 1) return false;
  const messages = toArray(roots[0].querySelectorAll?.('[data-message-id], [role="article"]'))
    .filter(isVisible);
  const active = document?.activeElement;
  const current = messages.findIndex((message) => message === active || containsNode(message, active));
  const target = messages[current + direction];
  return current >= 0 && Boolean(target) ? selectRow(target) : false;
}

function scopedActionForLabel(name) {
  return (document, event) => Boolean(activateLabeledControls(getScopedActionRoots(document, event), ACTION_LABELS[name], name));
}

/**
 * Creates Outlook actions with an injected shortcut replay boundary.
 *
 * @param {{replayShortcut?: (shortcutId: string, event: object) => boolean|string}} options
 * @returns {Record<string, Function>}
 */
function createOutlookActions({ replayShortcut = () => false } = {}) {
  const native = (id, legacy) => function nativeAction(document, event) {
    if (event === undefined) return legacy(document);
    if (matchesNativeShortcut(id, event)) return 'pass-through';
    return replayShortcut(id, event);
  };

  const actions = {
    resolveContext,
    nextMessage: (document) => moveMessage(document, 1),
    previousMessage: (document) => moveMessage(document, -1),
    firstMessage: (document) => selectRow(getMessageRows(document)[0]),
    lastMessage: (document) => {
      const rows = getMessageRows(document);
      return selectRow(rows[rows.length - 1]);
    },
    collapseConversation: (document) => setConversationState(document, false),
    expandConversation: (document) => setConversationState(document, true),
    openMessage: (document) => selectRow(getSelectedRow(document, getMessageRows(document))),
    back: actionForLabel('back'),
    search,
    compose: actionForLabel('compose'),
    reply: native('reply', actionForLabel('reply')),
    replyAll: native('replyAll', actionForLabel('replyAll')),
    forward: native('forward', actionForLabel('forward')),
    archive: actionForLabel('archive'),
    deleteMessage: native('delete', actionForLabel('deleteMessage')),
    toggleRead: actionForLabel('toggleRead'),
    toggleFlag: native('flag', actionForLabel('toggleFlag')),
    inbox: actionForLabel('inbox', FOLDER_SCOPE_SELECTORS),
    flagged: actionForLabel('flagged', FOLDER_SCOPE_SELECTORS),
    starred: actionForLabel('starred', FOLDER_SCOPE_SELECTORS),
    snoozed: actionForLabel('snoozed', FOLDER_SCOPE_SELECTORS),
    sent: actionForLabel('sent', FOLDER_SCOPE_SELECTORS),
    drafts: actionForLabel('drafts', FOLDER_SCOPE_SELECTORS),
    allMail: actionForLabel('allMail', FOLDER_SCOPE_SELECTORS),
    tasks: actionForLabel('tasks', FOLDER_SCOPE_SELECTORS),
    label: commandToolbarAction('label'),
    composeMessage: native('compose', actionForLabel('compose')),
    openMessageNewWindow: native('openNewWindow', () => false),
    archiveMessage: native('archive', actionForLabel('archive')),
    permanentlyDeleteMessage: native('permanentDelete', () => false),
    pageUp: native('pageUp', () => false),
    pageDown: native('pageDown', () => false),
    shortcutHelp: native('shortcutHelp', () => false),
    composeNewTab: scopedActionForLabel('composeNewTab'),
    composeMessageNewTab: scopedActionForLabel('composeNewTab'),
    replyNewWindow: scopedActionForLabel('replyNewWindow'),
    replyAllNewWindow: scopedActionForLabel('replyAllNewWindow'),
    forwardNewWindow: scopedActionForLabel('forwardNewWindow'),
    undo: commandToolbarAction('undo'),
    redo: commandToolbarAction('redo'),
  };

  actions.moveRight = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'guarded' || context === null) return false;
    if (context === 'folder') return replayFor(replayShortcut, 'folderExpand', document, event, () => false);
    if (context === 'message-list') {
      const disclosure = getDisclosure(document);
      if (disclosure && getAttribute(disclosure, 'aria-expanded') === 'false') return setConversationState(document, true);
      return selectRow(getSelectedRow(document, getMessageRows(document)));
    }
    return false;
  };
  actions.moveLeft = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'folder') return replayFor(replayShortcut, 'folderCollapse', document, event, () => false);
    if (context !== 'message-list') return false;
    const disclosure = getDisclosure(document);
    if (disclosure && getAttribute(disclosure, 'aria-expanded') === 'true') return setConversationState(document, false);
    return false;
  };
  actions.readContext = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'message-list') {
      const row = getSelectedRow(document, getMessageRows(document));
      const state = selectedState(row);
      if (state.read === null) return false;
      return replayFor(replayShortcut, state.read ? 'markUnread' : 'markRead', document, event, () => false);
    }
    if (context === 'reading') return Boolean(contextControl(document, ['Mark as unread'], event));
    return false;
  };
  actions.escapeContext = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'guarded') return 'pass-through';
    if (context === 'multi-selection') return clearMultiSelection(document);
    return Boolean(activateLabeledControl(document, ACTION_LABELS.back));
  };
  actions.startContext = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'message-list') return replayFor(replayShortcut, 'firstList', document, event, () => selectRow(getMessageRows(document)[0]));
    if (context === 'reading') return replayFor(replayShortcut, 'topMessage', document, event, () => false);
    return false;
  };
  actions.endContext = (document, event) => {
    const context = resolveContext(document, event);
    if (context === 'message-list') {
      const rows = getMessageRows(document);
      return selectRow(rows[rows.length - 1]);
    }
    if (context === 'reading') return replayFor(replayShortcut, 'bottomMessage', document, event, () => false);
    return false;
  };
  actions.selectAll = (document) => selectMatchingRows(document, () => true, 'selectAll');
  actions.selectRead = (document) => selectMatchingRows(document, (_row, state) => state.read === true, 'selectRead');
  actions.selectUnread = (document) => selectMatchingRows(document, (_row, state) => state.read === false, 'selectUnread');
  actions.selectStarred = (document) => selectMatchingRows(document, (_row, state) => state.flagged === true, 'selectStarred');
  actions.selectUnstarred = (document) => selectMatchingRows(document, (_row, state) => state.flagged === false, 'selectUnstarred');
  actions.previousConversationMessage = (document, event) => {
    if (resolveContext(document, event) !== 'reading') return false;
    return Boolean(activateLabeledControls(activeReadingRoots(document, event), ['Previous message', 'Previous'], 'previousConversationMessage'))
      || adjacentConversationMessage(document, event, -1);
  };
  actions.nextConversationMessage = (document, event) => {
    if (resolveContext(document, event) !== 'reading') return false;
    return Boolean(activateLabeledControls(activeReadingRoots(document, event), ['Next message', 'Next'], 'nextConversationMessage'))
      || adjacentConversationMessage(document, event, 1);
  };
  actions.nextPage = (document, event) => {
    const context = resolveContext(document, event);
    return ['message-list', 'reading'].includes(context)
      ? replayFor(replayShortcut, 'pageDown', document, event, () => false) : false;
  };
  actions.previousPage = (document, event) => {
    const context = resolveContext(document, event);
    return ['message-list', 'reading'].includes(context)
      ? replayFor(replayShortcut, 'pageUp', document, event, () => false) : false;
  };
  actions.undoContext = actions.undo;
  actions.redoContext = actions.redo;

  for (const [name, action] of Object.entries(actions)) {
    if (name === 'resolveContext' || name === 'escapeContext' || name === '_test') continue;
    actions[name] = (document, event) => {
      if (event !== undefined && isContextSignal(document, event)) {
        const context = resolveContext(document, event);
        if (context === 'guarded' || (context === null && !isToolbarSurface(document, event))) return false;
      }
      return action(document, event);
    };
  }

  actions._test = {
    findLabeledControl,
    resolveContext,
    setLogger(nextLogger) {
      const previous = logger;
      logger = nextLogger;
      return previous;
    },
  };
  return actions;
}

const actions = createOutlookActions();
actions.createOutlookActions = createOutlookActions;

module.exports = actions;
