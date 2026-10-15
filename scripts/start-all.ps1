# Launch all three services of the Legal Contract Agent
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Starting Legal Contract Agent (All 3 Tiers)    " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Backend API:  http://localhost:5000" -ForegroundColor Blue
Write-Host "AI Service:   http://localhost:8000 (Docs: http://localhost:8000/docs)" -ForegroundColor Magenta
Write-Host "Frontend UI:  http://localhost:5173" -ForegroundColor Green
Write-Host "--------------------------------------------------"

npm run dev
