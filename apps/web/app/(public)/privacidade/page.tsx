import { LEGAL_VERSIONS } from "@app/core";
import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Política de Privacidade | Finanças para restaurantes" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade" version={LEGAL_VERSIONS.privacy}>
      <h2>1. Quais dados tratamos</h2>
      <p>
        Nome, e-mail e celular de quem usa a conta; dados da empresa e das unidades; e as mensagens,
        áudios e fotos enviados pelo WhatsApp para registrar receitas e despesas.
      </p>
      <h2>2. Para que usamos</h2>
      <p>
        Para identificar quem envia cada mensagem, registrar e mostrar os lançamentos, dar acesso ao
        painel e falar com você sobre a conta. Não vendemos dados pessoais.
      </p>
      <h2>3. Com quem compartilhamos</h2>
      <p>
        Com fornecedores que operam o serviço (hospedagem, envio de mensagens e de e-mail,
        interpretação por inteligência artificial), sempre sob contrato e só no necessário.
      </p>
      <h2>4. Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção ou eliminação dos seus dados pessoais, conforme a LGPD,
        falando com o suporte.
      </p>
      <h2>5. Segurança</h2>
      <p>
        Os dados de cada empresa ficam isolados, as senhas nunca são guardadas em texto puro e o
        acesso ao painel exige confirmação por e-mail ou senha.
      </p>
    </LegalPage>
  );
}
