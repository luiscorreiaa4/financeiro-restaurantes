// Tipos mínimos de fake-reports.mjs para o teste em TypeScript (o tsconfig do web não tem allowJs).
export interface FakeCompany {
  role: "owner" | "manager" | "staff" | "accountant";
}

export interface FakeReportAnswer {
  status: number;
  body: unknown;
}

export function answerReports(method: string, url: string, company: FakeCompany): FakeReportAnswer;
