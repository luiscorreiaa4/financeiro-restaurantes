"use client";

import type { FullMe } from "@/lib/api/me-contract";
import { useSettingsScope } from "../shared/use-settings";
import { UnitsScreen } from "./units-screen";

export function UnitsPage({ me }: { me: FullMe }) {
  return <UnitsScreen scope={useSettingsScope(me)} />;
}
