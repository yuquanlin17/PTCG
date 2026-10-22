# 在电脑上本地预览：powershell -ExecutionPolicy Bypass -File serve.ps1
# 然后打开 http://localhost:8765/
# /tcgp 路径模拟 worker.js 的价格中转，方便本地测试
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:8765/")
$listener.Start()
Write-Host "Serving $root at http://localhost:8765/"
$types = @{ ".html" = "text/html; charset=utf-8"; ".json" = "application/json; charset=utf-8"; ".js" = "text/javascript"; ".png" = "image/png"; ".jpg" = "image/jpeg" }
function Search-Tcgp($q, $line) {
  $body = @{
    algorithm = "sales_synonym_v2"; from = 0; size = 10
    filters = @{ term = @{ productLineName = @($line) }; range = @{}; match = @{} }
    listingSearch = @{ context = @{ cart = @{} }; filters = @{ term = @{ sellerStatus = "Live"; channelId = 0 }; range = @{ quantity = @{ gte = 1 } }; exclude = @{ channelExclusion = 0 } } }
    context = @{ cart = @{}; shippingCountry = "US" }
    settings = @{ useFuzzySearch = $true; didYouMean = @{} }
    sort = @{}
  } | ConvertTo-Json -Depth 8 -Compress
  $r = Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body ("https://mp-search-api.tcgplayer.com/v1/search/request?q=" + [uri]::EscapeDataString($q) + "&isList=false")
  $items = @($r.results[0].results | ForEach-Object {
    [ordered]@{ id = [int]$_.productId; name = $_.productName; set = $_.setName; number = "$($_.customAttributes.number)"; price = $_.marketPrice; rarity = "$($_.rarityName)"; rel = "$($_.customAttributes.releaseDate)".Substring(0, [Math]::Min(10, "$($_.customAttributes.releaseDate)".Length)) }
  })
  return (@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); items = $items } | ConvertTo-Json -Depth 5 -Compress)
}
function List-TcgpSet($set, $line) {
  $items = New-Object System.Collections.ArrayList
  for ($from = 0; $from -lt 500; $from += 50) {
    $body = @{
      algorithm = "sales_synonym_v2"; from = $from; size = 50
      filters = @{ term = @{ productLineName = @($line); setName = @($set) }; range = @{}; match = @{} }
      listingSearch = @{ context = @{ cart = @{} }; filters = @{ term = @{}; range = @{}; exclude = @{ channelExclusion = 0 } } }
      context = @{ cart = @{}; shippingCountry = "US" }
      settings = @{ useFuzzySearch = $false; didYouMean = @{} }
      sort = @{}
    } | ConvertTo-Json -Depth 8 -Compress
    $r = Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body "https://mp-search-api.tcgplayer.com/v1/search/request?q=&isList=false"
    $page = $r.results[0]
    foreach ($p in $page.results) {
      $num = "$($p.customAttributes.number)"
      if (-not $num) { continue }
      $rel = "$($p.customAttributes.releaseDate)"
      [void]$items.Add([ordered]@{ id = [int]$p.productId; name = $p.productName; set = $p.setName; number = $num; price = $p.marketPrice; rarity = "$($p.rarityName)"; rel = $rel.Substring(0, [Math]::Min(10, $rel.Length)) })
    }
    if ($page.results.Count -lt 50 -or ($from + 50) -ge $page.totalResults) { break }
  }
  return (@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); items = @($items) } | ConvertTo-Json -Depth 5 -Compress)
}
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart("/"))
  try {
    if ($path -eq "tcgp") {
      $q = $ctx.Request.QueryString["q"]; $line = $(if ($ctx.Request.QueryString["line"] -eq "pokemon-japan") { "pokemon-japan" } else { "pokemon" })
      $set = $ctx.Request.QueryString["set"]
      $json = $(if ($set) { List-TcgpSet $set $line } else { Search-Tcgp $q $line })
      $bytes = [Text.Encoding]::UTF8.GetBytes($json)
      $ctx.Response.ContentType = "application/json; charset=utf-8"
      $ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*")
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      if ($path -eq "") { $path = "index.html" }
      $file = Join-Path $root $path
      if ((Test-Path $file -PathType Leaf) -and ([IO.Path]::GetFullPath($file).StartsWith($root))) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file)
        $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { "application/octet-stream" })
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $ctx.Response.StatusCode = 404 }
    }
  } catch { $ctx.Response.StatusCode = 502 }
  $ctx.Response.Close()
}
