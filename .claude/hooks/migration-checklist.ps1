# Hook PostToolUse (Edit|Write): lembra o checklist de tabela nova ao editar migration SQL.
# Nunca falha nem trava: qualquer problema termina com exit 0.
$ErrorActionPreference = 'Continue'
try {
  $raw = [Console]::In.ReadToEnd()
  $file = ($raw | ConvertFrom-Json).tool_input.file_path
  if (-not $file) { exit 0 }
  $norm = $file -replace '\\', '/'
  if ($norm -notmatch 'packages/db/migrations/[^/]+\.sql$') { exit 0 }
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { exit 0 }
  $text = Get-Content -LiteralPath $file -Raw
  if ($text -notmatch '(?i)ADD COLUMN|CREATE TABLE') { exit 0 }
  $msg = 'Migration com ADD COLUMN ou CREATE TABLE: siga o checklist de .claude/rules/tabela-nova.md (FORCE RLS, REVOKE/GRANT, politica para app, TABLES e insertsFor em fixtures.ts, contagem em schema.test.ts, docs/arquitetura.md, indice parcial e CHECK conferidos no SQL).'
  @{ hookSpecificOutput = @{ hookEventName = 'PostToolUse'; additionalContext = $msg } } | ConvertTo-Json -Compress -Depth 5
} catch { }
exit 0
