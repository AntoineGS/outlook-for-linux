const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const product = require("../../app/product");
const { resolveLaunchUrl } = require("../../app/urlHandling");

describe("Outlook launch URL handling", () => {
  it("accepts an Outlook HTTPS URL", () => {
    assert.equal(
      resolveLaunchUrl(["https://outlook.office.com/mail/inbox"], product),
      "https://outlook.office.com/mail/inbox",
    );
  });

  it("maps the Outlook protocol to the default URL", () => {
    assert.equal(resolveLaunchUrl(["msoutlook:"], product), product.defaultUrl);
  });

  it("rejects the obsolete Teams protocol", () => {
    assert.equal(resolveLaunchUrl(["msteams:/meet/abc"], product), null);
  });

  it("rejects lookalike Outlook hosts", () => {
    assert.equal(
      resolveLaunchUrl(["https://outlook.office.com.evil.example/mail"], product),
      null,
    );
  });

  it("rejects unrelated HTTPS hosts", () => {
    assert.equal(resolveLaunchUrl(["https://example.com/"], product), null);
  });
});
