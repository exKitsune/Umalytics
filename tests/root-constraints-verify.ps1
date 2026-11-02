param([string]$Folder)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TlsPolicy {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct SSL { public uint size; public uint auth; public uint checks; [MarshalAs(UnmanagedType.LPWStr)] public string name; }
 [StructLayout(LayoutKind.Sequential)] public struct PARA { public uint size; public uint flags; public IntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] public struct STATUS { public uint size; public uint error; public int chain; public int element; public IntPtr extra; }
 [DllImport("crypt32.dll", SetLastError=true)] public static extern bool CertVerifyCertificateChainPolicy(IntPtr policy, IntPtr chain, ref PARA para, ref STATUS status);
 public static uint Check(IntPtr chain, string name) {
  var ssl=new SSL {size=(uint)Marshal.SizeOf<SSL>(),auth=2,checks=0,name=name};
  var ptr=Marshal.AllocHGlobal(Marshal.SizeOf<SSL>());
  try {
   Marshal.StructureToPtr(ssl,ptr,false);
   var para=new PARA {size=(uint)Marshal.SizeOf<PARA>(),extra=ptr};
   var status=new STATUS {size=(uint)Marshal.SizeOf<STATUS>()};
   if(!CertVerifyCertificateChainPolicy(new IntPtr(4),chain,ref para,ref status))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
   return status.error;
  } finally {Marshal.DestroyStructure<SSL>(ptr);Marshal.FreeHGlobal(ptr);}
 }
}
"@
$root=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new([System.IO.File]::ReadAllBytes((Join-Path $Folder 'root.cer')))
try {
 foreach($case in (Get-Content (Join-Path $Folder 'cases.json') -Raw|ConvertFrom-Json)){
  $leaf=[System.Security.Cryptography.X509Certificates.X509Certificate2]::new([System.IO.File]::ReadAllBytes((Join-Path $Folder "$($case.name).cer")))
  $chain=[System.Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
   $chain.ChainPolicy.TrustMode='CustomRootTrust'
   [void]$chain.ChainPolicy.CustomTrustStore.Add($root)
   $chain.ChainPolicy.RevocationMode='NoCheck'
   $chain.ChainPolicy.DisableCertificateDownloads=$true
   [void]$chain.ChainPolicy.ApplicationPolicy.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
   if($case.extra){[void]$chain.ChainPolicy.ExtraStore.Add([System.Security.Cryptography.X509Certificates.X509Certificate2]::new([System.IO.File]::ReadAllBytes((Join-Path $Folder $case.extra))))}
   $built=$chain.Build($leaf)
   $sslError=[TlsPolicy]::Check($chain.ChainContext,$case.host)
   [pscustomobject]@{name=$case.name;accepted=($built -and $sslError -eq 0);chainAccepted=$built;sslError=('0x{0:X8}' -f $sslError);status=@($chain.ChainStatus|ForEach-Object {$_.Status.ToString()})}|ConvertTo-Json -Compress
  } finally {$chain.Dispose();$leaf.Dispose()}
 }
} finally {$root.Dispose()}
