const configuredStreams = new WeakSet();

function installStreamErrorHandler(stream) {
  if (!stream || configuredStreams.has(stream)) return;

  const onError = (error) => {
    if (error?.code === "EPIPE") return;

    stream.removeListener("error", onError);
    configuredStreams.delete(stream);
    if (stream.listenerCount("error") === 0) {
      stream.emit("error", error);
    }
  };

  configuredStreams.add(stream);
  stream.on("error", onError);
}

function installConsoleStreamErrorHandlers(
  stdout = process.stdout,
  stderr = process.stderr,
) {
  installStreamErrorHandler(stdout);
  installStreamErrorHandler(stderr);
}

module.exports = { installConsoleStreamErrorHandlers };
