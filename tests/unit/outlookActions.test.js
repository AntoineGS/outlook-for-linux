const test = require('node:test');
const assert = require('node:assert/strict');
const actions = require('../../app/browser/tools/outlookActions');

class Node {
  constructor(tag = 'div', attributes = {}, children = [], text = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.children = children;
    this.textContent = text;
    this.parentElement = null;
    this.focusCount = 0;
    this.clickCount = 0;
    this.scrollCount = 0;
    children.forEach((child) => {
      child.parentElement = this;
    });
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name) {
    return Object.hasOwn(this.attributes, name);
  }

  matches(selector) {
    if (selector === '*') return true;
    if (selector.includes(',')) {
      return selector.split(',').some((part) => this.matches(part.trim()));
    }
    const role = selector.match(/\[role="([^"]+)"\]/)?.[1];
    const selected = selector.match(/\[aria-selected="([^"]+)"\]/)?.[1];
    const label = selector.match(/\[aria-label="([^"]+)"\]/)?.[1];
    const disabled = selector.includes('[aria-disabled="true"]');
    const textbox = selector.includes('[contenteditable="true"]');
    const searchInput = selector.includes('[type="search"]');
    const hasLabel = selector === '[aria-label]';
    const tag = selector.match(/^[a-z]+/i)?.[0];
    return (!tag || this.tagName === tag.toUpperCase())
      && (!hasLabel || this.hasAttribute('aria-label'))
      && (!role || this.getAttribute('role') === role)
      && (!selected || this.getAttribute('aria-selected') === selected)
      && (!label || this.getAttribute('aria-label') === label)
      && (!disabled || this.getAttribute('aria-disabled') === 'true')
      && (!textbox || this.getAttribute('contenteditable') === 'true')
      && (!searchInput || this.getAttribute('type') === 'search');
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (node.matches(selector)) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return nodeList(matches);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  focus() {
    this.focusCount += 1;
  }

  click() {
    this.clickCount += 1;
  }

  scrollIntoView() {
    this.scrollCount += 1;
  }
}

const nodeList = (items) => ({
  ...Object.fromEntries(items.map((item, index) => [index, item])),
  length: items.length,
  [Symbol.iterator]: function* iterator() {
    yield* items;
  },
});

const option = (label, selected = 'false') => new Node('div', {
  role: 'option',
  'aria-label': label,
  'aria-selected': selected,
});

const documentWith = (...roots) => ({
  activeElement: null,
  querySelectorAll: (selector) => nodeList(roots.flatMap((root) => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll(selector)),
  ])),
  querySelector: (selector) => roots.flatMap((root) => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll(selector)),
  ])[0] ?? null,
});

test('moves to the next and previous message within the semantic mail list', () => {
  const rows = [option('Read first'), option('Unread second', 'true'), option('Read third')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, rows);
  const document = documentWith(list);

  assert.equal(actions.nextMessage(document), true);
  assert.equal(rows[2].clickCount, 1);
  assert.equal(actions.previousMessage(document), true);
  assert.equal(rows[0].clickCount, 1);
});

test('moves to first and last rendered message and reports rendered boundaries', () => {
  const rows = [option('Read first'), option('Read second', 'true'), option('Read last')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Messages' }, rows);
  const document = documentWith(list);

  assert.equal(actions.firstMessage(document), true);
  assert.equal(rows[0].clickCount, 1);
  assert.equal(actions.lastMessage(document), true);
  assert.equal(rows[2].clickCount, 1);
  rows.forEach((row) => {
    row.attributes['aria-selected'] = 'false';
  });
  rows[2].attributes['aria-selected'] = 'true';
  assert.equal(actions.nextMessage(document), false);
});

test('message movement ignores listboxes inside search contexts while activating the message list', () => {
  const messageRows = [option('Read message', 'true'), option('Unread next')];
  const messageList = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, messageRows);
  const picker = new Node('div', { role: 'listbox', 'aria-label': 'People picker' }, [option('Read picker')]);
  const search = new Node('div', { role: 'search' }, [picker]);

  assert.equal(actions.nextMessage(documentWith(messageList, search)), true);
  assert.equal(messageRows[1].clickCount, 1);
});

