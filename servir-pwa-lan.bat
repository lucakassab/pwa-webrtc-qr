@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "PORT=8443"
if not "%~1"=="" set "PORT=%~1"
set "CERT_HTTP_PORT=8080"
if not "%~2"=="" set "CERT_HTTP_PORT=%~2"

set "PYTHON_CMD="
where py >nul 2>nul
if %ERRORLEVEL%==0 set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
  where python >nul 2>nul
  if %ERRORLEVEL%==0 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo Python nao encontrado.
  echo Instale Python 3 ou use outro servidor HTTPS local.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.AddressState -eq 'Preferred' } | Select-Object -First 1 -ExpandProperty IPAddress; if (-not $ip) { $ip = 'SEU_IP_DO_PC' }; $ip"`) do set "LAN_IP=%%I"

set "CERT_FILE=%CD%\certs\pwa-local.crt"
set "KEY_FILE=%CD%\certs\pwa-local.key"
set "CERT_DOWNLOAD_DIR=%CD%\cert-download"
set "CERT_DOWNLOAD_FILE=%CERT_DOWNLOAD_DIR%\rootCA.pem"
set "CERT_DOWNLOAD_CRT=%CERT_DOWNLOAD_DIR%\rootCA.crt"
set "SERVER_FILE=%TEMP%\pwa_https_server_%RANDOM%.py"

echo.
echo ============================================================
echo  PWA WebRTC Offline Chat - servidor local para LAN
echo ============================================================
echo.
echo Pasta: %CD%
echo Porta: %PORT%
echo Porta HTTP para certificado: %CERT_HTTP_PORT%
echo IP provavel do PC: %LAN_IP%
echo.

if exist "%CERT_FILE%" if exist "%KEY_FILE%" goto HTTPS_SERVER

where mkcert >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Certificado HTTPS nao encontrado. Gerando com mkcert...
  if not exist "%CD%\certs" mkdir "%CD%\certs"
  mkcert -cert-file "%CERT_FILE%" -key-file "%KEY_FILE%" localhost 127.0.0.1 ::1 %LAN_IP%
  if exist "%CERT_FILE%" if exist "%KEY_FILE%" (
    echo.
    echo Certificado criado.
    echo Para o iPhone confiar neste HTTPS, envie e instale o rootCA.pem do mkcert.
    echo Caminho do CA local:
    mkcert -CAROOT
    echo.
    goto HTTPS_SERVER
  )
  echo.
  echo Nao foi possivel criar o certificado com mkcert.
  echo.
)

echo Certificado HTTPS nao encontrado em:
echo   %CERT_FILE%
echo   %KEY_FILE%
echo.
echo ATENCAO:
echo - iPhone/iPad normalmente exigem HTTPS confiavel para instalar/cachear PWA.
echo - Sem HTTPS, voce ainda pode abrir para teste em:
echo     http://%LAN_IP%:%PORT%/
echo - Para instalacao offline real no iPhone, crie um certificado local confiavel
echo   para o IP/nome do PC e salve como certs\pwa-local.crt e certs\pwa-local.key.
echo.
echo Iniciando fallback HTTP...
echo.
echo Abra no iPhone: http://%LAN_IP%:%PORT%/
echo Pressione Ctrl+C para parar.
echo.
%PYTHON_CMD% -m http.server %PORT% --bind 0.0.0.0
exit /b %ERRORLEVEL%

:HTTPS_SERVER
echo Certificado encontrado. Iniciando HTTPS...
echo.
echo Abra no iPhone:
echo   https://%LAN_IP%:%PORT%/
echo.
where mkcert >nul 2>nul
if %ERRORLEVEL%==0 (
  echo CA local do mkcert para instalar/confiar no iPhone:
  mkcert -CAROOT
  if not exist "%CERT_DOWNLOAD_DIR%" mkdir "%CERT_DOWNLOAD_DIR%"
  for /f "usebackq delims=" %%C in (`mkcert -CAROOT`) do copy /Y "%%C\rootCA.pem" "%CERT_DOWNLOAD_FILE%" >nul
  if exist "%CERT_DOWNLOAD_FILE%" copy /Y "%CERT_DOWNLOAD_FILE%" "%CERT_DOWNLOAD_CRT%" >nul
  if exist "%CERT_DOWNLOAD_FILE%" (
    echo Certificado publico disponivel no site:
    echo   https://%LAN_IP%:%PORT%/cert-download/rootCA.pem
    echo   https://%LAN_IP%:%PORT%/cert-download/rootCA.crt
    echo.
    echo Se o download HTTPS travar no Android, use o link HTTP:
    echo   http://%LAN_IP%:%CERT_HTTP_PORT%/cert-download/rootCA.crt
  )
  echo.
)
echo Se o iPhone avisar que o certificado nao e confiavel, instale/confiar no
echo certificado antes de tentar Adicionar a Tela de Inicio.
echo Pressione Ctrl+C para parar.
echo.

if exist "%CERT_DOWNLOAD_CRT%" (
  start "PWA Cert HTTP" /min cmd /c "%PYTHON_CMD% -m http.server %CERT_HTTP_PORT% --bind 0.0.0.0"
)

> "%SERVER_FILE%" echo import http.server
>> "%SERVER_FILE%" echo import ssl
>> "%SERVER_FILE%" echo import sys
>> "%SERVER_FILE%" echo from functools import partial
>> "%SERVER_FILE%" echo port = int(sys.argv[1])
>> "%SERVER_FILE%" echo cert_file = sys.argv[2]
>> "%SERVER_FILE%" echo key_file = sys.argv[3]
>> "%SERVER_FILE%" echo handler = partial(http.server.SimpleHTTPRequestHandler, directory='.')
>> "%SERVER_FILE%" echo server = http.server.ThreadingHTTPServer(('0.0.0.0', port), handler)
>> "%SERVER_FILE%" echo context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
>> "%SERVER_FILE%" echo context.load_cert_chain(cert_file, key_file)
>> "%SERVER_FILE%" echo server.socket = context.wrap_socket(server.socket, server_side=True)
>> "%SERVER_FILE%" echo print(f'Serving HTTPS on 0.0.0.0 port {port}')
>> "%SERVER_FILE%" echo server.serve_forever()

%PYTHON_CMD% "%SERVER_FILE%" %PORT% "%CERT_FILE%" "%KEY_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"
del "%SERVER_FILE%" >nul 2>nul
exit /b %EXIT_CODE%
