'use strict';

function projectRendererConfig(config = {}) {
  return {
    partition: config.partition,
    frame: config.frame,
    emulateWinChromiumPlatform: config.emulateWinChromiumPlatform,
    useMutationTitleLogic: config.useMutationTitleLogic,
    notificationMethod: config.notificationMethod,
    disableNotifications: config.disableNotifications,
    disableNotificationWindowFlash: config.disableNotificationWindowFlash,
    disableBadgeCount: config.disableBadgeCount,
    notifications: {
      timeoutType: config.notifications?.timeoutType,
    },
    auth: {
      webauthn: {
        enabled: config.auth?.webauthn?.enabled === true,
      },
    },
  };
}

module.exports = { projectRendererConfig };