test('message movement rejects an unrelated selected picker listbox', () => {
  const pickerRow = option('Read picker', 'true');
  const secondPickerRow = option('Unread picker');
  const picker = new Node('div', { role: 'listbox', 'aria-label': 'People picker' }, [pickerRow, secondPickerRow]);
  const combobox = new Node('div', { role: 'combobox' }, [picker]);

  assert.equal(actions.nextMessage(documentWith(combobox)), false);
  assert.equal(secondPickerRow.clickCount, 0);
});

test('message movement rejects listboxes inside dialogs', () => {
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, [option('Read dialog', 'true')]);
  const dialog = new Node('div', { role: 'dialog' }, [list]);

  assert.equal(actions.nextMessage(documentWith(dialog)), false);
});

test('message actions reject listboxes inside native dialogs', () => {
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, [option('Read dialog', 'true')]);
  const dialog = new Node('dialog', {}, [list]);

  assert.equal(actions.nextMessage(documentWith(dialog)), false);
});

test('message actions reject multiple selected rows', () => {
  const rows = [option('Read first', 'true'), option('Read second', 'true'), option('Read third')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail list' }, rows);

  assert.equal(actions.openMessage(documentWith(list)), false);
  assert.equal(actions.nextMessage(documentWith(list)), false);
  assert.equal(rows[0].clickCount + rows[1].clickCount, 0);
});

test('accepts unlabeled semantic rows but rejects active rows outside the accepted list', () => {
  const row = option('Unread message', 'true');
  const list = new Node('div', { role: 'listbox' }, [row]);
  const outside = option('Read unrelated', 'true');
  const document = documentWith(list, outside);
  document.activeElement = outside;

  assert.equal(actions.nextMessage(document), false);
  assert.equal(actions.firstMessage(document), true);
  assert.equal(row.focusCount, 1);
});

test('collapses and expands the selected conversation', () => {
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [disclosure]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), true);
  assert.equal(disclosure.clickCount, 1);
  disclosure.attributes['aria-expanded'] = 'false';
  assert.equal(actions.expandConversation(document), true);
  assert.equal(disclosure.clickCount, 2);
});

test('activates exact visible mail controls and refuses duplicate winners', () => {
  const archive = new Node('button', { 'aria-label': 'Archive' });
  const toolbar = new Node('div', { role: 'toolbar' }, [archive]);
  const document = documentWith(toolbar);

  assert.equal(actions.archive(document), true);
  assert.equal(archive.clickCount, 1);

  const duplicate = documentWith(
    new Node('div', { role: 'toolbar' }, [new Node('button', { 'aria-label': 'Delete' })]),
    new Node('div', { role: 'main' }, [new Node('button', { 'aria-label': 'Delete' })]),
  );
  assert.equal(actions.deleteMessage(duplicate), false);
});

test('ignores hidden and disabled controls and prefers an exact label over descendant text', () => {
  const hidden = new Node('button', { 'aria-label': 'Archive', hidden: '' });
  const disabled = new Node('button', { 'aria-label': 'Archive', disabled: '' });
  const label = new Node('span', {}, [], 'Archive');
  const exact = new Node('button', { 'aria-label': 'Archive' }, [label]);
  const toolbar = new Node('div', { role: 'toolbar' }, [hidden, disabled, exact]);
  const document = documentWith(toolbar);

  assert.equal(actions.archive(document), true);
  assert.equal(exact.clickCount, 1);
  assert.equal(hidden.clickCount, 0);
  assert.equal(disabled.clickCount, 0);
});

