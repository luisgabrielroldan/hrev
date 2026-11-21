// Coverage of the viewer script during the browser tests. make coverage sets HREV_JS_COVERAGE to the output folder.
import { CoverageReport, type CoverageReportOptions } from 'monocart-coverage-reports';

export const coverageEnabled = !!process.env.HREV_JS_COVERAGE;

export const coverageOptions = (): CoverageReportOptions => ({
  name: 'hrev viewer',
  outputDir: process.env.HREV_JS_COVERAGE,
  reports: ['console-summary', 'json-summary', 'html'],
  // Only the viewer sources, not the bundled libraries.
  sourceFilter: (path: string) => path.includes('src/') && !path.includes('node_modules'),
});

export async function globalSetup(): Promise<void> {
  if (coverageEnabled) await new CoverageReport(coverageOptions()).cleanCache();
}

export async function globalTeardown(): Promise<void> {
  if (coverageEnabled) await new CoverageReport(coverageOptions()).generate();
}
