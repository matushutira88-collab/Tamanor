/**
 * Regression coverage for the E2E global-setup selection logic (V1.74 harness hardening): a PUBLIC-only run
 * skips the authenticated DB bootstrap, while any run that includes an authenticated (storageState) project
 * still bootstraps. Pure — imports only the exported helpers from e2e/global-setup.
 */
import { parseSelectedProjects, runNeedsAuthBootstrap } from "../e2e/global-setup";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

const PROJECTS = [
  { name: "public-desktop", use: {} },
  { name: "public-auto-download", use: {} },
  { name: "public-auto-download-mobile", use: {} },
  { name: "auth-desktop", use: { storageState: "e2e/.auth/state.json" } },
  { name: "auth-mobile", use: { storageState: "e2e/.auth/state.json" } },
];

// argv parsing
check("parse --project=x form", JSON.stringify(parseSelectedProjects(["playwright", "test", "--project=public-auto-download"])) === JSON.stringify(["public-auto-download"]));
check("parse --project x form", JSON.stringify(parseSelectedProjects(["--project", "auth-desktop"])) === JSON.stringify(["auth-desktop"]));
check("parse multiple --project", JSON.stringify(parseSelectedProjects(["--project=public-auto-download", "--project=public-auto-download-mobile"])) === JSON.stringify(["public-auto-download", "public-auto-download-mobile"]));
check("parse none", parseSelectedProjects(["test"]).length === 0);

// needs-auth decision
check("public-only auto-download → no auth bootstrap", runNeedsAuthBootstrap(PROJECTS, ["public-auto-download", "public-auto-download-mobile"]) === false);
check("single public project → no auth bootstrap", runNeedsAuthBootstrap(PROJECTS, ["public-desktop"]) === false);
check("an authed project selected → needs auth bootstrap", runNeedsAuthBootstrap(PROJECTS, ["auth-desktop"]) === true);
check("mixed public+authed selected → needs auth bootstrap", runNeedsAuthBootstrap(PROJECTS, ["public-desktop", "auth-mobile"]) === true);
check("no selection (full run) → needs auth bootstrap (authed projects exist)", runNeedsAuthBootstrap(PROJECTS, []) === true);
check("no selection, all-public config → no auth bootstrap", runNeedsAuthBootstrap(PROJECTS.filter((p) => !("storageState" in p.use)), []) === false);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — e2e global-setup selection`);
process.exit(failures === 0 ? 0 : 1);