test('uses state-specific read and flag labels and scopes folders to navigation', () => {
  const read = new Node('button', { 'aria-label': 'Mark as unread' });
  const flag = new Node('button', { 'aria-label': 'Unflag this message' });
  const inbox = new Node('div', { role: 'treeitem', 'aria-label': 'Inbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [read, flag]);
  const navigation = new Node('nav', { role: 'navigation' }, [inbox]);
  const document = documentWith(toolbar, navigation);

  assert.equal(actions.toggleRead(document), true);
  assert.equal(actions.toggleFlag(document), true);
  assert.equal(actions.inbox(document), true);
  assert.equal(read.clickCount, 1);
  assert.equal(flag.clickCount, 1);
  assert.equal(inbox.clickCount, 1);
});

test('does not activate folder labels outside the folder navigation scope', () => {
  const inbox = new Node('button', { 'aria-label': 'Inbox' });
  const main = new Node('div', { role: 'main' }, [inbox]);

  assert.equal(actions.inbox(documentWith(main)), false);
  assert.equal(inbox.clickCount, 0);
});

test('search activates Outlook search and focuses one visible textbox', () => {
  const search = new Node('button', { 'aria-label': 'Search' });
  const textbox = new Node('input', { role: 'textbox' });
  const root = new Node('div', { role: 'search' }, [search, textbox]);
  const document = documentWith(root);

  assert.equal(actions.search(document), true);
  assert.equal(search.clickCount, 1);
  assert.equal(textbox.focusCount, 1);
});

test('exposes the scoped control resolver and injectable logger', () => {
  const messages = [];
  const customLogger = { debug: (...args) => messages.push(args) };
  const previousLogger = actions._test.setLogger(customLogger);
  const control = new Node('button', { 'aria-label': 'Back' });
  const root = new Node('div', { role: 'main' }, [control]);

  try {
    assert.equal(actions._test.findLabeledControl(root, ['Back']), control);
    assert.equal(actions.back(documentWith(root)), true);
    assert.equal(messages.length, 0);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger), customLogger);
  }
});

test('ranks exact controls globally across roots instead of rejecting a weaker descendant match', () => {
  const descendant = new Node('span', {}, [], 'Delete');
  const weak = new Node('button', {}, [descendant]);
  const exact = new Node('button', { 'aria-label': 'Delete' });

  assert.equal(actions.deleteMessage(documentWith(
    new Node('div', { role: 'toolbar' }, [weak]),
    new Node('div', { role: 'main' }, [exact]),
  )), true);
  assert.equal(weak.clickCount, 0);
  assert.equal(exact.clickCount, 1);
});

test('rejects controls hidden by an ancestor', () => {
  const hiddenAncestor = new Node('div', { 'aria-hidden': 'true' });
  const control = new Node('button', { 'aria-label': 'Archive' });
  hiddenAncestor.children = [control];
  control.parentElement = hiddenAncestor;

  assert.equal(actions.archive(documentWith(new Node('div', { role: 'toolbar' }, [hiddenAncestor]))), false);
  assert.equal(control.clickCount, 0);
});

test('collapse and expand require the selected conversation disclosure state', () => {
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [disclosure]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), true);
  assert.equal(disclosure.clickCount, 1);
  disclosure.attributes['aria-expanded'] = 'false';
  assert.equal(actions.expandConversation(document), true);
  assert.equal(disclosure.clickCount, 2);
  disclosure.attributes['aria-expanded'] = 'true';
  assert.equal(actions.expandConversation(document), false);
});

test('conversation actions require exactly one visible enabled disclosure', () => {
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' });
  const first = new Node('button', { 'aria-expanded': 'true' });
  const duplicate = new Node('div', { role: 'button', 'aria-expanded': 'true' });
  selected.children = [first, duplicate];
  first.parentElement = selected;
  duplicate.parentElement = selected;
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);

  assert.equal(actions.collapseConversation(documentWith(list)), false);
  assert.equal(first.clickCount + duplicate.clickCount, 0);

  const hidden = new Node('button', { 'aria-expanded': 'true', hidden: '' });
  const disabled = new Node('button', { 'aria-expanded': 'true', disabled: '' });
  selected.children = [hidden, disabled];
  hidden.parentElement = selected;
  disabled.parentElement = selected;

  assert.equal(actions.collapseConversation(documentWith(list)), false);
  assert.equal(hidden.clickCount + disabled.clickCount, 0);
});

