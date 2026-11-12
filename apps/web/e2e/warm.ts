// Aquecimento do `next dev`: ele compila cada rota na primeira visita, e com vários workers essa
// compilação estoura as esperas de 5 s dos testes (oscilação "de ambiente"). Visitar as rotas uma
// vez antes do spec move a compilação para fora das asserções, sem mudar nenhuma delas. No build
// do CI (`next start`) as rotas já estão compiladas e o aquecimento é só um GET rápido.
const WEB = "http://localhost:3100";
const ROUTES = [
  "/",
  "/lancamentos",
  "/dashboard",
  "/exportacoes",
  "/configuracoes",
  "/perfil",
  "/nova-empresa",
  "/bem-vindo",
  "/acesso-restrito",
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/termos",
];
const CONTEXT = "0190a000-0000-7000-8000-000000000001.all";

export async function warmRoutes() {
  const cookie = `better-auth.session_token=sessao-falsa-warm; fr_ctx=${CONTEXT}`;
  for (const route of ROUTES) {
    try {
      await fetch(`${WEB}${route}`, { headers: { cookie }, redirect: "manual" });
    } catch {
      // Aquecer é só otimização: se falhar, o teste segue e falha pelo motivo real.
    }
  }
}
