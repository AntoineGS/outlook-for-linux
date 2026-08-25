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

Bindings are suspended while focus is in editable, search, or dialog controls.
If Outlook's DOM changes or a required control is missing or ambiguous, the
corresponding action safely does nothing.

## History

Read about the history of this project in the [`HISTORY.md`](HISTORY.md) file.

## License

**GPL-3.0** — See [`LICENSE.md`](LICENSE.md)

Icons from [Icon Duck](https://iconduck.com/sets/hugeicons-essential-free-icons) (CC BY 4.0)
