const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const product = require("../../app/product");
const pkg = require("../../package.json");

describe("Outlook product contract", () => {
  it("preserves the legacy package and profile identity", () => {
    assert.equal(pkg.name, "outlook-for-linux");
    assert.equal(pkg.build.appId, "outlook-for-linux");
    assert.equal(pkg.desktopName, "outlook-for-linux");
    assert.equal(pkg.build.linux.syncDesktopName, true);
    assert.equal(pkg.build.linux.desktop.entry.StartupWMClass, "outlook-for-linux");
    assert.equal(pkg.build.linux.desktop.entry.Name, "Outlook for Linux");
    assert.equal(pkg.build.linux.executableName, "outlook-for-linux");
    assert.equal(product.partition, "persist:outlook-4-linux");
    assert.equal(product.settingsFile, "outlook_settings.json");
  });

  it("defines Outlook runtime identity", () => {
    assert.equal(product.id, "outlook-for-linux");
    assert.equal(product.name, "Outlook for Linux");
    assert.equal(product.appTitle, "Microsoft Outlook");
    assert.equal(product.protocol, "msoutlook");
    assert.equal(product.defaultUrl, "https://outlook.office.com/");
    assert.deepEqual(product.settingsChannels, {
      get: "get-outlook-settings",
      set: "set-outlook-settings",
    });
  });

  it("does not enable Teams-only integrations", () => {
    assert.deepEqual(product.features, {
      calls: false,
      screenSharing: false,
      presence: false,
      customBackgrounds: false,
      customStickers: false,
      teamsAutomation: false,
    });
  });

  it("matches exact hosts and their immediate subdomains", () => {
    assert.equal(
      product.stripMcasSuffix("outlook.office.com.mcas.ms"),
      "outlook.office.com",
    );
    assert.equal(
      product.stripMcasSuffix("outlook.office.com"),
      "outlook.office.com",
    );
    assert.equal(product.isAppHost("outlook.office.com"), true);
    assert.equal(product.isAppHost("sub.outlook.office.com"), true);
    assert.equal(product.isAppHost("deep.sub.outlook.office.com"), false);
    assert.equal(product.isAppHost("outlook.office.com.evil.example"), false);
    assert.equal(product.isAppHost("eviloutlook.office.com"), false);
    assert.equal(product.isAuthHost("login.microsoftonline.com"), true);
    assert.equal(product.isAuthHost("sub.login.microsoftonline.com"), true);
    assert.equal(
      product.isAuthHost("login.microsoftonline.com.evil.example"),
      false,
    );
  });
});
