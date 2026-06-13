$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$audioDir = Join-Path (Split-Path -Parent $scriptDir) 'audio'

$dirs = Get-ChildItem -Directory -Path $audioDir | Where-Object { $_.Name -notmatch '^\.' -and $_.Name -ne 'node_modules' }

$total = 0
$saved = 0
$failed = 0

Write-Host "Converting all audio to OGG Vorbis..."
Write-Host ""

foreach ($dir in $dirs) {
    $files = Get-ChildItem -Path $dir.FullName -File | Where-Object { $_.Extension -match '\.(mp3|opus|wav|flac|m4a|aac)$' }
    foreach ($f in $files) {
        $ogg = [System.IO.Path]::ChangeExtension($f.FullName, '.ogg')
        Write-Host "  $($dir.Name)\$($f.Name)"
        $inSize = $f.Length
        $output = ffmpeg -i $f.FullName -c:a libvorbis -q:a 5 -y $ogg 2>&1
        if ($LASTEXITCODE -eq 0 -and (Test-Path $ogg)) {
            $outSize = (Get-Item $ogg).Length
            $saved += $inSize - $outSize
            Remove-Item $f.FullName
            $total++
        } else {
            Write-Host "  FAILED: $($f.Name)" -ForegroundColor Red
            $failed++
        }
    }
}

Write-Host ""
Write-Host "Done! Converted $total files, $failed failed."
if ($saved -gt 0) {
    $mb = [math]::Round($saved / 1MB, 1)
    Write-Host "Space saved: $mb MB"
}
Write-Host ""
Start-Sleep -Seconds 5
