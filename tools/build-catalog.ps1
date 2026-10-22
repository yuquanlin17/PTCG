# 列出 TCGplayer 上 2020 年以后发售的日版 / 美版单卡，存成 tools/catalog.json（建卡图库用）
# 用法：powershell -ExecutionPolicy Bypass -File tools/build-catalog.ps1 [-Since 2020-01-01]
param([string]$Since = "2020-01-01")
$api = "https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false"
function Req($term, $from, $size) {
  $body = @{
    algorithm = "sales_synonym_v2"; from = $from; size = $size
    filters = @{ term = $term; range = @{}; match = @{} }
    listingSearch = @{ context = @{ cart = @{} }; filters = @{ term = @{}; range = @{}; exclude = @{ channelExclusion = 0 } } }
    context = @{ cart = @{}; shippingCountry = "US" }
    settings = @{ useFuzzySearch = $false; didYouMean = @{} }
    sort = @{}
  } | ConvertTo-Json -Depth 8 -Compress
  for ($try = 0; $try -lt 3; $try++) {
    try { return (Invoke-RestMethod -Method Post -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) $api).results[0] } catch { Start-Sleep 2 }
  }
  return $null
}
$out = New-Object System.Collections.ArrayList
foreach ($line in @("pokemon-japan", "pokemon")) {
  $sets = (Req @{ productLineName = @($line); productTypeName = @("Cards") } 0 1).aggregations.setName
  Write-Host "$line : $($sets.Count) sets"
  foreach ($s in $sets) {
    # 先看第一页的发售日，太老的系列整套跳过
    $items = New-Object System.Collections.ArrayList
    for ($from = 0; $from -lt 1000; $from += 50) {
      $page = Req @{ productLineName = @($line); setName = @($s.urlValue); productTypeName = @("Cards") } $from 50
      if (-not $page) { break }
      foreach ($p in $page.results) {
        $num = "$($p.customAttributes.number)"
        if (-not $num -or $num -notmatch '\d') { continue }
        $rel = "$($p.customAttributes.releaseDate)"; $rel = $rel.Substring(0, [Math]::Min(10, $rel.Length))
        [void]$items.Add([ordered]@{ id = [int]$p.productId; l = $(if ($line -eq "pokemon") { "en" } else { "ja" }); set = $p.setName; n = $num; name = $p.productName; r = "$($p.rarityName)"; rel = $rel })
      }
      if ($from -eq 0 -and $items.Count -and ($items | ForEach-Object { $_.rel } | Where-Object { $_ } | Sort-Object | Select-Object -Last 1) -lt $Since) { $items.Clear(); break }
      if ($page.results.Count -lt 50 -or ($from + 50) -ge $page.totalResults) { break }
    }
    if ($items.Count) { $out.AddRange($items); Write-Host "  $($s.value): $($items.Count)" }
  }
}
$keep = @($out | Where-Object { -not $_.rel -or $_.rel -ge $Since })
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "catalog.json"), (ConvertTo-Json @($keep) -Depth 3 -Compress), [Text.UTF8Encoding]::new($false))
Write-Host "total: $($keep.Count)"
