param(
  [int]$Port = 8765,
  [string]$ProxyUrl = '',
  [switch]$NoSystemProxy
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 may default to older TLS versions. Google Apps Script
# requires modern HTTPS, especially on hospital-managed Windows workstations.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Prefix = "http://127.0.0.1:$Port/"
$LogPath = Join-Path $PSScriptRoot 'ipaw-offline-proxy.log'
$DashboardUrl = 'https://apps.emc.id/trakcare/operatingtheatre/otrequest/dashboard/trakcareANLT/hospital/4'
$InProgressUrl = 'https://apps.emc.id/trakcare/operatingtheatre/otrequest/status/list/hospital/4?status=inprogress'
$LoginUrl = 'https://apps.emc.id/trakcare/operatingtheatre/login?route=trakcare.operatingtheatre.otrequest.dashboard.hospital&url=' + [uri]::EscapeDataString($DashboardUrl)
$KtmUrl = 'https://appsprn.emc.id/trakcare/dashboard/list/trakcareANLT/type/ktm/hospital/4?ward='
$Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$UserAgent = 'IPAW Offline Bridge/1.0'
$script:CloudProxy = $null
$script:CloudProxyUseDefaultCredentials = $false

function Write-Log {
  param([string]$Message)
  try {
    Add-Content -Path $LogPath -Value "$(Get-Date -Format o) $Message"
  } catch {}
}

function Get-ProxyCandidate {
  param([string]$ExplicitProxyUrl)

  if ($ExplicitProxyUrl) { return $ExplicitProxyUrl.Trim() }

  # FortiGate deployments commonly expose an authenticated HTTP proxy through
  # the Windows user proxy settings or one of these environment variables.
  foreach ($name in @('IPAW_HTTPS_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { return $value.Trim() }
  }
  return ''
}

function Initialize-CloudProxy {
  $candidate = Get-ProxyCandidate $ProxyUrl
  if ($candidate) {
    try {
      $proxyUri = New-Object System.Uri($candidate)
      if ($proxyUri.Scheme -notin @('http', 'https') -or -not $proxyUri.Host) {
        throw 'Proxy harus menggunakan URL http:// atau https://.'
      }
      if ($proxyUri.UserInfo) {
        throw 'Username/password tidak boleh ditulis di URL proxy. Gunakan kredensial Windows atau konfigurasi proxy Fortinet.'
      }
       # Windows PowerShell 5.1 exposes -Proxy as a System.Uri parameter.
       # Passing a WebProxy object works in some hosts but fails on older
       # hospital-managed Windows installations.
       $script:CloudProxy = $proxyUri
      $script:CloudProxyUseDefaultCredentials = $true
      Write-Log "Cloud memakai proxy eksplisit $($proxyUri.Scheme)://$($proxyUri.Host):$($proxyUri.Port)"
      return
    } catch {
      Write-Log "Proxy eksplisit diabaikan: $($_.Exception.Message)"
    }
  }

  if ($NoSystemProxy) {
    Write-Log 'Cloud memakai koneksi HTTPS langsung (proxy sistem dinonaktifkan oleh parameter).'
    return
  }

  try {
    $systemProxy = [System.Net.WebRequest]::DefaultWebProxy
    if ($systemProxy) {
      $probe = $systemProxy.GetProxy([uri]'https://script.google.com/')
      if ($probe -and $probe.AbsoluteUri -ne 'https://script.google.com/') {
        # Keep only the resolved URI. Passing the WebProxyWrapper itself to
        # Invoke-WebRequest -Proxy raises a conversion error in PowerShell 5.1.
        $script:CloudProxy = [uri]$probe.AbsoluteUri
        $script:CloudProxyUseDefaultCredentials = $true
        Write-Log "Cloud memakai proxy sistem Windows: $($probe.Scheme)://$($probe.Host):$($probe.Port)"
      } else {
        Write-Log 'Cloud memakai proxy sistem Windows dengan konfigurasi direct/PAC.'
      }
      return
    }
  } catch {
    Write-Log "Proxy sistem Windows tidak dapat dibaca: $($_.Exception.Message)"
  }

  Write-Log 'Cloud memakai koneksi HTTPS langsung; tidak ada proxy sistem yang terdeteksi.'
}

function Write-Response {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [string]$ContentType,
    [string]$Body
  )
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = $ContentType
  $Context.Response.ContentEncoding = [System.Text.Encoding]::UTF8
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.Headers.Add('Access-Control-Allow-Origin', '*')
  $Context.Response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  $Context.Response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Write-Json {
  param(
    [System.Net.HttpListenerContext]$Context,
    [int]$StatusCode,
    [object]$Value
  )
  Write-Response $Context $StatusCode 'application/json; charset=utf-8' ($Value | ConvertTo-Json -Depth 8 -Compress)
}

function Get-RequestBody {
  param([System.Net.HttpListenerContext]$Context)
  $reader = New-Object System.IO.StreamReader($Context.Request.InputStream, $Context.Request.ContentEncoding)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-CloudBaseUrl {
  param([System.Net.HttpListenerContext]$Context)

  $rawUrl = [string]$Context.Request.QueryString['url']
  if (-not $rawUrl) { throw 'Parameter URL cloud belum diberikan.' }

  $cloudUri = New-Object System.Uri($rawUrl)
  if ($cloudUri.Scheme -ne 'https' -or $cloudUri.Host -ne 'script.google.com') {
    throw 'URL cloud harus berupa deployment Google Apps Script yang aman (https://script.google.com/...).'
  }

  # Cloud API settings may contain action/apiKey query parameters. The local
  # bridge always sends the action in the request body, so forward only origin
  # and path to avoid mixing restore/save actions.
  return $cloudUri.GetLeftPart([System.UriPartial]::Path)
}

function Get-CloudApiKey {
  param([System.Net.HttpListenerContext]$Context)

  $rawUrl = [string]$Context.Request.QueryString['url']
  if (-not $rawUrl) { return 'IPAW-EMC' }
  try {
    $cloudUri = New-Object System.Uri($rawUrl)
    $match = [regex]::Match($cloudUri.Query, '(?:^|&)apiKey=([^&]*)', 'IgnoreCase')
    if ($match.Success) {
      $value = [uri]::UnescapeDataString($match.Groups[1].Value)
      if ($value) { return $value }
    }
  } catch {}
  return 'IPAW-EMC'
}

function Invoke-CloudRequest {
  param(
    [ValidateSet('GET', 'POST')][string]$Method,
    [string]$Uri,
    [string]$Body = ''
  )

  $params = @{
    Uri = $Uri
    Method = $Method
    UseBasicParsing = $true
    MaximumRedirection = 10
    Headers = @{
      'User-Agent' = $UserAgent
      'Accept' = 'application/json, text/plain, */*'
    }
    TimeoutSec = 30
    ErrorAction = 'Stop'
  }
  if ($Method -eq 'POST') {
    $params['ContentType'] = 'text/plain;charset=utf-8'
    $params['Body'] = $Body
  }
  if ($script:CloudProxy) {
    $params['Proxy'] = $script:CloudProxy
    if ($script:CloudProxyUseDefaultCredentials) {
      $params['ProxyUseDefaultCredentials'] = $true
    }
  }

  try {
    $response = Invoke-WebRequest @params
    return @{
      StatusCode = [int]$response.StatusCode
      Body = [string]$response.Content
    }
  } catch {
    # Invoke-WebRequest throws on HTTP errors. Preserve the upstream status and
    # body so the browser receives a useful error instead of a generic failure.
    $webResponse = $_.Exception.Response
    if (-not $webResponse) { throw }
    $stream = $webResponse.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    try { $bodyText = $reader.ReadToEnd() } finally {
      $reader.Dispose()
      $stream.Dispose()
    }
    return @{
      StatusCode = [int]$webResponse.StatusCode
      Body = $bodyText
    }
  }
}

function Get-CloudJson {
  param([string]$Body)
  try { return ($Body | ConvertFrom-Json) } catch { return $null }
}

function Get-CloudStoreName {
  param([System.Net.HttpListenerContext]$Context)

  $store = [string]$Context.Request.QueryString['store']
  if (-not $store -or $store -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,80}$') {
    throw 'Nama store Cloud tidak valid.'
  }
  return $store
}

function Invoke-CloudStore {
  param([System.Net.HttpListenerContext]$Context)

  $baseUrl = Get-CloudBaseUrl $Context
  $store = Get-CloudStoreName $Context
  $apiKey = Get-CloudApiKey $Context
  $targetUrl = "$baseUrl`?action=readStore&apiKey=$([uri]::EscapeDataString($apiKey))&store=$([uri]::EscapeDataString($store))"
  $result = Invoke-CloudRequest 'GET' $targetUrl
  $json = Get-CloudJson $result.Body
  if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
    $message = if ($json.error) { [string]$json.error } else { "Google Apps Script merespons HTTP $($result.StatusCode)." }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json -and $json.success -eq $false) {
    $message = if ($json.error) { [string]$json.error } else { 'Pembacaan store Cloud ditolak.' }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json) { Write-Json $Context 200 $json }
  else { Write-Json $Context 502 @{ error = 'Respons store Cloud bukan JSON yang valid.' } }
}

function Invoke-CloudRecord {
  param([System.Net.HttpListenerContext]$Context)

  $baseUrl = Get-CloudBaseUrl $Context
  $body = Get-RequestBody $Context
  if (-not $body) { Write-Json $Context 400 @{ error = 'Payload record Cloud kosong.' }; return }

  $payload = Get-CloudJson $body
  if (-not $payload) { Write-Json $Context 400 @{ error = 'Payload record Cloud bukan JSON yang valid.' }; return }

  $action = [string]$payload.action
  if ($action -notin @('upsertRecord', 'deleteRecord')) {
    Write-Json $Context 400 @{ error = 'Action record Cloud tidak valid.' }
    return
  }

  $apiKey = Get-CloudApiKey $Context
  if ($payload.PSObject.Properties.Name -contains 'apiKey') {
    $payload.apiKey = $apiKey
  } else {
    $payload | Add-Member -NotePropertyName apiKey -NotePropertyValue $apiKey
  }
  $forwardBody = $payload | ConvertTo-Json -Depth 20 -Compress
  $result = Invoke-CloudRequest 'POST' $baseUrl $forwardBody
  $json = Get-CloudJson $result.Body
  if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
    $message = if ($json.error) { [string]$json.error } else { "Google Apps Script merespons HTTP $($result.StatusCode)." }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json -and $json.success -eq $false) {
    $message = if ($json.error) { [string]$json.error } else { "Operasi $action ditolak." }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json) { Write-Json $Context 200 $json }
  else { Write-Json $Context 502 @{ error = 'Respons mutasi record Cloud bukan JSON yang valid.' } }
}

