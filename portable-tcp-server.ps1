param(
  [int]$Port = 8798
)

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$rootPrefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".txt" = "text/plain; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".gif" = "image/gif"
  ".webp" = "image/webp"
  ".avif" = "image/avif"
  ".ico" = "image/x-icon"
  ".mp4" = "video/mp4"
  ".webm" = "video/webm"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
}

function Write-Headers($stream, [int]$statusCode, [string]$statusText, [string]$contentType, [long]$contentLength) {
  $header = "HTTP/1.1 $statusCode $statusText`r`nContent-Type: $contentType`r`nContent-Length: $contentLength`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
}

function Write-TextResponse($stream, [int]$statusCode, [string]$statusText, [string]$message) {
  $body = [Text.Encoding]::UTF8.GetBytes($message)
  Write-Headers $stream $statusCode $statusText "text/plain; charset=utf-8" $body.Length
  $stream.Write($body, 0, $body.Length)
}

try {
  $listener.Start()
} catch {
  Write-Error "Could not listen on http://127.0.0.1:$Port/. Port $Port may already be in use."
  exit 1
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $reader = $null
    $stream = $null
    try {
      $client.NoDelay = $true
      $stream = $client.GetStream()
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
      while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") {}

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2 -or $parts[0] -notin @("GET", "HEAD")) {
        Write-TextResponse $stream 405 "Method Not Allowed" "Method not allowed"
        continue
      }

      $requestPath = $parts[1].Split("?")[0]
      $relative = [Uri]::UnescapeDataString($requestPath.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
      $relative = $relative.Replace("/", [IO.Path]::DirectorySeparatorChar)
      $fullPath = [IO.Path]::GetFullPath((Join-Path $root $relative))

      if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Write-TextResponse $stream 403 "Forbidden" "Forbidden"
        continue
      }
      if (Test-Path -LiteralPath $fullPath -PathType Container) {
        $fullPath = Join-Path $fullPath "index.html"
      }
      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        Write-TextResponse $stream 404 "Not Found" "Not found"
        continue
      }

      $extension = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
      $file = [IO.File]::OpenRead($fullPath)
      try {
        Write-Headers $stream 200 "OK" $contentType $file.Length
        if ($parts[0] -ne "HEAD") { $file.CopyTo($stream) }
      } finally {
        $file.Dispose()
      }
    } catch {
      if ($stream) {
        try { Write-TextResponse $stream 500 "Internal Server Error" "Internal server error" } catch {}
      }
    } finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
