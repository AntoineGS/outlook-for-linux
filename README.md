# Outlook for Linux

**Unofficial Microsoft Outlook client for Linux** — a native Electron wrapper around the Outlook web app.

> [!NOTE]
> This is an independent project, not affiliated with Microsoft. Features are limited by the Outlook web app.

This fork is based on [Teams for Linux](https://github.com/IsmaelMartinez/teams-for-linux), whose Electron wrapper and project history are credited here. The application connects to [Microsoft Outlook](https://outlook.office.com/), which remains Microsoft's property and service.

Releases are not yet published. Build the application from source for now.

## Run From Source

```bash
npm install
npm start
```

The application reads user configuration from `~/.config/outlook-for-linux/config.json` and system configuration from `/etc/outlook-for-linux/config.json`. Its Electron profile data is stored in the platform-specific Electron `userData` directory, and settings are kept in `outlook_settings.json` there.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for source setup, tests, and pull request guidance. Please report Outlook-specific issues in this repository with reproducible steps.

## Security & Sandboxing

Electron's contextIsolation and sandbox features are disabled to support Outlook web-app integration. For enhanced security, use system-level sandboxing:

**Available options**:
- **Flatpak**: Built-in isolation when a package becomes available
- **Snap packages**: Application confinement when a package becomes available
- **AppArmor/SELinux**: Most Linux distributions include these by default

System-level sandboxing provides better isolation than Electron's built-in features while preserving full functionality.

## Configuration

Use `~/.config/outlook-for-linux/config.json` for supported settings. Unsupported
legacy Teams settings are ignored with value-safe startup warnings.

### Vim Mode

Vim mode is disabled by default. To enable it, add the following to
`~/.config/outlook-for-linux/config.json`, then restart Outlook for Linux:

```json
{
  "shortcuts": {
    "vim": {
      "enabled": true
    }
  }
}
```

When enabled, a focused Outlook message composer activates editing
automatically and starts in Normal mode. The noninteractive badge next to the
composer reports `NORMAL`, `INSERT`, or `VISUAL`; the text is the source of
truth, not badge color.

| Binding | Outlook action |
| --- | --- |
| `j` / `k` | Select the next / previous message |
| `gg` / `G` | Select the first / last message |
| `h` / `l` | Collapse / expand the selected conversation |
| `Enter` / `o` | Open the selected message |
| `Escape` / `u` | Go back or close the current Outlook view |
| `/` | Focus Outlook search |
| `c` | Compose a new message |
| `r` / `a` / `f` | Reply / reply all / forward |
| `e` / `d` | Archive / delete the selected message |
| `q` / `s` | Toggle read status / flag status |
| `gi` / `gs` / `gd` | Open Inbox / Sent Items / Drafts |

Inside a message composer, the MVP editing grammar is separate from mailbox
navigation:

- Normal motions: `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `^`, `$`, `G`
- Mode changes: `i`, `a`, `I`, `A`, `o`, `O`, `v`, `V`, and `Escape` from Insert
- Edits: `x`, `D`, `C`, `p`, `P`, `u`, `Ctrl-r`, `.`, and operators `d`, `c`, `y`
- Operator motions: the Normal motions above plus `g`; `dw`, `dd`, `cc`, and
  `yy` are supported, as are counts and `gg`

Insert mode passes ordinary text to Outlook and accepts only `Escape` as a Vim
command. Visual mode supports the approved motions and `d`, `c`, or `y`. The
`.` command repeats the latest accepted change at the current cursor.
Modified Outlook shortcuts, including send shortcuts, pass through unchanged;
the one exception is exact `Ctrl-r` in Normal mode. Unsupported printable keys
do nothing in Normal and Visual mode, and incomplete prefixes do not mutate
message content or change mode until the command is complete.

Edits preserve untouched Outlook rich-text markup, while registers and text
inserted from registers are plain text. Commands crossing mentions, images,
attachments, `contenteditable="false"` nodes, or unknown atomic objects are
safe no-ops, including yanks and pastes whose range crosses an atomic object.
Each accepted mutation is preflighted and applied as one native edit. Prefixes
may establish parser or operator state, but do not mutate content or mode until
the command is complete.

The editor is an adapter over Outlook's current DOM rather than a replacement
editor. Outlook can reuse or replace composer nodes, change its markup, or
move controls without notice; in those cases editing fails open to ordinary
Outlook input. Focus the composer again after a DOM replacement if the badge
has disappeared.

Bindings are suspended while focus is in editable, search, or dialog controls.
If Outlook's DOM changes or a required control is missing or ambiguous, the
corresponding action safely does nothing.

## History

Read about the history of this project in the [`HISTORY.md`](HISTORY.md) file.

## License

**GPL-3.0** — See [`LICENSE.md`](LICENSE.md)

Icons from [Icon Duck](https://iconduck.com/sets/hugeicons-essential-free-icons) (CC BY 4.0)
