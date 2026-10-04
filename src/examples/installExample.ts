import type { Application } from "../app/Application";
import { createCollectExample } from "./collect";

export interface InstalledExample {
  /** Release scene-owned controls and callbacks before disposing the application. */
  dispose(): void;
}

/** Select the browser demonstration after startup; larger examples retain their lazy imports. */
export async function installExample(
  app: Application,
  name: string | null,
): Promise<InstalledExample | undefined> {
  switch (name) {
    case "collect": {
      const example = createCollectExample(app);
      Object.assign(window, { collectGame: example.game });
      return example;
    }
    case "lighting": {
      const { createLightingExample } = await import("./lighting");
      const example = await createLightingExample(app);
      Object.assign(window, { environmentDemoReady: true });
      return example;
    }
    case "shaders": {
      const { createMaterialShaderExample } = await import("./materialShaders");
      const example = await createMaterialShaderExample(app);
      Object.assign(window, { materialShaderDemoReady: true });
      return example;
    }
    default:
      return undefined;
  }
}