test('conversation actions return false without a selected conversation', () => {
  const row = option('Read message');
  const disclosure = new Node('button', { 'aria-expanded': 'true' });
  row.querySelector = () => disclosure;
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [row]);
  const document = documentWith(list);

  assert.equal(actions.collapseConversation(document), false);
  assert.equal(actions.expandConversation(document), false);
  assert.equal(disclosure.clickCount, 0);
});

test('openMessage activates the selected rendered row', () => {
  const rows = [option('Read first'), option('Read selected', 'true'), option('Unread last')];
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, rows);

  assert.equal(actions.openMessage(documentWith(list)), true);
  assert.equal(rows[1].clickCount, 1);
});

test('search does not focus a textbox when Search activation fails', () => {
  const textbox = new Node('input', { role: 'textbox' });
  const search = new Node('div', { role: 'search' }, [textbox]);

  assert.equal(actions.search(documentWith(search)), false);
  assert.equal(textbox.focusCount, 0);
});

test('search focuses input type search in the search context after activation', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const textbox = new Node('input', { type: 'search' });
  const search = new Node('div', { role: 'search' }, [searchButton, textbox]);

  assert.equal(actions.search(documentWith(search)), true);
  assert.equal(textbox.focusCount, 1);
});

test('search prefers role searchbox and never focuses a competing generic textbox outside search', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const searchbox = new Node('input', { role: 'searchbox' });
  const search = new Node('div', { role: 'search' }, [searchbox]);
  const composeTextbox = new Node('input', { role: 'textbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [searchButton, composeTextbox]);

  assert.equal(actions.search(documentWith(toolbar, search)), true);
  assert.equal(searchbox.focusCount, 1);
  assert.equal(composeTextbox.focusCount, 0);
});

test('search does not fall back to a generic textbox outside a search landmark', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const composeTextbox = new Node('input', { role: 'textbox' });
  const toolbar = new Node('div', { role: 'toolbar' }, [searchButton, composeTextbox]);

  assert.equal(actions.search(documentWith(toolbar)), true);
  assert.equal(composeTextbox.focusCount, 0);
});

test('folder actions activate actionable descendant treeitems', () => {
  const inbox = new Node('div', { role: 'treeitem', 'aria-label': '  INBOX  ' });
  const tree = new Node('div', { role: 'tree' }, [inbox]);

  assert.equal(actions.inbox(documentWith(tree)), true);
  assert.equal(inbox.clickCount, 1);
});

test('mail actions reject navigation scope and duplicate global matches', () => {
  const navigationControl = new Node('button', { 'aria-label': 'Archive' });
  assert.equal(actions.archive(documentWith(
    new Node('div', { role: 'navigation' }, [navigationControl]),
  )), false);

  const first = new Node('button', { 'aria-label': 'Archive' });
  const second = new Node('button', { 'aria-label': 'Archive' });
  assert.equal(actions.archive(documentWith(
    new Node('div', { role: 'toolbar' }, [first]),
    new Node('div', { role: 'region' }, [second]),
  )), false);
  assert.equal(first.clickCount + second.clickCount, 0);
});

function createLegacyControl(label, visible = true) {
  return {
    label,
    clickCalls: 0,
    textContent: label,
    parentElement: null,
    getAttribute(name) {
      return name === 'aria-label' ? label : null;
    },
    getClientRects: () => (visible ? [{}] : []),
    click() {
      this.clickCalls += 1;
    },
    querySelectorAll: () => nodeList([]),
  };
}

function createLegacyRoot(controls) {
  return { querySelectorAll: () => nodeList(controls) };
}

function createLegacyActionDocument(scopes) {
  const roots = Object.fromEntries(Object.entries(scopes).map(([scope, controls]) => [scope, createLegacyRoot(controls)]));
  return {
    querySelectorAll: (selector) => {
      const scope = Object.keys(roots).find((name) => selector.includes(`[role="${name}"]`));
      return nodeList(scope ? [roots[scope]] : []);
    },
  };
}

