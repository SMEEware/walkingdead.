$ErrorActionPreference = 'Stop'
$Release = Split-Path -Parent $MyInvocation.MyCommand.Path
$Wdd = Join-Path $Release 'wdd.exe'
if (Test-Path (Join-Path $Release '.build-in-progress')) { Write-Error 'Release replacement was interrupted or is still running.'; exit 1 }
$DataDir = Join-Path $Release 'data'
$Owner = ''
$PasswordArgs = @()
$ServeArgs = @()
for ($i = 0; $i -lt $args.Count; $i++) {
  switch -Regex ($args[$i]) {
    '^--?(data-dir|DataDir)$' { $DataDir = $args[++$i] }
    '^--?(username|Username)$' { $Owner = $args[++$i] }
    '^--?(password-file|PasswordFile)$' { $PasswordArgs = @('--password-file', $args[++$i]) }
    '^(-h|--help)$' { Write-Host 'Usage: .\start.bat [--data-dir PATH] [--username OWNER] [--password-file PATH] [wdd serve options]'; exit 0 }
    default { $ServeArgs += $args[$i] }
  }
}
& $Wdd initialized --data-dir $DataDir
if ($LASTEXITCODE -ne 0) {
  if ($PasswordArgs.Count -eq 2 -and $PasswordArgs[1] -eq '-') { Write-Error 'Initialize first with wdd init before using stdin for service unlock.'; exit 1 }
  if (-not $Owner) { $Owner = Read-Host 'Owner username' }
  & $Wdd init --data-dir $DataDir --username $Owner @PasswordArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host 'Store the recovery code above offline. The service now asks for your password again to unlock.'
}
& $Wdd serve --data-dir $DataDir @PasswordArgs @ServeArgs
exit $LASTEXITCODE
