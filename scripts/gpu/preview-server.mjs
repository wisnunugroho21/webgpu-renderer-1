import { spawn } from "node:child_process";

/** Start an isolated Vite server and fail explicitly if readiness times out.
 * Callers own shutdown after a successful start; failed starts clean themselves up. */
export async function startPreviewServer(port, preview = true) {
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      ...(preview ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { stdio: "pipe" },
  );
  let output = "";
  let startupError;
  server.on("error", (error) => {
    startupError = error;
  });
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw new Error(output);
      if (output.includes(url)) {
        try {
          if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok)
            return server;
        } catch {
          // Vite can print its address before the socket accepts the first request.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Vite did not become ready at ${url}\n${output}`);
  } catch (error) {
    server.kill("SIGTERM");
    throw error;
  }
}
