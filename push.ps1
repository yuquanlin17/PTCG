# 把文件传到 GitHub 仓库（不需要 git，用 gh 登录后的权限）
# 用法：powershell -ExecutionPolicy Bypass -File push.ps1 "提交说明" index.html worker.js
param([string]$Message, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)
$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $gh) { $gh = "C:\Program Files\GitHub CLI\gh.exe" }
$repo = "yuquanlin17/PTCG"
foreach ($f in $Files) {
  $path = Join-Path $PSScriptRoot $f
  $name = $f -replace '\\', '/'
  $sha = (& $gh api "repos/$repo/contents/$name" --jq ".sha" 2>$null)
  $body = @{ message = $Message; content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($path)) }
  if ($sha) { $body.sha = "$sha".Trim() }
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, ($body | ConvertTo-Json -Compress))
  $r = & $gh api -X PUT "repos/$repo/contents/$name" --input $tmp --jq ".commit.sha"
  Remove-Item $tmp
  if ($LASTEXITCODE -eq 0) { Write-Host "OK  $name  ($("$r".Substring(0, 7)))" } else { Write-Host "FAIL $name" }
}
