import { CompanyForm } from "@/features/signup/company-form";

export const metadata = { title: "Criar outra empresa | Finanças para restaurantes" };

export default function RestrictedNewCompanyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold">Criar outra empresa</h1>
        <p className="text-sm text-muted-foreground">
          Você será o dono da empresa nova, com o mesmo e-mail e a mesma senha de hoje.
        </p>
      </div>
      <CompanyForm />
    </div>
  );
}
