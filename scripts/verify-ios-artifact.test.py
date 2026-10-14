import importlib.util
import pathlib
import datetime
import unittest

SCRIPT = pathlib.Path(__file__).with_name('verify-ios-artifact.py')

class NativeArtifactTests(unittest.TestCase):
    def test_native_verifier_exists(self):
        self.assertTrue(SCRIPT.exists())

    @unittest.skipUnless(SCRIPT.exists(), 'implementation missing')
    def test_release_metadata_rejects_debug_and_wrong_version(self):
        spec=importlib.util.spec_from_file_location('verify', SCRIPT)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        info={'CFBundleIdentifier':'ai.readmex.app','CFBundleShortVersionString':'2.1.0','CFBundleVersion':'42','MinimumOSVersion':'18.0','CFBundleSupportedPlatforms':['iPhoneOS'],'GetuiAppId':'id','GetuiAppKey':'key','GetuiAppSecret':'secret'}
        ent={'application-identifier':'TEAM.ai.readmex.app','com.apple.developer.team-identifier':'TEAM','aps-environment':'production','get-task-allow':False}
        profile={'TeamIdentifier':['TEAM'],'ExpirationDate':datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)+datetime.timedelta(days=1),'Entitlements':dict(ent)}
        env={'APP_VERSION':'2.1.0','APP_BUILD_NUMBER':'42','APPLE_TEAM_ID':'TEAM','READMEX_REQUIRE_PUSH':'true'}
        module.verify_metadata(info,ent,profile,env)
        module.verify_metadata({**info,'GetuiAppId':'','GetuiAppKey':'','GetuiAppSecret':''},ent,profile,env)
        for key, value in [('CFBundleIdentifier','ai.readmex.native.debug'),('CFBundleVersion','2')]:
            bad=dict(info);bad[key]=value
            with self.assertRaises(ValueError):module.verify_metadata(bad,ent,profile,env)
        with self.assertRaises(ValueError):module.verify_metadata(info,{**ent,'get-task-allow':True},profile,env)

if __name__=='__main__': unittest.main()
