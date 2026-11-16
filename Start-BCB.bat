@echo off
title Bang Click Boom (BCB) Server
cd /d "c:\Users\NJ-Sowul\Documents\Gemini Projects\Bang Click Boom"

echo Starting Bang Click Boom (BCB) on http://localhost:3000 ...
start "" "http://localhost:3000"
"C:\Program Files\nodejs\npm.cmd" run dev
pause
