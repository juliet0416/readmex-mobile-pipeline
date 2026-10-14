"""Verify the exported native release before publishing its artifact."""
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import subprocess
import sys

#region 原生发布产物校验
def verify_metadata(info, entitlements, profile, env):
    expected={'CFBundleIdentifier':env.get('IOS_APP_BUNDLE_ID') or 'ai.readmex.app',
              'CFBundleShortVersionString':env['APP_VERSION'], 'CFBundleVersion':env['APP_BUILD_NUMBER'],
              'MinimumOSVersion':'18.0', 'CFBundleSupportedPlatforms':['iPhoneOS']}
    for key,value in expected.items():
        if info.get(key)!=value: raise ValueError(f'Unexpected release {key}')
    # iPad 多任务必须支持四个方向，在上传前拦截 Apple 90474 错误。
    if 2 in info.get('UIDeviceFamily',[]) and not info.get('UIRequiresFullScreen',False):
        orientations=info.get('UISupportedInterfaceOrientations~ipad',info.get('UISupportedInterfaceOrientations',[]))
        required={'UIInterfaceOrientationPortrait','UIInterfaceOrientationPortraitUpsideDown',
                  'UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'}
        if not isinstance(orientations,list) or not required.issubset(orientations):
            raise ValueError('iPad multitasking requires all four supported orientations (Apple 90474)')
    team=entitlements.get('com.apple.developer.team-identifier')
    if not team or (env.get('APPLE_TEAM_ID') and env['APPLE_TEAM_ID']!=team): raise ValueError('Unexpected signing team')
    if entitlements.get('application-identifier')!=team+'.'+expected['CFBundleIdentifier']: raise ValueError('Unexpected signed app identifier')
    if entitlements.get('aps-environment')!='production' or entitlements.get('get-task-allow',False): raise ValueError('Not a production release signature')
    if profile.get('TeamIdentifier')!=[team]: raise ValueError('Profile signing team mismatch')
    if profile['ExpirationDate'].replace(tzinfo=None)<=datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None): raise ValueError('Expired provisioning profile')
    allowed=profile.get('Entitlements',{})
    if allowed.get('application-identifier')!=entitlements['application-identifier'] or allowed.get('aps-environment')!='production' or allowed.get('get-task-allow',False): raise ValueError('Incompatible release provisioning profile')

def main():
    app=pathlib.Path(sys.argv[1]);dsym=pathlib.Path(sys.argv[2])
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    info=plistlib.loads((app/'Info.plist').read_bytes())
    ent=plistlib.loads(subprocess.check_output(['codesign','-d','--entitlements',':-',str(app)]))
    profile=plistlib.loads(subprocess.check_output(['security','cms','-D','-i',str(app/'embedded.mobileprovision')]))
    verify_metadata(info,ent,profile,os.environ)
    binary=app/info['CFBundleExecutable']
    if subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()!='arm64': raise ValueError('Unexpected device architecture')
    strings=subprocess.check_output(['strings',str(binary)],text=True).splitlines()
    if 'https://readmex.ai' not in strings or '--api-base' in strings: raise ValueError('Wrong native release API origin')
    if list(app.rglob('LocalFixture.json')) or list(app.rglob('*.xctest')): raise ValueError('Test fixture found in release')
    uuid=subprocess.check_output(['dwarfdump','--uuid',str(binary)],text=True).split()[1]
    if subprocess.check_output(['dwarfdump','--uuid',str(dsym)],text=True).split()[1]!=uuid: raise ValueError('Release dSYM mismatch')
    for name in ['GTSDK','GTCommonSDK']:
        vendor=plistlib.loads((app/'Frameworks'/f'{name}.framework'/'Info.plist').read_bytes())
        if not vendor.get('CFBundleShortVersionString'): raise ValueError('Missing vendor framework version')
    print(json.dumps({'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],
        'bundleIdentifier':info['CFBundleIdentifier'],'architecture':'arm64','binaryUUID':uuid,
        'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'sourceSha':os.environ.get('SOURCE_SHA'),
        'pushConfigured':all(info.get(k) for k in ['GetuiAppId','GetuiAppKey','GetuiAppSecret'])},indent=2))
#endregion

if __name__=='__main__': main()
