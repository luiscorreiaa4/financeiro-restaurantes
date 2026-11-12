import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "../e2e/routes";

const APP_DIR = join(__dirname, "..", "app", "(app)");

function pagesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pagesUnder(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

// `app/(app)/lancamentos/page.tsx` -> `/lancamentos`; `app/(app)/page.tsx` -> `/`.
function routeOf(file: string): string {
  const dir = relative(APP_DIR, join(file, ".."));
  const segments = dir.split(sep).filter((s) => s !== "" && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`;
}

describe("lista de rotas do E2E (A6)", () => {
  it("tem exatamente as páginas do grupo (app) que existem no disco", () => {
    const onDisk = pagesUnder(APP_DIR).map(routeOf).sort();
    expect([...APP_ROUTES].sort()).toEqual(onDisk);
  });
});
