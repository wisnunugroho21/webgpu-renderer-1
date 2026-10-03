import { createCollectExample } from "./examples/collect";
import { Application } from "./app/Application";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
// Read-only diagnostics plus lifecycle access for the browser regression harness.
Object.assign(window, { rendererApp: app });
let example: { dispose(): void } | undefined;
void app
  .start()
  .then(async () => {
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
    status.textContent = String(error);
    console.error(error);
  });
window.addEventListener(
  "pagehide",
  () => {
    example?.dispose();
    void app.dispose();
  },
  { once: true },
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    example?.dispose();
    void app.dispose();
  });
