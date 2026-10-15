import importlib.util
import pathlib
import plistlib
import tempfile
import unittest
from unittest.mock import patch
import sys

SCRIPT = pathlib.Path(__file__).with_name('repair-getui-metadata.py')

class RepairTests(unittest.TestCase):
    def test_sdk_free_archive_verifies_signature_without_lockfile_or_resigning(self):
        spec = importlib.util.spec_from_file_location('repair', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            app = pathlib.Path(directory) / 'ReadmeX.app'
            app.mkdir()
            with patch.object(sys, 'argv', [str(SCRIPT), str(app), str(app / 'missing-Package.resolved')]), patch.object(module.subprocess, 'run') as run:
                module.main()
                run.assert_called_once_with(['codesign', '--verify', '--deep', '--strict', str(app.resolve())], check=True)

    def test_implementation_exists(self):
        self.assertTrue(SCRIPT.exists())

    @unittest.skipUnless(SCRIPT.exists(), 'implementation missing')
    def test_only_missing_vendor_versions_are_repaired(self):
        spec = importlib.util.spec_from_file_location('repair', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name, identifier, version in [('GTSDK', 'org.cocoapods.GTSDK', None), ('GTCommonSDK', 'org.cocoapods.GTCommonSDK', '3.2.6')]:
                framework = root / f'{name}.framework'
                framework.mkdir()
                data = {'CFBundleIdentifier': identifier, 'CFBundleVersion': '1'}
                if version:
                    data['CFBundleShortVersionString'] = version
                (framework / 'Info.plist').write_bytes(plistlib.dumps(data))
            repaired = module.repair_frameworks(root)
            self.assertEqual([p.name for p in repaired], ['GTSDK.framework'])
            data = plistlib.loads((root / 'GTSDK.framework/Info.plist').read_bytes())
            self.assertEqual(data['CFBundleShortVersionString'], '3.1.2')
            self.assertEqual(data['CFBundleVersion'], '1')
            self.assertEqual(data['CFBundleIdentifier'], 'org.cocoapods.GTSDK')

if __name__ == '__main__':
    unittest.main()
