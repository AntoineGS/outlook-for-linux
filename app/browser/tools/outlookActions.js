const DISCLOSURE_SELECTORS = [
  'button[aria-expanded]',
  '[role="button"][aria-expanded]',
];
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

function getMessageRows(document) {
  if (!document || typeof document.querySelectorAll !== 'function') {
    logger.debug('Message list is absent');
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
    logger.debug('Message list is absent');
    return [];
  }
  if (candidates.length !== 1) {
    logger.debug('Message list is ambiguous');
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

function activateLabeledControls(roots, labels) {
  const matchesByControl = new Map();
  for (const root of roots) {
    for (const match of getLabeledMatches(root, labels)) {
      const previous = matchesByControl.get(match.control);
      if (!previous || match.rank < previous.rank) matchesByControl.set(match.control, match);
    }
  }
  const matches = [...matchesByControl.values()];
  if (matches.length === 0) {
    logger.debug('Required Outlook control is absent', labels);
    return null;
  }
  const winningRank = Math.min(...matches.map((match) => match.rank));
  const winners = matches.filter((match) => match.rank === winningRank);
  if (winners.length !== 1) {
    logger.debug('Required Outlook control is ambiguous', labels);
    return null;
  }
  winners[0].control.click();
  return winners[0].control;
}

function actionForLabel(name, scope = MAIL_SCOPE_SELECTORS) {
  return (document) => Boolean(activateLabeledControl(document, ACTION_LABELS[name], scope));
}

function search(document) {
  const control = activateLabeledControl(document, ACTION_LABELS.search, SEARCH_SCOPE_SELECTORS);
  if (!control) return false;
  const roots = getActionRoots(document, ['[role="search"]']);
	let textboxes = [...new Set(roots.flatMap((root) => toArray(
		root.querySelectorAll?.('[role="textbox"], [role="searchbox"], input[type="search"]'),
	)))].filter((textbox) => typeof textbox.focus === 'function' && isVisible(textbox));
	if (textboxes.length === 0 && document && typeof document.querySelectorAll === 'function') {
		textboxes = [...new Set(toArray(document.querySelectorAll('[role="searchbox"], input[type="search"]')))]
      .filter((textbox) => typeof textbox.focus === 'function' && isVisible(textbox));
  }
  if (textboxes.length === 1) textboxes[0].focus();
  else logger.debug('Search textbox is absent or ambiguous');
  return true;
}

function getUniqueCommandToolbar(document) {
  const toolbars = getActionRoots(document, ['[role="toolbar"]']).filter(isVisible);
  const candidates = toolbars.filter((toolbar) => {
    const controls = [...new Set(getLabeledMatches(toolbar, ACTION_LABELS.compose)
      .map(({ control }) => control))];
    return controls.length === 1;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function getScopedActionRoots(document) {
  const roots = [];
  const rows = getMessageRows(document);
  const selected = getSelectedRow(document, rows);
  if (selected) roots.push(selected);
  roots.push(...getActionRoots(document, ['[role="region"]']).filter(isVisible));
  const commandToolbar = getUniqueCommandToolbar(document);
  if (commandToolbar) roots.push(commandToolbar);
  return [...new Set(roots)];
}

function scopedActionForLabel(name) {
  return (document) => Boolean(activateLabeledControls(getScopedActionRoots(document), ACTION_LABELS[name]));
}

/**
 * Creates Outlook actions with an injected shortcut replay boundary.
 *
 * @param {{replayShortcut?: (shortcutId: string, event: object) => boolean|string}} options
 * @returns {Record<string, Function>}
 */
function createOutlookActions({ replayShortcut = () => false } = {}) {
  const native = (id, legacy) => function nativeAction(document, event) {
    return event === undefined ? legacy(document) : replayShortcut(id, event);
  };

  const actions = {
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
    sent: actionForLabel('sent', FOLDER_SCOPE_SELECTORS),
    drafts: actionForLabel('drafts', FOLDER_SCOPE_SELECTORS),
    composeMessage: native('compose', actionForLabel('compose')),
    openMessageNewWindow: native('openNewWindow', () => false),
    archiveMessage: native('archive', actionForLabel('archive')),
    permanentlyDeleteMessage: native('permanentDelete', () => false),
    pageUp: native('pageUp', () => false),
    pageDown: native('pageDown', () => false),
    shortcutHelp: native('shortcutHelp', () => false),
    composeNewTab: scopedActionForLabel('composeNewTab'),
    replyNewWindow: scopedActionForLabel('replyNewWindow'),
    replyAllNewWindow: scopedActionForLabel('replyAllNewWindow'),
    forwardNewWindow: scopedActionForLabel('forwardNewWindow'),
    undo: scopedActionForLabel('undo'),
    redo: scopedActionForLabel('redo'),
  };

  actions._test = {
    findLabeledControl,
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
