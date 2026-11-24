"use client";

import type { FullMe } from "@/lib/api/me-contract";
import { useSettingsScope } from "../shared/use-settings";
import { OnboardingScreen } from "./onboarding-screen";

export function OnboardingPage({ me }: { me: FullMe }) {
  return <OnboardingScreen scope={useSettingsScope(me)} />;
}
