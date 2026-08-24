const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const product = require("../../app/product");
const {
  getAuthoritativeSenderUrl,
  isApprovedRendererSource,
} = require("../../app/mainAppWindow/authRecoverySource");

describe("Outlook origin policy integration", () => {
  it("accepts only the product application and authentication hosts", () => {
    for (const hostname of [
      "outlook.office.com",
      "outlook.office365.com",
      "outlook.live.com",
      "outlook.office.com.mcas.ms",
    ]) {
      assert.equal(product.isAppHost(hostname), true, hostname);
    }

    for (const hostname of [
      "login.microsoftonline.com",
      "login.microsoft.com",
      "login.live.com",
    ]) {
      assert.equal(product.isAuthHost(hostname), true, hostname);
    }

    for (const hostname of [
      "outlook.office.com.evil.example",
      "eviloutlook.office.com",
      "attacker.outlook.office.com",
      "attacker.outlook.office.com.mcas.ms",
      "attacker.login.microsoft.com",
      "attacker.login.microsoft.com.mcas.ms",
      "teams.microsoft.com",
      "example.com",
    ]) {
      assert.equal(product.isAppHost(hostname), false, hostname);
      assert.equal(product.isAuthHost(hostname), false, hostname);
    }
  });

  it("requires an exact approved renderer source after MCAS normalization", () => {
    for (const source of [
      undefined,
      "",
      "not a URL",
      "https://outlook.office.com.evil.example/error.js",
      "https://attacker.outlook.office.com/error.js",
      "https://attacker.outlook.office.com.mcas.ms/error.js",
      "https://attacker.login.microsoft.com/error.js",
      "https://attacker.login.microsoft.com.mcas.ms/error.js",
    ]) {
      assert.equal(isApprovedRendererSource(source), false, source);
    }

    for (const source of [
      "https://outlook.office.com/error.js",
      "https://outlook.office.com.mcas.ms/error.js",
      "https://login.microsoftonline.com/error.js",
      "https://login.microsoft.com/error.js",
      "https://login.live.com/error.js",
    ]) {
      assert.equal(isApprovedRendererSource(source), true, source);
    }
  });

  it("uses the Electron sender frame URL rather than renderer payload fields", () => {
    assert.equal(
      getAuthoritativeSenderUrl({
        senderFrame: { url: "https://outlook.office.com/mail" },
        filename: "https://attacker.example/forged.js",
      }),
      "https://outlook.office.com/mail",
    );
    assert.equal(
      getAuthoritativeSenderUrl({
        senderFrame: { url: "https://attacker.outlook.office.com/mail" },
        filename: "https://outlook.office.com/forged.js",
      }),
      "https://attacker.outlook.office.com/mail",
    );
    assert.equal(getAuthoritativeSenderUrl({ filename: "https://outlook.office.com/forged.js" }), null);
    assert.equal(getAuthoritativeSenderUrl({ senderFrame: { url: "not a URL" } }), null);
  });

  it("uses the product policy in main and preload instead of Teams host arrays", () => {
    const mainSource = fs.readFileSync(
      path.join(__dirname, "../../app/mainAppWindow/index.js"),
      "utf8",
    );
    const preloadSource = fs.readFileSync(
      path.join(__dirname, "../../app/browser/preload.js"),
      "utf8",
    );

    assert.match(mainSource, /require\(["']\.\.\/product["']\)/);
    assert.match(preloadSource, /require\(["']\.\.\/product["']\)/);
    assert.doesNotMatch(mainSource, /TEAMS_HOSTS|TEAMS_DOMAINS/);
    assert.doesNotMatch(preloadSource, /TEAMS_HOSTS|TEAMS_DOMAINS/);

    const appSource = fs.readFileSync(
      path.join(__dirname, "../../app/index.js"),
      "utf8",
    );
    const authSource = fs.readFileSync(
      path.join(__dirname, "../../app/mainAppWindow/authRecoverySource.js"),
      "utf8",
    );
    assert.match(authSource, /senderFrame/);
    assert.match(appSource, /getAuthoritativeSenderUrl/);
    assert.doesNotMatch(appSource, /notifyRendererError\([^\n]*errorData\.filename/);
  });
});