test('authenticated Outlook search and compose labels resolve exactly', () => {
  const search = createLegacyControl('Search for email, meetings, files and more.');
  const compose = createLegacyControl('New email');
  const document = createLegacyActionDocument({ toolbar: [search, compose] });

  assert.equal(actions.search(document), true);
  assert.equal(actions.compose(document), true);
  assert.equal(search.clickCalls, 1);
  assert.equal(compose.clickCalls, 1);
});

test('search focuses its semantic search textbox instead of a compose textbox', () => {
  const search = createLegacyControl('Search');
  const searchTextbox = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const composeTextbox = { focusCalls: 0, focus() { this.focusCalls += 1; } };
  const searchRoot = createLegacyRoot([search]);
  searchRoot.querySelectorAll = (selector) => selector.includes('textbox')
    ? nodeList([searchTextbox]) : nodeList([search]);
  const composeRoot = createLegacyRoot([composeTextbox]);
  const document = {
    querySelectorAll: (selector) => selector === '[role="search"]'
      ? nodeList([searchRoot]) : selector === '[role="toolbar"]' ? nodeList([composeRoot]) : nodeList([]),
  };

  assert.equal(actions.search(document), true);
  assert.equal(searchTextbox.focusCalls, 1);
  assert.equal(composeTextbox.focusCalls, 0);
});

test('search resolves its semantic search landmark', () => {
  const search = createLegacyControl('Search');
  const document = createLegacyActionDocument({ search: [search] });

  assert.equal(actions.search(document), true);
  assert.equal(search.clickCalls, 1);
});

test('folder actions resolve Inbox, Sent Items, and Drafts only in folder scope', () => {
  for (const [action, label] of [['inbox', 'Inbox'], ['sent', 'Sent Items'], ['drafts', 'Drafts']]) {
    const outside = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [outside] })), false);
    assert.equal(outside.clickCalls, 0);

    const folder = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ navigation: [folder] })), true);
    assert.equal(folder.clickCalls, 1);
  }
});

test('folder actions resolve exact descendant names on treeitems', () => {
  const name = createLegacyControl('Inbox');
  const treeitem = createLegacyControl('Inbox selected 35 unread');
  treeitem.querySelectorAll = () => nodeList([name]);

  assert.equal(actions.inbox(createLegacyActionDocument({ tree: [treeitem] })), true);
  assert.equal(treeitem.clickCalls, 1);
});

test('mail actions require mail scope and reject ambiguity across scopes', () => {
  for (const [action, label] of [
    ['reply', 'Reply'], ['replyAll', 'Reply all'], ['forward', 'Forward'],
    ['archive', 'Archive'], ['toggleFlag', 'Flag'], ['back', 'Back'], ['compose', 'New mail'],
  ]) {
    const navigation = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ navigation: [navigation] })), false);
    assert.equal(navigation.clickCalls, 0);

    const toolbar = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [toolbar] })), true);
    assert.equal(toolbar.clickCalls, 1);

    const first = createLegacyControl(label);
    const second = createLegacyControl(label);
    assert.equal(actions[action](createLegacyActionDocument({ toolbar: [first], region: [second] })), false);
    assert.equal(first.clickCalls + second.clickCalls, 0);
  }
});

test('diagnostics distinguish absent and ambiguous controls and message lists', () => {
  const messages = [];
  const previousLogger = actions._test.setLogger({ debug(...args) { messages.push(args.join(' ')); } });
  try {
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [] })), false);
    const first = createLegacyControl('Delete');
    const second = createLegacyControl('Delete');
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [first], region: [second] })), false);
    assert.equal(messages.length, 2);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger).debug instanceof Function, true);
  }
});