function Get-TrakCareTargetUrl {
  param(
    [System.Net.HttpListenerContext]$Context,
    [string]$DefaultUrl = ''
  )

  $rawUrl = [string]$Context.Request.QueryString['url']
  $target = if ($rawUrl) { $rawUrl } else { $DefaultUrl }
  if (-not $target) { throw 'Parameter URL TrakCare belum diberikan.' }

  $uri = New-Object System.Uri($target)
  if ($uri.Scheme -ne 'https' -or $uri.Host -notin @('apps.emc.id', 'appsprn.emc.id')) {
    throw 'URL TrakCare harus menggunakan host apps.emc.id atau appsprn.emc.id.'
  }
  return $uri.AbsoluteUri
}

function Invoke-TrakCarePage {
  param([string]$TargetUrl)

  $params = @{
    Uri = $TargetUrl
    Method = 'GET'
    UseBasicParsing = $true
    MaximumRedirection = 5
    Headers = @{
      'User-Agent' = 'IPAW Offline Bridge/1.0'
      'Accept' = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
    TimeoutSec = 30
    ErrorAction = 'Stop'
  }

  # Use the same Windows/Fortinet proxy settings as Cloud when available.
  # TrakCare is normally reachable directly on the RS network; if a proxy
  # refuses the internal host, retry without the explicit proxy.
  try {
    if ($script:CloudProxy) {
      $params['Proxy'] = $script:CloudProxy
      if ($script:CloudProxyUseDefaultCredentials) {
        $params['ProxyUseDefaultCredentials'] = $true
      }
    }
    return Invoke-WebRequest @params
  } catch {
    if (-not $script:CloudProxy) { throw }
    Write-Log "Proxy TrakCare gagal, mencoba koneksi langsung: $($_.Exception.Message)"
    $params.Remove('Proxy')
    $params.Remove('ProxyUseDefaultCredentials')
    return Invoke-WebRequest @params
  }
}

function Invoke-TrakCareRequest {
  param(
    [string]$Uri,
    [ValidateSet('GET', 'POST')][string]$Method = 'GET',
    [object]$Body = $null,
    [string]$ContentType = '',
    [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession = $null
  )

  $params = @{
    Uri = $Uri
    Method = $Method
    UseBasicParsing = $true
    MaximumRedirection = 5
    TimeoutSec = 30
    ErrorAction = 'Stop'
  }
  if ($Body -ne $null) { $params['Body'] = $Body }
  if ($ContentType) { $params['ContentType'] = $ContentType }
  if ($WebSession) { $params['WebSession'] = $WebSession }

  try {
    if ($script:CloudProxy) {
      $params['Proxy'] = $script:CloudProxy
      if ($script:CloudProxyUseDefaultCredentials) {
        $params['ProxyUseDefaultCredentials'] = $true
      }
    }
    return Invoke-WebRequest @params
  } catch {
    if (-not $script:CloudProxy) { throw }
    Write-Log "Proxy request TrakCare gagal, mencoba koneksi langsung: $($_.Exception.Message)"
    $params.Remove('Proxy')
    $params.Remove('ProxyUseDefaultCredentials')
    return Invoke-WebRequest @params
  }
}

function Invoke-TrakCareJsonPage {
  param(
    [System.Net.HttpListenerContext]$Context,
    [string]$TargetUrl
  )

  $result = Invoke-TrakCarePage $TargetUrl
  Write-Json $Context 200 @{
    html = [string]$result.Content
    contentType = [string]$result.Headers['Content-Type']
    baseUrl = $TargetUrl
    fetchedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
}

function Invoke-CloudStatus {
  param([System.Net.HttpListenerContext]$Context)
  try {
    $baseUrl = Get-CloudBaseUrl $Context
    $result = Invoke-CloudRequest 'GET' "$baseUrl`?action=status"
    # A reachable GAS endpoint is enough for the status indicator. The
    # application treats the actual backup response as the final authority.
    Write-Json $Context 200 @{ online = ($result.StatusCode -eq 200) }
  } catch {
    Write-Json $Context 200 @{ online = $false }
  }
}

function Invoke-CloudBackup {
  param([System.Net.HttpListenerContext]$Context)
  $baseUrl = Get-CloudBaseUrl $Context
  $body = Get-RequestBody $Context
  if (-not $body) { Write-Json $Context 400 @{ error = 'Payload backup kosong.' }; return }

  $payload = Get-CloudJson $body
  $action = if ($payload.action) { [string]$payload.action } else { '' }

  # Current clients upload large backups in resumable operations. The
  # saveStart/saveChunk envelopes intentionally do not contain a full
  # `database.users` array; users are included as entries inside the chunks.
  # Forward these operations unchanged and only require the Master User for
  # the legacy/full snapshot contract below.
  if ($action -in @('saveStart', 'saveChunk', 'saveCommit')) {
    $result = Invoke-CloudRequest 'POST' $baseUrl $body
    $json = Get-CloudJson $result.Body
    if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
      $message = if ($json.error) { [string]$json.error } else { "Google Apps Script merespons HTTP $($result.StatusCode)." }
      Write-Json $Context 502 @{ error = $message }
      return
    }
    if ($json -and $json.success -eq $false) {
      $message = if ($json.error) { [string]$json.error } elseif ($json.message) { [string]$json.message } else { "Operasi $action ditolak." }
      Write-Json $Context 502 @{ error = $message }
      return
    }
    if ($json) { Write-Json $Context 200 $json }
    else { Write-Json $Context 200 @{ success = $true; detail = $result.Body } }
    return
  }

  $database = if ($payload.database) { $payload.database } else { $payload }
  if (-not $database.users -or @($database.users).Count -eq 0) {
    Write-Json $Context 400 @{ error = 'Payload backup tidak memiliki Master User (users).' }
    return
  }

  $result = Invoke-CloudRequest 'POST' $baseUrl $body
  $json = Get-CloudJson $result.Body
  if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
    $message = if ($json.error) { [string]$json.error } else { "Google Apps Script merespons HTTP $($result.StatusCode)." }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json -and $json.success -eq $false) {
    $message = if ($json.error) { [string]$json.error } elseif ($json.message) { [string]$json.message } else { 'Backup cloud ditolak.' }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json) { Write-Json $Context 200 $json }
  else { Write-Json $Context 200 @{ success = $true; detail = $result.Body } }
}

function Invoke-CloudRestore {
  param([System.Net.HttpListenerContext]$Context)
  $baseUrl = Get-CloudBaseUrl $Context
  $apiKey = Get-CloudApiKey $Context
  $body = (@{ action = 'restore'; apiKey = $apiKey } | ConvertTo-Json -Compress)
  $result = Invoke-CloudRequest 'POST' $baseUrl $body
  $json = Get-CloudJson $result.Body
  if ($result.StatusCode -lt 200 -or $result.StatusCode -ge 300) {
    $message = if ($json.error) { [string]$json.error } else { "Google Apps Script merespons HTTP $($result.StatusCode)." }
    Write-Json $Context 502 @{ error = $message }
    return
  }
  if ($json) { Write-Json $Context 200 $json }
  else { Write-Json $Context 502 @{ error = 'Respons restore cloud bukan JSON yang valid.' } }
}

function Invoke-TrakCare {
  param(
    [string]$Username,
    [string]$Password,
    [string]$TargetUrl
  )
  $loginPage = Invoke-TrakCareRequest -Uri $LoginUrl -Method Get -WebSession $Session
  $tokenMatch = [regex]::Match($loginPage.Content, 'name=["'']_token["''][^>]+value=["'']([^"'']+)')
  if (-not $tokenMatch.Success) { throw 'Token login TrakCare tidak ditemukan.' }

  $form = @{
    _token = $tokenMatch.Groups[1].Value
    username = $Username
    password = $Password
  }
  $submitted = Invoke-TrakCareRequest -Uri $LoginUrl -Method Post -Body $form -ContentType 'application/x-www-form-urlencoded' -WebSession $Session
  if ($submitted.Content -match 'name=["'']username["'']' -and $submitted.Content -match 'name=["'']password["'']') {
    throw 'Login ke TrakCare gagal.'
  }

  $result = Invoke-TrakCareRequest -Uri $TargetUrl -Method Get -WebSession $Session
  if ($result.Content -match 'name=["'']username["'']' -and $result.Content -match 'name=["'']password["'']') {
    throw 'Login ke TrakCare gagal.'
  }
  return $result
}

try {
  Initialize-CloudProxy
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add($Prefix)
  $listener.Start()
} catch {
  # If another bridge instance won the race for the port, keep that instance
  # as the active service and avoid reporting a misleading fatal error.
  $existingBridge = $false
  try {
    $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri ($Prefix + 'health') -ErrorAction Stop
    $existingBridge = $health.StatusCode -eq 200
  } catch {}
  if ($existingBridge) {
    Write-Log "Proxy sudah aktif di $Prefix; proses bridge kedua tidak dijalankan."
    exit 0
  }
  Write-Log "Gagal memulai proxy: $($_.Exception.Message)"
  exit 1
}

Write-Log "Proxy aktif di $Prefix"
while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath

    if ($context.Request.HttpMethod -eq 'OPTIONS') {
      Write-Response $context 204 'text/plain; charset=utf-8' ''
      continue
    }
    if ($path -eq '/health') {
      Write-Json $context 200 @{ status = 'ok' }
      continue
    }
    if ($path -eq '/api/cloud/status' -and $context.Request.HttpMethod -eq 'GET') {
      Invoke-CloudStatus $context
      continue
    }
    if ($path -eq '/api/cloud/store' -and $context.Request.HttpMethod -eq 'GET') {
      Invoke-CloudStore $context
      continue
    }
    if ($path -eq '/api/cloud/record' -and $context.Request.HttpMethod -eq 'POST') {
      Invoke-CloudRecord $context
      continue
    }
    if ($path -eq '/api/cloud/backup' -and $context.Request.HttpMethod -eq 'POST') {
      Invoke-CloudBackup $context
      continue
    }
    if ($path -eq '/api/cloud/restore' -and $context.Request.HttpMethod -eq 'GET') {
      Invoke-CloudRestore $context
      continue
    }
    if ($path -eq '/api/trakcare/discharge' -and $context.Request.HttpMethod -eq 'GET') {
      $target = Get-TrakCareTargetUrl $context
      Invoke-TrakCareJsonPage $context $target
      continue
    }
    if ($path -eq '/api/trakcare/patients' -and $context.Request.HttpMethod -eq 'GET') {
      $target = Get-TrakCareTargetUrl $context
      Invoke-TrakCareJsonPage $context $target
      continue
    }
    if ($path -eq '/api/trakcare/igd-patients' -and $context.Request.HttpMethod -eq 'GET') {
      $target = Get-TrakCareTargetUrl $context 'https://apps.emc.id/trakcare/dashboard/dailyemergencywaitingtime/trakcareANLT/hospital/4'
      Invoke-TrakCareJsonPage $context $target
      continue
    }
    if ($path -eq '/api/trakcare/igd-ward' -and $context.Request.HttpMethod -eq 'GET') {
      $target = Get-TrakCareTargetUrl $context 'https://apps.emc.id/trakcare/dashboard/dailyemergencywaitingtime/trakcareANLT/hospital/4'
      Invoke-TrakCareJsonPage $context $target
      continue
    }
    if ($path -eq '/api/trakcare/ktm' -and $context.Request.HttpMethod -eq 'GET') {
      $ward = [string]$context.Request.QueryString['ward']
      $target = $KtmUrl + [uri]::EscapeDataString($ward)
      Invoke-TrakCareJsonPage $context $target
      continue
    }
    if ($path -ne '/api/trakcare/operating-theatre' -or $context.Request.HttpMethod -ne 'POST') {
      Write-Json $context 404 @{ error = 'Not found' }
      continue
    }

    $request = (Get-RequestBody $context) | ConvertFrom-Json
    if (-not $request.username -or -not $request.password) {
      Write-Json $context 400 @{ error = 'Konfigurasi login TrakCare belum lengkap.' }
      continue
    }
    $target = if ($request.view -eq 'inprogress') { $InProgressUrl } else { $DashboardUrl }
    $result = Invoke-TrakCare ([string]$request.username) ([string]$request.password) $target
    Write-Json $context 200 @{
      html = [string]$result.Content
      contentType = [string]$result.Headers['Content-Type']
      baseUrl = $target
      total = 0
    }
  } catch {
    Write-Log "Request gagal: $($_.Exception.Message)"
    try {
      Write-Json $context 502 @{ error = $_.Exception.Message }
    } catch {}
  }
}