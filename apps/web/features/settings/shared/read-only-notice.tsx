/** Aviso de quem só consulta: o formulário abre sem botões de gravar (RF04.CA05). */
export function ReadOnlyNotice({ reason }: { reason?: string }) {
  return (
    <p role="note" className="rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
      {reason ?? "Você só pode consultar este cadastro. Quem altera é o dono da empresa."}
    </p>
  );
}
