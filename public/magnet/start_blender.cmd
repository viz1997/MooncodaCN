@echo off
chcp 65001 >nul
setlocal
title Mooncoda Magnet Bridge

echo.
echo   [Mooncoda] 磁吸孔桥接 —— 一键启动本机 Blender
echo   --------------------------------------------------
echo.

rem ---- 找 blender.exe(便携版解压出来的 / 装好的) ----
set "BLENDER="
if exist "%~dp0blender.exe" set "BLENDER=%~dp0blender.exe"
if not defined BLENDER if exist "%~dp0blender\blender.exe" set "BLENDER=%~dp0blender\blender.exe"
if not defined BLENDER for /d %%D in ("%~dp0blender*") do (
  if not defined BLENDER if exist "%%~fD\blender.exe" set "BLENDER=%%~fD\blender.exe"
)
if not defined BLENDER for /d %%D in ("%LOCALAPPDATA%\Programs\Blender Foundation\Blender*") do (
  if not defined BLENDER if exist "%%~fD\blender.exe" set "BLENDER=%%~fD\blender.exe"
)
if not defined BLENDER for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do (
  if not defined BLENDER if exist "%%~fD\blender.exe" set "BLENDER=%%~fD\blender.exe"
)
if not defined BLENDER for /d %%D in ("%ProgramW6432%\Blender Foundation\Blender*") do (
  if not defined BLENDER if exist "%%~fD\blender.exe" set "BLENDER=%%~fD\blender.exe"
)

rem ---- 找桥接脚本(blender_bridge.py) ----
set "BRIDGE="
if exist "%~dp0blender_bridge.py" set "BRIDGE=%~dp0blender_bridge.py"
if not defined BRIDGE if exist "%~dp0..\blender_bridge.py" set "BRIDGE=%~dp0..\blender_bridge.py"
if not defined BRIDGE if exist "%USERPROFILE%\Downloads\blender_bridge.py" set "BRIDGE=%USERPROFILE%\Downloads\blender_bridge.py"
if not defined BRIDGE if exist "%USERPROFILE%\Desktop\blender_bridge.py" set "BRIDGE=%USERPROFILE%\Desktop\blender_bridge.py"

if not defined BLENDER goto no_blender
if not defined BRIDGE goto no_bridge

echo   Blender:  %BLENDER%
echo   桥接脚本:  %BRIDGE%
echo.
echo   桥接只开在 http://127.0.0.1:8765(本机回环,模型不出这台电脑)。
echo   切完之后可以把这个黑窗口关掉。
echo.

rem ---- 清掉旧字节码缓存 ----
rem Python 校验 .pyc 只看「秒级 mtime + 字节数」⇒ 脚本改过之后有可能
rem 拿**旧代码**跑(用户自己改了插件就会遇到)。启动前清一次最稳。
for %%F in ("%BRIDGE%") do set "BRIDGEDIR=%%~dpF"
if exist "%BRIDGEDIR%__pycache__" rmdir /s /q "%BRIDGEDIR%__pycache__" 2>nul

start "Mooncoda Magnet Bridge" "%BLENDER%" --python "%BRIDGE%"
echo   Blender 起来了 —— 切回网页,点「检测」。
echo.
timeout /t 6 >nul
exit /b 0

:no_blender
echo   [Mooncoda] 没找到 blender.exe
echo.
echo   把便携版 Blender 解压出来,把这两个文件
echo   (start_blender.cmd 和 blender_bridge.py)一起放进解压出来的文件夹,
echo   然后再双击本文件。
echo.
echo   便携版下载: https://www.blender.org/download/
echo.
pause
exit /b 1

:no_bridge
echo   [Mooncoda] 没找到 blender_bridge.py
echo.
echo   把 start_blender.cmd 和 blender_bridge.py 放在同一个文件夹里,
echo   或者把 blender_bridge.py 放到「下载」文件夹。
echo.
pause
exit /b 1
