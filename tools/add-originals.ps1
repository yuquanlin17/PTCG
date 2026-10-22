# 复刻卡（Classic Collection 等）的原版多半是 2020 年以前的卡，不在目录里；
# 按「卡名 + 编号」去 TCGplayer 找原版加进 catalog.json，扫描时原版和复刻会一起列出来让你选
$path = Join-Path $PSScriptRoot "catalog.json"
$json = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($json.Count -eq 1 -and $json[0].value) { $json = $json[0].value } # 旧版脚本写坏的格式：多包了一层
$cat = New-Object Collections.ArrayList
foreach ($x in $json) { [void]$cat.Add($x) }
$have = @{}; foreach ($c in $cat) { $have[[int]$c.id] = 1 }
$api = "https://mp-search-api.tcgplayer.com/v1/search/request?q={0}&isList=false"
$added = 0
foreach ($c in @($cat | Where-Object { $_.set -match 'Classic Collection' })) {
  $name = ($c.name -replace '\s*-\s*[\w/]+$', '' -replace '\s*\(.*?\)', '').Trim()
  $num = ($c.n -split '/')[0] -replace '^0+', ''
  $body = @{ algorithm = "sales_synonym_v2"; from = 0; size = 24
    filters = @{ term = @{ productLineName = @($(if ($c.l -eq "en") { "pokemon" } else { "pokemon-japan" })); productTypeName = @("Cards") }; range = @{}; match = @{} }
    listingSearch = @{ context = @{ cart = @{} }; filters = @{ term = @{}; range = @{}; exclude = @{ channelExclusion = 0 } } }
    context = @{ cart = @{}; shippingCountry = "US" }; settings = @{ useFuzzySearch = $true; didYouMean = @{} }; sort = @{} } | ConvertTo-Json -Depth 8 -Compress
  try { $res = (Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body ($api -f [uri]::EscapeDataString("$name $($c.n)"))).results[0].results } catch { continue }
  foreach ($p in $res) {
    $pn = "$($p.customAttributes.number)"
    if (-not $pn -or (($pn -split '/')[0] -replace '^0+', '') -ne $num) { continue }
    if ($p.setName -match 'Classic Collection|Jumbo' -or $have[[int]$p.productId]) { continue }
    if ((($p.productName -replace '\s*-\s*[\w/]+$', '' -replace '\s*\(.*?\)', '').Trim()) -ne $name) { continue }
    $rel = "$($p.customAttributes.releaseDate)"; $rel = $rel.Substring(0, [Math]::Min(10, $rel.Length))
    [void]$cat.Add([ordered]@{ id = [int]$p.productId; l = $c.l; set = $p.setName; n = $pn; name = $p.productName; r = "$($p.rarityName)"; rel = $rel })
    $have[[int]$p.productId] = 1; $added++
    Write-Host "  + $($p.setName) $pn $($p.productName)"
  }
}
[IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $cat.ToArray() -Depth 3 -Compress), [Text.UTF8Encoding]::new($false))
Write-Host "added $added"
