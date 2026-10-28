# Hook PostToolUse (Edit|Write): formata com Biome o arquivo recém-editado.
# Nunca falha nem trava: qualquer problema termina com exit 0.
$ErrorActionPreference = 'Continue'
try {
  $raw = [Console]::In.ReadToEnd()
  $file = ($raw | ConvertFrom-Json).tool_input.file_path
  if (-not $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { exit 0 }
  if ($file -notmatch '\.(ts|tsx|js|json|css)$') { exit 0 }
  $root = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
  Push-Location $root
  # --no-errors-on-unmatched: arquivo ignorado pelo biome.json não é erro
  pnpm exec biome check --write --no-errors-on-unmatched --files-ignore-unknown=true $file *> $null
  Pop-Location
} catch { }
exit 0
