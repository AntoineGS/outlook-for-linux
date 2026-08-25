const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

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
});
