const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const product = require("../../app/product");
const pkg = require("../../package.json");
const { generateDebianChangelog } = require("../../scripts/generateDebianChangelog");

const root = path.join(__dirname, "..", "..");
const readText = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

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

  it("uses Outlook mail and productivity package keywords", () => {
    assert.deepEqual(pkg.keywords, ["Outlook", "email", "calendar", "productivity"]);
  });

  it("does not enable Teams-only integrations", () => {
    assert.deepEqual(product.features, {
      calls: false,
      screenSharing: false,
      presence: false,
      customBackgrounds: false,
      customStickers: false,
      teamsAutomation: false,
      settingsBackup: false,
    });
  });

  it("keeps AppStream and non-publishing CI metadata consistent", () => {
    const appdataPath = "io.github.AntoineGS.outlook_for_linux.appdata.xml";
    const releaseInfoScript = readText("scripts/generateReleaseInfo.js");
    const appdataUpdateScript = readText("scripts/update-appdata-xml.js");
    const appdata = readText(appdataPath);
    const buildWorkflow = readText(".github/workflows/build.yml");
    const releaseWorkflow = readText(".github/workflows/release-please.yml");
    const issueForm = readText(".github/ISSUE_TEMPLATE/bug_report_form.yml");

    assert.match(releaseInfoScript, new RegExp(appdataPath));
    assert.match(appdataUpdateScript, new RegExp(appdataPath));
    assert.match(buildWorkflow, new RegExp(appdataPath));
    assert.match(
      appdata,
      new RegExp(`<launchable type="desktop-id">${pkg.desktopName}\\.desktop</launchable>`)
    );

    const keywords = [...appdata.matchAll(/<keyword>([^<]+)<\/keyword>/g)].map(
      ([, keyword]) => keyword.trim().toLowerCase()
    );
    assert.ok(keywords.length > 0);
    assert.ok(
      keywords.every((keyword) =>
        /^(microsoft )?(outlook|mail|email|calendar|office|productivity)( (for linux|client|app|application|software))?$/.test(
          keyword
        )
      )
    );

    assert.match(issueForm, /^projects: \[\]$/m);
    assert.match(issueForm, /^assignees: \[\]$/m);

    const artifactNames = [...buildWorkflow.matchAll(/name: ([^\n]+)/g)].map(
      ([, name]) => name.trim()
    );
    assert.ok(
      artifactNames
        .filter((name) => /teams-for-linux|outlook-for-linux/.test(name))
        .every((name) => name.startsWith("outlook-for-linux-"))
    );

    const buildCommands = buildWorkflow
      .split("\n")
      .filter((line) => line.includes("run: npm run dist:"));
    assert.ok(buildCommands.length > 0);
    assert.ok(buildCommands.every((line) => line.includes("--publish never")));

    assert.match(releaseWorkflow, /on:\s+workflow_dispatch:/);
    assert.doesNotMatch(releaseWorkflow, /on:[\s\S]*\n\s+(push|pull_request):/);
  });

  it("generates the Debian changelog from the Outlook AppStream file", async () => {
    const changelog = await generateDebianChangelog(root);

    assert.match(changelog, /^outlook-for-linux \(/m);
    assert.doesNotMatch(changelog, /^teams-for-linux \(/m);
  });

  it("matches exact hosts after MCAS normalization", () => {
    assert.equal(product.stripMcasSuffix("outlook.office.com.mcas.ms"), "outlook.office.com");
    assert.equal(product.stripMcasSuffix("outlook.office.com"), "outlook.office.com");
    assert.equal(product.isAppHost("outlook.office.com"), true);
    assert.equal(product.isAppHost("outlook.cloud.microsoft"), true);
    assert.equal(product.isAppHost("outlook.cloud.microsoft.mcas.ms"), true);
    assert.equal(product.isAppHost("sub.outlook.office.com"), false);
    assert.equal(product.isAppHost("sub.outlook.cloud.microsoft"), false);
    assert.equal(product.isAppHost("outlook.cloud.microsoft.evil.example"), false);
    assert.equal(product.isAppHost("eviloutlook.cloud.microsoft"), false);
    assert.equal(product.isAppHost("deep.sub.outlook.office.com"), false);
    assert.equal(product.isAppHost("outlook.office.com.evil.example"), false);
    assert.equal(product.isAppHost("eviloutlook.office.com"), false);
    assert.equal(product.isAuthHost("login.microsoftonline.com"), true);
    assert.equal(product.isAuthHost("sub.login.microsoftonline.com"), false);
    assert.equal(product.isAuthHost("login.microsoftonline.com.evil.example"), false);
  });
});