test('visibility rejects ARIA-hidden, inert, disabled, and computed-style-hidden controls', () => {
  for (const attribute of ['aria-hidden', 'inert', 'disabled']) {
    const control = createLegacyControl('Delete');
    control.getAttribute = (name) => name === 'aria-label' ? 'Delete'
      : name === attribute ? (attribute === 'aria-hidden' ? 'true' : '') : null;
    assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [control] })), false);
  }

  const ancestor = { parentElement: null };
  const control = createLegacyControl('Delete');
  control.parentElement = ancestor;
  control.ownerDocument = {
    defaultView: { getComputedStyle: (node) => node === ancestor
      ? { display: 'none', visibility: 'visible' }
      : { display: 'block', visibility: 'visible' } },
  };
  assert.equal(actions.deleteMessage(createLegacyActionDocument({ toolbar: [control] })), false);
});

test('message navigation rejects an active option outside the accepted rendered rows', () => {
  const rows = [option('Read first'), option('Read second')];
  const outside = option('Read outside');
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, rows);
  const document = documentWith(list, outside);
  document.activeElement = outside;

  assert.equal(actions.nextMessage(document), false);
  assert.equal(rows[1].clickCount, 0);
});

test('message-list diagnostics distinguish absent and ambiguous candidates', () => {
  const messages = [];
  const previousLogger = actions._test.setLogger({ debug(...args) { messages.push(args.join(' ')); } });
  try {
    assert.equal(actions.nextMessage({ querySelectorAll: () => nodeList([]), activeElement: null }), false);
    const first = new Node('div', { role: 'listbox', 'aria-label': 'Inbox messages' }, [option('Read one', 'true')]);
    const second = new Node('div', { role: 'listbox', 'aria-label': 'Sent mail' }, [option('Read two')]);
    assert.equal(actions.nextMessage(documentWith(first, second)), false);
    assert.deepEqual(messages, ['Message list is absent', 'Message list is ambiguous']);
  } finally {
    assert.equal(actions._test.setLogger(previousLogger).debug instanceof Function, true);
  }
});

test('search refuses to focus when its context has multiple visible textboxes', () => {
  const searchButton = new Node('button', { 'aria-label': 'Search' });
  const first = new Node('input', { role: 'textbox' });
  const second = new Node('input', { type: 'search' });
  const search = new Node('div', { role: 'search' }, [searchButton, first, second]);

  assert.equal(actions.search(documentWith(search)), true);
  assert.equal(first.focusCount + second.focusCount, 0);
});

const ROUTES = [
  ['composeMessage', 'compose'],
  ['openMessageNewWindow', 'openNewWindow'],
  ['archiveMessage', 'archive'],
  ['deleteMessage', 'delete'],
  ['permanentlyDeleteMessage', 'permanentDelete'],
  ['reply', 'reply'],
  ['replyAll', 'replyAll'],
  ['forward', 'forward'],
  ['toggleFlag', 'flag'],
  ['pageUp', 'pageUp'],
  ['pageDown', 'pageDown'],
  ['shortcutHelp', 'shortcutHelp'],
];

const eventFor = (key) => key === '?' ? {
  key,
  keyCode: '/',
  shiftKey: true,
} : { key, keyCode: key.toUpperCase() };

test('factory native routes delegate exactly once and preserve physical pass-through', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });
  const document = documentWith();

  for (const [name] of ROUTES) {
    const event = eventFor(['archiveMessage', 'reply', 'shortcutHelp'].includes(name) ? 'x' : name);
    const result = nativeActions[name](document, event);
    assert.equal(result, true);
  }

  assert.equal(calls.length, ROUTES.length);
  assert.deepEqual(calls.map(([id]) => id), ROUTES.map(([, id]) => id));
});

test('native route methods pass through matching Outlook physical events without replay', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });
  const document = documentWith();

  assert.equal(nativeActions.archiveMessage(document, eventFor('e')), 'pass-through');
  assert.equal(nativeActions.reply(document, eventFor('r')), 'pass-through');
  assert.equal(nativeActions.shortcutHelp(document, eventFor('?')), 'pass-through');
  assert.equal(calls.length, 0);
});

