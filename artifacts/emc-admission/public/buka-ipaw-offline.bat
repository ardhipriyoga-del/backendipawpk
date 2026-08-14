@echo off
setlocal

set "HTML=%~dp0ipaw.html"
set "PROXY=%~dp0ipaw-offline-proxy.ps1"
set "PROFILE=%TEMP%\ChromeIPAW_Profile"
set "CHROME="

if not exist "%HTML%" (
  echo File ipaw.html tidak ditemukan di folder ini.
  pause
  exit /b 1
)
if not exist "%PROXY%" (
  echo File ipaw-offline-proxy.ps1 belum ada.
  echo Download tiga file: ipaw.html, buka-ipaw-offline.bat, dan ipaw-offline-proxy.ps1.
  pause
  exit /b 1
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "CHROME=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME set "CHROME=chrome.exe"

rem Fortinet/Windows proxy support:
rem - Prefer IPAW_HTTPS_PROXY when the hospital gives a dedicated proxy URL.
rem - Otherwise let the PowerShell bridge read HTTPS_PROXY/HTTP_PROXY/ALL_PROXY
rem   or the current Windows system proxy and use Windows credentials.
set "CLOUD_PROXY=%IPAW_HTTPS_PROXY%"
if not defined CLOUD_PROXY set "CLOUD_PROXY=%HTTPS_PROXY%"
if not defined CLOUD_PROXY set "CLOUD_PROXY=%HTTP_PROXY%"
if not defined CLOUD_PROXY set "CLOUD_PROXY=%ALL_PROXY%"
if defined CLOUD_PROXY (
  start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROXY%" -ProxyUrl "%CLOUD_PROXY%"
) else (
  start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROXY%"
)
set "PROXY_READY="
rem Hindari menjalankan bridge kedua jika proses sebelumnya masih aktif.
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://127.0.0.1:8765/health'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  set "PROXY_READY=1"
  goto proxy_ready
)

for /l %%I in (1,1,10) do (
  powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri 'http://127.0.0.1:8765/health'; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "PROXY_READY=1"
    goto proxy_ready
  )
  timeout /t 1 /nobreak >nul
)

echo Proxy TrakCare lokal gagal dijalankan.
echo Periksa file ipaw-offline-proxy.log di folder aplikasi.
pause
exit /b 1

:proxy_ready
rem Mode --app membuka jendela seperti aplikasi desktop: tanpa tab, toolbar, dan address bar.
rem The standalone file normally uses direct online requests. The launcher
rem explicitly enables the local bridge so TrakCare sessions and hospital
rem network proxying remain available when this BAT is used.
set "APP_URL=file:///%HTML:\=/%?apiProxy=http://127.0.0.1:8765&otProxy=http://127.0.0.1:8765"
start "" "%CHROME%" --app="%APP_URL%" --user-data-dir="%PROFILE%" --disable-web-security --disable-features=BlockThirdPartyCookies,TrackingProtection3pcd,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure --disable-site-isolation-trials --allow-file-access-from-files --allow-running-insecure-content --no-first-run --no-default-browser-check --start-maximized
endlocal