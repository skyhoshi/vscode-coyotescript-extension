$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $repositoryRoot 'package.json'

if (-not (Test-Path $packageJsonPath)) {
    throw "Could not find package.json at '$packageJsonPath'."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Install Node.js and npm, then try again.'
}

$vsceCommand = Join-Path $repositoryRoot 'node_modules\.bin\vsce.cmd'
if (-not (Test-Path $vsceCommand)) {
    throw "VS Code packaging dependencies are missing. Run 'npm ci' in '$repositoryRoot' first."
}

$package = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$vsixPath = Join-Path $repositoryRoot "$($package.name)-$($package.version).vsix"

Push-Location $repositoryRoot
try {
    npm run package
    if ($LASTEXITCODE -ne 0) {
        throw "VSIX packaging failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path $vsixPath)) {
    throw "Packaging completed without creating the expected VSIX: '$vsixPath'."
}

Write-Host "Created $vsixPath"
