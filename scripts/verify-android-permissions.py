"""Check the packaging manifest before publishing a ReadmeX Android release."""
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

#region 已确认用途的原生发布权限
APP_PACKAGE = 'ai.readmex.app'
ALLOWED_PERMISSIONS = {
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.VIBRATE',
    'com.vivo.notification.permission.BADGE_ICON',
    'getui.permission.GetuiService.ai.readmex.app',
    'ai.readmex.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
}
PERMISSION_TAGS = {'uses-permission', 'uses-permission-sdk-23', 'uses-permission-sdk-m'}
ANDROID_NAME = '{http://schemas.android.com/apk/res/android}name'

def verify_manifest(path):
    root = ET.parse(path).getroot()
    if root.tag != 'manifest':
        raise ValueError('Expected an Android packaging manifest')
    if root.get('package') != APP_PACKAGE:
        raise ValueError('Unexpected Android release package')
    permissions = set()
    for node in root:
        if node.tag in PERMISSION_TAGS:
            name = node.get(ANDROID_NAME)
            if not name:
                raise ValueError('Missing Android permission name')
            permissions.add(name)
    unexpected = permissions - ALLOWED_PERMISSIONS
    if unexpected:
        raise ValueError('Unreviewed Android release permissions: ' + ', '.join(sorted(unexpected)))
    if 'android.permission.INTERNET' not in permissions:
        raise ValueError('Android release manifest lacks required INTERNET permission')
    return permissions

def main():
    if len(sys.argv) != 2:
        raise ValueError('Usage: verify-android-permissions.py <packaging AndroidManifest.xml>')
    path = pathlib.Path(sys.argv[1])
    permissions = verify_manifest(path)
    print(json.dumps({'manifest': str(path), 'package': APP_PACKAGE, 'permissions': sorted(permissions)}, indent=2))
#endregion

if __name__ == '__main__':
    main()
