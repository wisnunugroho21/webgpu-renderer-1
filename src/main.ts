import { installExample } from "./examples/installExample";
import type { InstalledExample } from "./examples/installExample";
import { Application } from "./app/Application";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
// Read-only diagnostics plus lifecycle access for the browser regression harness.
Object.assign(window, { rendererApp: app });
let example: InstalledExample | undefined;
void app
  .start()
  .then(async () => {
    // Startup owns GPU readiness; example installation owns demonstration selection.
    example = await installExample(
      app,
      new URLSearchParams(location.search).get("example"),
    );
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
