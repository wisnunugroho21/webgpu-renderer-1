import { createCollectExample } from "./examples/collect";
import { Application } from "./app/Application";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
// Read-only diagnostics plus lifecycle access for the browser regression harness.
Object.assign(window, { rendererApp: app });
let example: ReturnType<typeof createCollectExample> | undefined;
void app
  .start()
  .then(() => {
    if (new URLSearchParams(location.search).get("example") === "collect") {
      example = createCollectExample(app);
      Object.assign(window, { collectGame: example.game });
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
