import { Application } from "./app/Application";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const app = new Application(canvas, status);
// Read-only diagnostics plus lifecycle access for the browser regression harness.
Object.assign(window, { rendererApp: app });
void app.start().catch((error) => {
  status.textContent = String(error);
  console.error(error);
});
window.addEventListener("pagehide", () => app.dispose(), { once: true });
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
