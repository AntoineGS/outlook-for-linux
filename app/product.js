const MCAS_SUFFIX = ".mcas.ms";

const appHosts = Object.freeze([
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
  "outlook.cloud.microsoft",
]);

const authHosts = Object.freeze([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
]);

function stripMcasSuffix(hostname) {
  return hostname.endsWith(MCAS_SUFFIX)
    ? hostname.slice(0, -MCAS_SUFFIX.length)
    : hostname;
}

function matchesHost(hostname, hosts) {
  const canonical = stripMcasSuffix(hostname.toLowerCase());
  return hosts.includes(canonical);
}

module.exports = Object.freeze({
  id: "outlook-for-linux",
  name: "Outlook for Linux",
  appTitle: "Microsoft Outlook",
  protocol: "msoutlook",
  defaultUrl: "https://outlook.office.com/",
  partition: "persist:outlook-4-linux",
  profilePartitionPrefix: "persist:outlook-profile-",
  settingsFile: "outlook_settings.json",
  settingsChannels: Object.freeze({
    get: "get-outlook-settings",
    set: "set-outlook-settings",
  }),
  appHosts,
  authHosts,
  features: Object.freeze({
    calls: false,
    screenSharing: false,
    presence: false,
    customBackgrounds: false,
    customStickers: false,
    teamsAutomation: false,
    settingsBackup: false,
  }),
  stripMcasSuffix,
  isAppHost: (hostname) => matchesHost(hostname, appHosts),
  isAuthHost: (hostname) => matchesHost(hostname, authHosts),
});
