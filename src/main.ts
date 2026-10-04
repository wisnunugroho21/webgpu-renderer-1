import { createCollectExample } from "./examples/collect";
import { Application } from "./app/Application";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
// Read-only diagnostics plus lifecycle access for the browser regression harness.
Object.assign(window, { rendererApp: app });
let example:
  | {
      /** Releases this owner or scene lifetime according to its independent ownership contract. */
      dispose(): void;
    }
  | undefined;
void app
  .start()
  .then(async () => {
    // Installs the requested collection/lighting example only after application startup succeeds.

    if (new URLSearchParams(location.search).get("example") === "collect") {
      const collect = createCollectExample(app);
      example = collect;
      Object.assign(window, { collectGame: collect.game });
    } else if (
      new URLSearchParams(location.search).get("example") === "lighting"
    ) {
      const { createLightingExample } = await import("./examples/lighting");
      example = await createLightingExample(app);
      Object.assign(window, { environmentDemoReady: true });
    }
  })
  .catch((error) => {
    // Reports startup/example failure in the status output and developer console.

    status.textContent = String(error);
    console.error(error);
  });
window.addEventListener(
  "pagehide",
  () => {
    // Releases example-owned input and application GPU resources when the page is left.

    example?.dispose();
    void app.dispose();
  },
  { once: true },
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    // Releases example controls and the application when the development module is replaced.

    example?.dispose();
    void app.dispose();
  });
