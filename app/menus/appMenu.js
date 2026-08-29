const { shell } = require("electron");
const buildProfilesMenu = require("./profilesMenu");
const product = require("../product");

exports = module.exports = (Menus) => ({
  label: product.name,
  submenu: [
    {
      label: "Open",
      accelerator: "ctrl+O",
      click: () => Menus.open(),
    },
    {
      label: "Refresh",
      accelerator: "ctrl+R",
      click: () => Menus.reload(),
    },
    ...(process.env.APPIMAGE
      ? [
          {
            label: "Check for Updates",
            click: () => Menus.checkForUpdates(),
          },
        ]
      : []),
    {
      label: "Hide",
      accelerator: "ctrl+H",
      click: () => Menus.hide(),
    },
    {
      label: "Debug",
      submenu: [
        {
          label: "Open DevTools",
          accelerator: "ctrl+D",
          click: () => Menus.debug(),
        },
        {
          label: "Open GPU Info",
          click: () => Menus.showGpuInfo(),
        },
      ],
    },
    {
      type: "separator",
    },
    getSettingsMenu(Menus),
    getAppIconMenu(Menus),
    getPreferencesMenu(),
    getNotificationsMenu(Menus),
    ...(Menus.configGroup.startupConfig.multiAccount?.enabled
      ? [buildProfilesMenu(Menus)].filter(Boolean)
      : []),
    {
      type: "separator",
    },
    {
      label: "About",
      click: () => Menus.about(),
    },
    getHelpMenu(Menus),
    {
      type: "separator",
    },
    {
      label: "Quit (Clear Storage)",
      click: () => Menus.quit(true),
    },
    {
      label: "Quit",
      accelerator: "ctrl+Q",
      click: () => Menus.quit(),
    },
  ],
});

function getSettingsMenu(Menus) {
  return {
    label: "Settings",
    submenu: [
      ...(product.features.settingsBackup
        ? [
            {
              label: "Save",
              click: () => Menus.saveSettings(),
            },
            {
              label: "Restore",
              click: () => Menus.restoreSettings(),
            },
            {
              type: "separator",
            },
          ]
        : []),
      // The startup warning names the deprecated options; this turns that into
      // something the user can act on in one click (ADR-025, #2913).
      //
      // Caught rather than left to float: app/index.js exits the process on any
      // non-network unhandled rejection, so a failing dialog here would take
      // the app down. The reason is not logged, since it can carry local paths.
      {
        label: "Show Updated Config…",
        click: () =>
          Menus.showMigratedConfig().catch(() =>
            console.error("[Config] Could not show the updated config", {
              failed: true,
            }),
          ),
      },
    ],
  };
}

function getAppIconMenu(Menus) {
  const hasCustomIcon = !!Menus.configGroup.startupConfig.appIcon?.trim();
  return {
    label: "App Icon",
    submenu: [
      {
        label: "Choose App Icon…",
        click: () => Menus.chooseAppIcon(),
      },
      {
        label: "Reset to default",
        enabled: hasCustomIcon,
        click: () => Menus.resetAppIcon(),
      },
    ],
  };
}

function getPreferencesMenu() {
  return {
    label: "Zoom",
    submenu: [
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { role: "togglefullscreen" },
    ],
  };
}

function getNotificationsMenu(Menus) {
  return {
    label: "Notifications",
    submenu: [
      {
        label: "Disable All Notifications",
        type: "checkbox",
        checked: Menus.configGroup.startupConfig.disableNotifications,
        click: () => Menus.toggleDisableNotifications(),
      },
      {
        label: "Disable Notifications Sound",
        type: "checkbox",
        checked: Menus.configGroup.startupConfig.disableNotificationSound,
        click: () => Menus.toggleDisableNotificationSound(),
      },
      {
        label: "Disable Sound when Not Available (e.g: busy, in a call)",
        type: "checkbox",
        checked:
          Menus.configGroup.startupConfig
            .disableNotificationSoundIfNotAvailable,
        click: () => Menus.toggleDisableNotificationSoundIfNotAvailable(),
      },
      {
        label: "Disables Window Flash on New Notifications",
        type: "checkbox",
        checked: Menus.configGroup.startupConfig.disableNotificationWindowFlash,
        click: () => Menus.toggleDisableNotificationWindowFlash(),
      },
      {
        label: "Disable Badge Count",
        type: "checkbox",
        checked: Menus.configGroup.startupConfig.disableBadgeCount,
        click: () => Menus.toggleDisableBadgeCount(),
      },
      {
        label: "Urgency",
        submenu: [
          {
            label: "Low",
            type: "checkbox",
            checked:
              Menus.configGroup.startupConfig.defaultNotificationUrgency ===
              "low",
            click: () => Menus.setNotificationUrgency("low"),
          },
          {
            label: "Normal",
            type: "checkbox",
            checked:
              Menus.configGroup.startupConfig.defaultNotificationUrgency ===
              "normal",
            click: () => Menus.setNotificationUrgency("normal"),
          },
          {
            label: "Critical",
            type: "checkbox",
            checked:
              Menus.configGroup.startupConfig.defaultNotificationUrgency ===
              "critical",
            click: () => Menus.setNotificationUrgency("critical"),
          },
        ],
      },
    ],
  };
}

function getHelpMenu(Menus) {
  return {
    label: "Help",
    submenu: [
      {
        label: "Outlook for Linux Documentation",
        click: () => Menus.showDocumentation(),
      },
      {
        type: "separator",
      },
      {
        label: "Online Documentation",
        click: () =>
          shell.openExternal("https://support.microsoft.com/en-us/outlook"),
      },
      {
        label: "Github Project",
        click: () =>
          shell.openExternal(
            "https://github.com/AntoineGS/outlook-for-linux"
          ),
      },
      {
        label: "Microsoft Outlook Support",
        click: () =>
          shell.openExternal(
            "https://support.microsoft.com/en-us/outlook"
          ),
      },
    ],
  };
}

function getVideoMenu(Menus) {
  return {
    label: "Video",
    submenu: [
      {
        label: "Force enable PiP mode for shared screen",
        click: () => {
          Menus.forcePip();
        },
      },
      {
        label: "Force toggle controls for all video elements",
        click: () => {
          Menus.forceVideoControls();
        },
      },
    ],
  };
}
