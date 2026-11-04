[CmdletBinding(DefaultParameterSetName = 'Full')]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,

    [Parameter(Mandatory, ParameterSetName = 'Setup')]
    [switch]$SetupOnly,

    [Parameter(Mandatory, ParameterSetName = 'Start')]
    [switch]$StartOnly
)

$ErrorActionPreference = 'Stop'
$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
$npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $node -or -not $npm) {
    throw 'Install Node.js 24 with npm, then reopen PowerShell and try again.'
}
$version = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') {
    throw 'This demo setup requires Node.js 24. Check your installation with node --version.'
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Test-Path -LiteralPath 'package-lock.json' -PathType Leaf)) {
        throw 'Extract the complete LMS source folder before running setup.'
    }
    if (-not $StartOnly) {
        # Check filenames only, before Next.js can load a local environment file.
        $settings = Get-ChildItem -Force -File -Filter '.env*' |
            Where-Object { $_.Name -notlike '*.example' }
        if ($settings) {
            throw 'Use a clean LMS source folder without local environment files.'
        }
        & $npm.Source ci
        if ($LASTEXITCODE -ne 0) {
            throw 'Dependency installation failed. Check the npm output and your connection to the npm registry.'
        }
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) {
            throw 'LMS build failed. Review the error above before starting the demo.'
        }
    }

    if (-not $SetupOnly) {
        Write-Host 'Keep this window open. Press Ctrl+C to stop. Demo records disappear when the server stops.'
        & $npm.Source run demo -- --port $Port
        if ($LASTEXITCODE -ne 0) {
            throw 'The demo stopped with an error. Review the launcher message above.'
        }
    }
} finally {
    Pop-Location
}