test('native pass-through requires an exact physical modifier set', () => {
  const calls = [];
  const nativeActions = actions.createOutlookActions({
    replayShortcut(id, event) {
      calls.push([id, event]);
      return true;
    },
  });

  assert.equal(nativeActions.archiveMessage(documentWith(), { key: 'e', ctrlKey: true }), true);
  assert.equal(nativeActions.reply(documentWith(), { key: 'r', shiftKey: true }), true);
  assert.equal(nativeActions.shortcutHelp(documentWith(), { key: '?', altKey: true }), true);
  assert.deepEqual(calls.map(([id]) => id), ['archive', 'reply', 'shortcutHelp']);
});

test('scoped controls use the uniquely identified command toolbar', () => {
  const compose = new Node('button', { 'aria-label': 'New mail' });
  const target = new Node('button', { 'aria-label': 'New mail in new window' });
  const distractor = new Node('button', { 'aria-label': 'New mail in new window' });
  const commandToolbar = new Node('div', { role: 'toolbar' }, [compose, target]);
  const otherToolbar = new Node('div', { role: 'toolbar' }, [distractor]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.composeNewTab(documentWith(commandToolbar, otherToolbar), {}), true);
  assert.equal(target.clickCount, 1);
  assert.equal(distractor.clickCount, 0);
});

test('scoped new-window controls use exact labels', () => {
  const controls = [
    ['replyNewWindow', 'Reply in new window'],
    ['replyAllNewWindow', 'Reply all in new window'],
    ['forwardNewWindow', 'Forward in new window'],
  ];
  for (const [action, label] of controls) {
    const control = new Node('button', { 'aria-label': label });
    const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [control]);
    const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
    const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

    assert.equal(nativeActions[action](documentWith(list), {}), true);
    assert.equal(control.clickCount, 1);
  }
});

test('scoped controls reject two command toolbars with compose anchors', () => {
  const firstCompose = new Node('button', { 'aria-label': 'New mail' });
  const secondCompose = new Node('button', { 'aria-label': 'New message' });
  const firstTarget = new Node('button', { 'aria-label': 'New mail in new window' });
  const secondTarget = new Node('button', { 'aria-label': 'New message in new window' });
  const firstToolbar = new Node('div', { role: 'toolbar' }, [firstCompose, firstTarget]);
  const secondToolbar = new Node('div', { role: 'toolbar' }, [secondCompose, secondTarget]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.composeNewTab(documentWith(firstToolbar, secondToolbar), {}), false);
  assert.equal(firstTarget.clickCount + secondTarget.clickCount, 0);
});

test('scoped controls search selected message and reading region but reject ambiguity', () => {
  const selected = new Node('div', { role: 'option', 'aria-selected': 'true' }, [
    new Node('button', { 'aria-label': 'Undo' }),
  ]);
  const list = new Node('div', { role: 'listbox', 'aria-label': 'Mail' }, [selected]);
  const reading = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [
    new Node('button', { 'aria-label': 'Redo' }),
  ]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });
  const document = documentWith(list, reading);

  assert.equal(nativeActions.undo(document, {}), true);
  assert.equal(selected.children[0].clickCount, 1);
  assert.equal(nativeActions.redo(document, { target: reading.children[0] }), true);
  assert.equal(reading.children[0].clickCount, 1);

  const duplicate = new Node('div', { role: 'region', 'aria-label': 'Message reading pane' }, [
    new Node('button', { 'aria-label': 'Undo' }),
  ]);
  assert.equal(nativeActions.undo(documentWith(list, duplicate), { target: duplicate.children[0] }), false);
  assert.equal(duplicate.children[0].clickCount, 0);
});

test('scoped controls reject unrelated visible regions', () => {
  const control = new Node('button', { 'aria-label': 'Undo' });
  const unrelated = new Node('div', { role: 'region', 'aria-label': 'Calendar' }, [control]);
  const nativeActions = actions.createOutlookActions({ replayShortcut: () => true });

  assert.equal(nativeActions.undo(documentWith(unrelated), { target: control }), false);
  assert.equal(control.clickCount, 0);
});
