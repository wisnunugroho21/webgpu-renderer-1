import { assertSurfaceReport } from "./assertions/surface.mjs";
import { assertDeformationReport } from "./assertions/deformation.mjs";
import { assertLightingReport } from "./assertions/lighting.mjs";
import { assertVisibilityReport } from "./assertions/visibility.mjs";
import { assertAssetAndTemporalReport } from "./assertions/assets-and-temporal.mjs";
/** Keep scenario assertions in dependency order; the first failed prerequisite stops validation. */
export function assertRegressionReport(
  report,
  pageErrors,
  workerChecks,
  loadingChecks,
) {
  assertSurfaceReport(report, pageErrors);
  assertDeformationReport(report);
  assertLightingReport(report);
  assertVisibilityReport(report);
  assertAssetAndTemporalReport(report, workerChecks, loadingChecks);
}
