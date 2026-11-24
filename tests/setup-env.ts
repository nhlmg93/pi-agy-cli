/**
 * Drop this extension's own knobs before any test runs so ambient PI_AGY_CLI_*
 * environment variables cannot leak into unit tests.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("PI_AGY_CLI_")) delete process.env[key];
}
