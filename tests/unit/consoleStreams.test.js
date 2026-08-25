const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
  installConsoleStreamErrorHandlers,
} = require("../../app/startup/consoleStreams");

describe("console stream error handling", () => {
  it("consumes EPIPE from stdout and stderr", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();

    installConsoleStreamErrorHandlers(stdout, stderr);

    assert.doesNotThrow(() => stdout.emit("error", { code: "EPIPE" }));
    assert.doesNotThrow(() => stderr.emit("error", { code: "EPIPE" }));
  });

  it("does not hide unexpected stream errors", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const unexpected = Object.assign(new Error("unexpected stream failure"), {
      code: "EIO",
    });

    installConsoleStreamErrorHandlers(stdout, stderr);

    assert.throws(
      () => stdout.emit("error", unexpected),
      (error) => error === unexpected,
    );
    assert.equal(stdout.listenerCount("error"), 0);
  });

  it("does not install duplicate listeners", () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();

    installConsoleStreamErrorHandlers(stdout, stderr);
    installConsoleStreamErrorHandlers(stdout, stderr);

    assert.equal(stdout.listenerCount("error"), 1);
    assert.equal(stderr.listenerCount("error"), 1);
  });

  it("installs console handlers before Electron and configuration startup", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "app", "index.js"),
      "utf8",
    );
    const installIndex = source.indexOf("installConsoleStreamErrorHandlers();");
    const electronIndex = source.indexOf('require("electron")');
    const configIndex = source.indexOf('require("./appConfiguration")');

    assert.ok(installIndex >= 0, "main process installs console stream handlers");
    assert.ok(installIndex < electronIndex, "handlers install before Electron loads");
    assert.ok(installIndex < configIndex, "handlers install before configuration logging");
    assert.doesNotMatch(
      source,
      /process\.stdout\.on\(["']error["'],\s*\(\) => \{\}\);/,
    );
  });
});
