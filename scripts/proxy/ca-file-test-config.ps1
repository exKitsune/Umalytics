# Shared checks for the experimental, process-only CA-file test. This file
# defines a function only; it never imports a certificate or starts a process.
function Get-CaFileTestConfiguration {
    param([string]$ConfigDirectory = (Join-Path $env:LOCALAPPDATA 'UmaTrace\proxy'))
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'The CA-file experiment requires an unelevated Windows token.'
    }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $ConfigDirectory 'mitmproxy-ca-cert.cer'))
    try {
        $thumbprint = $certificate.Thumbprint
        foreach ($store in @('CurrentUser', 'LocalMachine')) {
            if (Test-Path -LiteralPath "Cert:\$store\Root\$thumbprint") {
                throw "The test CA is already in $store Root; that would invalidate the CA-file experiment."
            }
        }
        $bundlePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.cache\proxy-ca-file\ca-bundle.pem'))
        $manifestPath = [IO.Path]::ChangeExtension($bundlePath, '.json')
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $hash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
        if ($manifest.ca_thumbprint -ne $thumbprint -or $manifest.bundle_sha256 -ne $hash) {
            throw 'The prepared public CA bundle changed; prepare the experiment again.'
        }
        $text = [IO.File]::ReadAllText($bundlePath)
        if ($text -match 'PRIVATE KEY') { throw 'A CA bundle must contain public certificates only.' }
        $expectedPemBody = [Convert]::ToBase64String($certificate.RawData)
        $found = $false
        foreach ($match in [regex]::Matches($text, '-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----')) {
            if (($match.Groups[1].Value -replace '\s', '') -eq $expectedPemBody) { $found = $true }
        }
        if (-not $found) { throw 'The prepared bundle does not contain the proxy public CA.' }
        [pscustomobject]@{ BundlePath = $bundlePath; BundleSha256 = $hash; CaThumbprint = $thumbprint }
    }
    finally { $certificate.Dispose() }
}
