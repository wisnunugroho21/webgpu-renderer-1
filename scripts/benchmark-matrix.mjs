import { startPreviewServer } from "./gpu/preview-server.mjs";
import { runBenchmarkMatrix } from "./gpu/benchmark-scene.mjs";
import { assertBenchmarkReport } from "./gpu/matrix-assertions.mjs";
import { launchValidationBrowser } from "./gpu/validation-browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const server = await startPreviewServer(5188, true);
let browser;
try {
  browser = await launchValidationBrowser();
  const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 2,
    }),
    errors = [];
  page.on("pageerror", (error) =>
    /** Delegates this operation to errors.push. */ errors.push(error.message),
  );
  await page.goto("http://127.0.0.1:5188");
  await page.waitForFunction(
    () =>
      /** Evaluates the window.rendererApp?.frames >= 3 condition. */ window
        .rendererApp?.frames >= 3,
  );
  const longAnimation = process.argv.includes("--long-animation");
  const report = await page.evaluate(runBenchmarkMatrix, { longAnimation });
  report.environment = {
    browser: await browser.version(),
    timestamp: new Date().toISOString(),
    mode: "production-preview",
    gpu: await page.evaluate(() => {
      // Bind timing evidence to the verified backend rather than only a browser version.
      return globalThis.__gpuValidation;
    }),
  };
  report.pageErrors = errors;
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    longAnimation
      ? "artifacts/benchmark-matrix-long.json"
      : "artifacts/benchmark-matrix.json",
    JSON.stringify(report, null, 2),
  );
  assertBenchmarkReport(report, errors);
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await browser?.close();
  } finally {
    server.kill("SIGTERM");
  }
}
