import { LEGAL_VERSIONS } from "@app/core";
import { LegalPage } from "@/components/legal-page";

export const metadata = { title: "Termos de Uso | Finanças para restaurantes" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de Uso" version={LEGAL_VERSIONS.terms}>
      <h2>1. O serviço</h2>
      <p>
        O produto é um controle financeiro gerencial para restaurantes, alimentado por mensagens de
        WhatsApp e consultado em um painel web. Ele não é sistema fiscal: não emite nota fiscal e
        não apura impostos. Estimativas de imposto, quando ativadas, não substituem o contador.
      </p>
      <h2>2. Conta e acesso</h2>
      <p>
        Quem faz o cadastro é o Dono da conta e responde pelos dados informados e pelos usuários que
        convidar. O acesso ao painel é pessoal, por e-mail com código ou senha.
      </p>
      <h2>3. Período de teste</h2>
      <p>
        Toda conta começa em período de teste. Ao fim dele, a conta pode passar a somente leitura
        até a contratação de um plano.
      </p>
      <h2>4. Dados do restaurante</h2>
      <p>
        O restaurante é o controlador dos dados que registra e o produto atua como operador, nos
        termos da LGPD e do Acordo de Tratamento de Dados. O uso dos dados pessoais está descrito na
        Política de Privacidade.
      </p>
      <h2>5. Encerramento</h2>
      <p>
        O Dono pode pedir o encerramento da conta a qualquer momento. Os dados ficam disponíveis por
        um prazo e depois são eliminados ou anonimizados.
      </p>
    </LegalPage>
  );
}
