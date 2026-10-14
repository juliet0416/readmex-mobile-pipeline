import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('verify-android-permissions.py')
ALLOWED = [
    'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS',
    'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE',
    'android.permission.VIBRATE', 'com.vivo.notification.permission.BADGE_ICON',
    'getui.permission.GetuiService.ai.readmex.app',
    'ai.readmex.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]

class AndroidPermissionTests(unittest.TestCase):
    def verify(self, permissions, package='ai.readmex.app', tag='uses-permission', root='manifest'):
        self.assertTrue(SCRIPT.exists(), 'Android permission verifier is missing')
        spec = importlib.util.spec_from_file_location('verify_android', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        nodes = ''.join(f'<{tag} android:name="{name}" />' for name in permissions)
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / 'AndroidManifest.xml'
            path.write_text(f'<{root} xmlns:android="http://schemas.android.com/apk/res/android" package="{package}">{nodes}</{root}>')
            return module.verify_manifest(path)

    def test_current_network_and_notification_permissions_are_accepted(self):
        self.assertEqual(self.verify(ALLOWED), set(ALLOWED))

    def test_unused_sdk_and_new_unreviewed_permissions_are_rejected(self):
        for name in ['QUERY_ALL_PACKAGES', 'READ_PHONE_STATE', 'GET_TASKS',
                     'ACCESS_BACKGROUND_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_SMS']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, name):
                self.verify([*ALLOWED, f'android.permission.{name}'])

    def test_sdk_23_permission_cannot_bypass_validation(self):
        with self.assertRaisesRegex(ValueError, 'QUERY_ALL_PACKAGES'):
            self.verify(['android.permission.QUERY_ALL_PACKAGES'], tag='uses-permission-sdk-23')

    def test_wrong_app_package_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'package'):
            self.verify(ALLOWED, package='ai.readmex.app.native.debug')

    def test_wrong_xml_root_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'manifest'):
            self.verify(ALLOWED, root='resources')

    def test_empty_manifest_and_missing_permission_name_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'INTERNET'):
            self.verify([])
        with self.assertRaisesRegex(ValueError, 'permission name'):
            self.verify([''])

if __name__ == '__main__':
    unittest.main()
