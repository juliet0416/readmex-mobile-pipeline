import pathlib
import plistlib
import subprocess
import sys

# 仅修复当前锁定的个推二进制缺失元数据，不修改应用版本或升级 SDK。
VENDORS = {
    'GTSDK': ('org.cocoapods.GTSDK', '3.1.2', '464c86e453c9c06e23d71bcad3958d1f1b7a68ab'),
    'GTCommonSDK': ('org.cocoapods.GTCommonSDK', '3.2.6', '065ad8aba9defa44c62fb9fe0d69f2bcc1b76c5d'),
}

def repair_frameworks(root):
    repaired = []
    for name, (identifier, version, _) in VENDORS.items():
        framework = pathlib.Path(root) / f'{name}.framework'
        plist = framework / 'Info.plist'
        data = plistlib.loads(plist.read_bytes())
        if data.get('CFBundleIdentifier') != identifier:
            raise ValueError(f'Unexpected vendor bundle: {name}')
        if not data.get('CFBundleShortVersionString'):
            data['CFBundleShortVersionString'] = version
            plist.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY))
            repaired.append(framework)
    return repaired

def main():
    app = pathlib.Path(sys.argv[1]).resolve()
    if app.suffix != '.app':
        raise ValueError('Expected archived .app')
    # 新原生包已移除个推；保留签名校验，旧版本仍执行原有修复与锁定校验。
    if not any((app / 'Frameworks' / f'{name}.framework').exists() for name in VENDORS):
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        print('[metadata] Getui SDK absent; signature verified', flush=True)
        return
    manifest = pathlib.Path(sys.argv[2]).read_text()
    for _, (_, _, revision) in VENDORS.items():
        if revision not in manifest:
            raise ValueError('Getui SDK pin changed; review metadata repair versions')
    repaired = repair_frameworks(app / 'Frameworks')
    for bundle in repaired + ([app] if repaired else []):
        subprocess.run(['codesign', '--force', '--sign', 'Apple Distribution', '--preserve-metadata=identifier,entitlements,requirements,flags', '--timestamp=none', str(bundle)], check=True)
        print(f'[metadata] repaired and signed {bundle.name}', flush=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)

if __name__ == '__main__':
    main()
