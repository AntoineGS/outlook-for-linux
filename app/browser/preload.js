const { ipcRenderer } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const product = require("../product");

const NOTIFICATION_ICON = `data:image/png;base64,${fs
  .readFileSync(path.join(__dirname, "..", "assets", "icons", "icon-96x96.png"))
  .toString("base64")}`;

// Restore native file paths for Outlook-hosted drag/drop and paste uploads.
try {
  const { webUtils } = require("electron");
  // Restore the non-standard `File.path` on every File in a FileList, in place.
  // No-op for blob-backed files (screenshots) since webUtils only resolves a
  // path for files that originated from the OS file list; those are left as-is.
  const restoreFilePaths = (files) => {
    if (!files?.length) {
      return;
    }
    for (const file of files) {
      if (file.path) {
        continue;
      }
      try {
        const path = webUtils.getPathForFile(file);
        if (path) {
          Object.defineProperty(file, "path", {
            value: path,
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
      } catch {
        // leave the file untouched if the path can't be resolved
      }
    }
  };
  globalThis.addEventListener(
    "drop",
    (event) => {
      if (!product.isAppHost(globalThis.location.hostname)) {
        return;
      }
      restoreFilePaths(event.dataTransfer?.files);
    },
    true,
  );
  globalThis.addEventListener(
    "paste",
    (event) => {
      if (!product.isAppHost(globalThis.location.hostname)) {
        return;
      }
      restoreFilePaths(event.clipboardData?.files);
    },
    true,
  );
} catch {
  // webUtils unavailable
}

// Note: IPC validation handled by main process, no need for duplicate validation here
globalThis.electronAPI = {
  showNotification: (options) => {
    if (!options || typeof options !== 'object') {
      return Promise.reject(new Error('Invalid notification options'));
    }
    return ipcRenderer.invoke("show-notification", options);
  },
  playNotificationSound: (options) => {
    if (options && typeof options !== 'object') {
      return Promise.reject(new Error('Invalid sound options'));
    }
    return ipcRenderer.invoke("play-notification-sound", options);
  },
  sendNotificationToast: (data) => {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid notification toast data');
    }
    ipcRenderer.send("notification-show-toast", data);
  },

  setBadgeCount: (count) => {
    if (typeof count !== 'number' || count < 0 || count > 9999) {
      console.error('Invalid badge count:', count);
      return Promise.reject(new Error('Invalid badge count'));
    }
    return ipcRenderer.invoke("set-badge-count", count);
  },

  updateTray: (icon, flash, count) => {
    return ipcRenderer.send("tray-update", { icon, flash, count });
  },

  getZoomLevel: (partition) => {
    if (typeof partition !== 'string' || partition.length > 100) {
      return Promise.reject(new Error('Invalid partition'));
    }
    return ipcRenderer.invoke("get-zoom-level", partition);
  },
  saveZoomLevel: (data) => {
    if (!data || typeof data !== 'object' || typeof data.level !== 'number') {
      return Promise.reject(new Error('Invalid zoom data'));
    }
    return ipcRenderer.invoke("save-zoom-level", data);
  },

  navigateBack: () => ipcRenderer.send("navigate-back"),
  navigateForward: () => ipcRenderer.send("navigate-forward"),
  getNavigationState: () => ipcRenderer.invoke("get-navigation-state"),
  replayOutlookShortcut: (shortcutId) => {
    if (typeof shortcutId !== 'string' || shortcutId.length > 40) {
      return Promise.resolve(false);
    }
    return ipcRenderer.invoke('vim-replay-outlook-shortcut', shortcutId);
  },
  onNavigationStateChanged: (callback) => {
    if (typeof callback !== 'function') {
      console.error('Invalid callback for navigation state changed');
      return;
    }
    return ipcRenderer.on("navigation-state-changed", callback);
  },

  sessionType: process.env.XDG_SESSION_TYPE || "x11",
};

// Outlook keeps unread-count production generic: it updates the existing tray
// and badge IPC APIs without loading the Teams-specific tray renderer module.
let preloadConfig = null;
globalThis.addEventListener("unread-count", (event) => {
  const count = Number.isFinite(event?.detail?.number)
    ? Math.max(0, Math.floor(event.detail.number))
    : 0;
  globalThis.electronAPI.updateTray(
    null,
    count > 0 && !preloadConfig?.disableNotificationWindowFlash,
    count,
  );
  if (!preloadConfig?.disableBadgeCount) {
    globalThis.electronAPI.setBadgeCount(count).catch((error) => {
      console.debug("Preload: Failed to update badge count:", error.message);
    });
  }
});

// Config is fetched asynchronously; the Notification override below reads it via closure
let notificationConfig = null;
ipcRenderer.invoke("get-config").then((config) => {
  notificationConfig = config;
  console.debug("Preload: Config loaded for notifications:", {
    notificationMethod: config?.notificationMethod,
    disableNotifications: config?.disableNotifications
  });
}).catch((err) => {
  console.error("Preload: Failed to load config for notifications:", err);
});

// Create a Notification-like stub so Teams can manage lifecycle without errors.
// Without addEventListener/close/dispatchEvent, Teams' internal state machine
// breaks after the first notification, causing subsequent ones to stop firing.
function createNotificationStub() {
  const stub = {
    onclick: null,
    onclose: null,
    onerror: null,
    onshow: null,
    close() { if (this.onclose) this.onclose(); },
    addEventListener(type, listener) {
      if (type === 'click') this.onclick = listener;
      else if (type === 'close') this.onclose = listener;
      else if (type === 'show') this.onshow = listener;
      else if (type === 'error') this.onerror = listener;
    },
    removeEventListener(type, listener) {
      if (type === 'click' && (!listener || this.onclick === listener)) this.onclick = null;
      else if (type === 'close' && (!listener || this.onclose === listener)) this.onclose = null;
      else if (type === 'show' && (!listener || this.onshow === listener)) this.onshow = null;
      else if (type === 'error' && (!listener || this.onerror === listener)) this.onerror = null;
    },
    dispatchEvent() { return true; },
  };
  // Fire the show event asynchronously like a real Notification
  setTimeout(() => { if (stub.onshow) stub.onshow(); }, 0);
  return stub;
}

function playNotificationSound(notifSound) {
  // Skip renderer-side sound for "electron" method — the main process
  // notification service already plays the sound before showing the notification.
  const method = notificationConfig?.notificationMethod || "web";
  if (method === "electron") {
    return;
  }
  if (globalThis.electronAPI?.playNotificationSound) {
    try {
      console.debug("Requesting application to play sound");
      globalThis.electronAPI.playNotificationSound(notifSound);
    } catch (e) {
      console.debug("playNotificationSound failed", e);
    }
  }
}

function createWebNotification(classicNotification, title, options) {
  const notifSound = {
    type: options.type,
    audio: "default",
    title: title,
    body: options.body,
  };
  playNotificationSound(notifSound);

  // Return actual native notification object (critical for Teams to manage lifecycle)
  console.debug("Continues to default notification workflow");
  if (classicNotification) {
    try {
      return new classicNotification(title, options);
    } catch (err) {
      console.debug("Could not create native notification:", err);
      return null;
    }
  }
  return null;
}

function createElectronNotification(options) {
  const notificationId = crypto.randomUUID();
  const stub = createNotificationStub();
  let closed = false;
  // Bridge the close event from the main process so Teams knows when
  // the system dismisses the notification (e.g. GNOME timeout).
  // Idempotent so stub.close() and the IPC arrival can each trigger it.
  const finalizeClose = () => {
    if (closed) return;
    closed = true;
    ipcRenderer.removeListener("notification-closed", onClosed);
    if (stub.onclose) stub.onclose();
  };
  const onClosed = (_event, closedId) => {
    if (closedId !== notificationId) return;
    finalizeClose();
  };
  stub.close = finalizeClose;
  if (globalThis.electronAPI?.showNotification) {
    ipcRenderer.on("notification-closed", onClosed);
    globalThis.electronAPI
      .showNotification({ ...options, notificationId })
      .catch((e) => {
        ipcRenderer.removeListener("notification-closed", onClosed);
        console.debug("showNotification failed", e);
      });
  }
  return stub;
}

function createCustomNotification(title, options) {
  const notificationData = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    title: title,
    body: options.body || '',
    icon: options.icon,
  };

  const notifSound = {
    type: options.type,
    audio: "default",
    title: title,
    body: options.body,
  };
  playNotificationSound(notifSound);

  try {
    if (globalThis.electronAPI?.sendNotificationToast) {
      globalThis.electronAPI.sendNotificationToast(notificationData);
    } else {
      console.warn("sendNotificationToast API not available");
    }
  } catch (e) {
    console.error("Failed to send custom notification:", e);
  }

  return createNotificationStub();
}

// Override window.Notification immediately before Teams loads
// Using factory function pattern instead of class to avoid "return in constructor" anti-pattern
(function() {

  const classicNotification = globalThis.Notification;

  // Factory function that creates notification objects (avoids "return in constructor" issue)
  function CustomNotification(title, options) {
    // Use config from closure scope (will be null initially, populated async)
    if (notificationConfig?.disableNotifications) {
      // Return dummy object to avoid Teams errors
      return { onclick: null, onclose: null, onerror: null };
    }

    options = options || {};
    options.icon = options.icon || NOTIFICATION_ICON;
    options.title = options.title || title;
    options.type = options.type || "new-message";
    // Default Ubuntu Unity DE auto-closes. Users on GNOME and similar can opt
    // into persistent notifications via `notifications.timeoutType: "never"`
    // (issue #2411). Mirrors Electron's Notification timeoutType.
    options.timeoutType =
      notificationConfig?.notifications?.timeoutType === "never"
        ? "never"
        : "default";
    options.requireInteraction = options.timeoutType === "never";

    // Default to "web" if config not loaded yet
    const method = notificationConfig?.notificationMethod || "web";

    if (method === "custom") {
      return createCustomNotification(title, options);
    }

    if (method === "web") {
      const notification = createWebNotification(classicNotification, title, options);
      return notification || { onclick: null, onclose: null, onerror: null };
    }

    return createElectronNotification(options);
  }

  CustomNotification.requestPermission = async function() {
    return "granted";
  };

  Object.defineProperty(CustomNotification, 'permission', {
    get: function() {
      return "granted";
    }
  });

  globalThis.Notification = CustomNotification;
  console.debug("Preload: CustomNotification factory initialized");
})();

document.addEventListener('DOMContentLoaded', async () => {
  console.debug("Preload: DOMContentLoaded, initializing browser modules...");
  try {
    const config = await ipcRenderer.invoke("get-config");
    preloadConfig = config;
    console.debug("Preload: Got config:", {
      trayIconEnabled: config?.trayIconEnabled,
      useMutationTitleLogic: config?.useMutationTitleLogic
    });
    
    if (config.useMutationTitleLogic) {
      const mutationTitle = require("./tools/mutationTitle");
      mutationTitle.init(config);
    }
    
    // The generic unread-count listener above owns tray and badge IPC updates.

    const modules = [
      { name: "zoom", path: "./tools/zoom" },
      { name: "shortcuts", path: "./tools/shortcuts" },
      { name: "emulatePlatform", path: "./tools/emulatePlatform" },
      { name: "webauthnOverride", path: "./tools/webauthnOverride" },
      { name: "navigationButtons", path: "./tools/navigationButtons" },
      { name: "framelessTweaks", path: "./tools/frameless" },
    ];

    // CRITICAL: These modules need ipcRenderer for IPC communication (see CLAUDE.md)
    const modulesRequiringIpc = new Set(["webauthnOverride"]);

    let successCount = 0;
    for (const module of modules) {
      try {
        const moduleInstance = require(module.path);
        if (modulesRequiringIpc.has(module.name)) {
          moduleInstance.init(config, ipcRenderer);
        } else {
          moduleInstance.init(config);
        }
        successCount++;
      } catch (err) {
        console.error(`Preload: Failed to load ${module.name}:`, err.message);
      }
    }
    
    console.info(`Preload: ${successCount}/${modules.length} browser modules initialized successfully`);

    // Listen for config changes from the main process (e.g., when menu toggles are clicked)
    ipcRenderer.on("config-changed", (_event, configChanges) => {
      for (const [key, value] of Object.entries(configChanges)) {
        config[key] = value;
      }
    });

  } catch (error) {
    console.error("Preload: Failed to initialize browser modules:", error);
  }
});

// Forward unhandled promise rejections and window errors to main for diagnostics.
// Plain objects without a `.message` (and `undefined` rejections) previously stringified to
// the literals "[object Object]" / "undefined", which discarded all diagnostic content.
function serializeRejectionReason(reason) {
  // The whole body is wrapped in try/catch so a throwing `reason.message`
  // getter (or any other unexpected exception) degrades to a sentinel
  // string instead of propagating to the outer handler and dropping the
  // whole rejection payload.
  try {
    if (reason === undefined) return "<undefined>";
    if (reason === null) return "<null>";
    if (typeof reason === "string") return reason;
    if (typeof reason !== "object") return String(reason);
    if (typeof reason.message === "string" && reason.message.length > 0) return reason.message;
    const seen = new WeakSet();
    return JSON.stringify(reason, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    }) ?? "[unserializable rejection]";
  } catch {
    return "[unserializable rejection]";
  }
}

try {
  globalThis.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event?.reason;
      const errorData = {
        message: serializeRejectionReason(reason).substring(0, 1000),
        stack: reason?.stack ? String(reason.stack).substring(0, 5000) : null,
        timestamp: Date.now(),
      };

      ipcRenderer.send("unhandled-rejection", errorData);
    } catch (err) {
      console.debug("Unhandled rejection forwarding failed:", err);
      // Best-effort forwarding, never throw from preload
    }
  });

  globalThis.addEventListener("error", (event) => {
    try {
      const errorData = {
        message: event?.message ? String(event.message).substring(0, 1000) : '',
        filename: event?.filename ? String(event.filename).substring(0, 200) : '',
        lineno: typeof event?.lineno === 'number' ? event.lineno : 0,
        colno: typeof event?.colno === 'number' ? event.colno : 0,
        timestamp: Date.now(),
        errorStack: event?.error?.stack ? String(event.error.stack).substring(0, 5000) : null,
      };
      
      ipcRenderer.send("window-error", errorData);
    } catch (err) {
      console.debug("Window error forwarding failed:", err);
    }
  });
} catch (err) {
  console.debug("Error handler setup failed:", err);
}
