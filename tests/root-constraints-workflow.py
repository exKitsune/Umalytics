"""Adversarial Windows chain/SSL-policy checks without installing any trusted root."""
from datetime import datetime, timedelta, timezone
import ipaddress
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'desktop'))
from capture_store import load_store
from capture_identity import HOST, ROOT_CERT

with tempfile.TemporaryDirectory(prefix='root-constraints-',dir=ROOT/'.cache') as temporary:
    folder=Path(temporary)
    keys=[]
    generate=rsa.generate_private_key
    def capture_key(*args,**kwargs):
        key=generate(*args,**kwargs);keys.append(key);return key
    # Only this disposable fixture intercepts a CA key, to simulate its theft.
    with patch('capture_identity.rsa.generate_private_key',side_effect=capture_key):
        load_store(folder/'capture')
    root=x509.load_pem_x509_certificate((folder/'capture'/ROOT_CERT).read_bytes())
    ca_key=keys[0]
    assert ca_key.public_key().public_numbers()==root.public_key().public_numbers()
    (folder/'root.cer').write_bytes(root.public_bytes(serialization.Encoding.DER))
    now=datetime.now(timezone.utc)
    variants=[('allowed',[x509.DNSName(HOST)],HOST),
              ('unrelated',[x509.DNSName('other.example.invalid')],'other.example.invalid'),
              ('subdomain',[x509.DNSName('child.'+HOST)],'child.'+HOST),
              ('ip4',[x509.IPAddress(ipaddress.ip_address('127.0.0.1'))],'127.0.0.1'),
              ('ip6',[x509.IPAddress(ipaddress.ip_address('::1'))],'::1'),
              ('mixed',[x509.DNSName(HOST),x509.DNSName('other.example.invalid')],'other.example.invalid'),
              ('cn-only',[],'other.example.invalid')]
    cases=[]
    for label,names,host in variants:
        key=generate(public_exponent=65537,key_size=2048)
        builder=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,host)]))
            .issuer_name(root.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(hours=1))
            .add_extension(x509.BasicConstraints(ca=False,path_length=None),True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),False))
        if names:builder=builder.add_extension(x509.SubjectAlternativeName(names),False)
        leaf=builder.sign(ca_key,hashes.SHA256())
        (folder/(label+'.cer')).write_bytes(leaf.public_bytes(serialization.Encoding.DER))
        cases.append({'name':label,'host':host})
    # A stolen key can sign a replacement root certificate without constraints.
    # Supplying it must not replace the actually trusted root's policy.
    forged=(x509.CertificateBuilder().subject_name(root.subject).issuer_name(root.subject)
        .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=5)).not_valid_after(now+timedelta(hours=1))
        .add_extension(x509.BasicConstraints(ca=True,path_length=0),True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()),False)
        .sign(ca_key,hashes.SHA256()))
    (folder/'forged-root.cer').write_bytes(forged.public_bytes(serialization.Encoding.DER))
    (folder/'forged-chain.cer').write_bytes((folder/'unrelated.cer').read_bytes())
    cases.append({'name':'forged-chain','host':'other.example.invalid','extra':'forged-root.cer'})
    (folder/'cases.json').write_text(json.dumps(cases))
    script=ROOT/'tests/root-constraints-verify.ps1'
    result=subprocess.run([shutil.which('pwsh'),'-NoProfile','-File',str(script),str(folder)],capture_output=True,text=True,check=True)
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    assert len(rows)==len(cases),result.stdout
    for row in rows:
        print(json.dumps(row))
        assert row['accepted']==(row['name']=='allowed'),row
print('Windows constrained-root workflow passed: permitted API accepted; unrelated DNS, descendants, IPs, mixed SANs and CN-only certificates rejected. Windows trust unchanged.')
