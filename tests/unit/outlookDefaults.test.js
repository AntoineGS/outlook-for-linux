const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const options = require("../../app/config/options");
const { validateConfigFile } = require("../../app/config/validator");

describe("Outlook configuration defaults", () => {
  it("uses Outlook product defaults and exposes the legacy profile option", () => {
    assert.equal(options.appTitle.default, "Microsoft Outlook");
    assert.equal(options.partition.default, "persist:outlook-4-linux");
    assert.equal(options.url.default, "https://outlook.office.com/");
    assert.equal(options.url.describe, "Microsoft Outlook URL");
    assert.equal(options.customUserDir.type, "string");
  });

  it("warns about Teams-only settings without exposing their values", () => {
    const secret = "sensitive-config-value";
    const teamsOnlyConfig = {
      screenSharing: secret,
      awayOnSystemIdle: secret,
      isCustomBackgroundEnabled: secret,
      customStickers: secret,
      enableIncomingCallToast: secret,
      incomingCallCommand: secret,
      meetupJoinRegEx: secret,
      msTeamsProtocols: secret,
      media: secret,
      mqtt: secret,
      quickChat: secret,
    };

    const warnings = validateConfigFile(teamsOnlyConfig, options);

    for (const key of Object.keys(teamsOnlyConfig)) {
      assert.ok(
        warnings.includes(`${key} is ignored by Outlook for Linux`),
        `expected an Outlook compatibility warning for ${key}`,
      );
    }
    assert.ok(!warnings.join("\n").includes(secret));
  });
});
