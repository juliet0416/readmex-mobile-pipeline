import importlib.util
import pathlib
import datetime
import unittest
import tempfile
import plistlib

SCRIPT = pathlib.Path(__file__).with_name('verify-ios-artifact.py')

class NativeArtifactTests(unittest.TestCase):
    def test_sdk_free_release_needs_no_apns_but_keeps_signature_guards(self):
        spec=importlib.util.spec_from_file_location('verify', SCRIPT)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        info={'CFBundleIdentifier':'ai.readmex.app','CFBundleShortVersionString':'2.1.0','CFBundleVersion':'42','MinimumOSVersion':'18.0','CFBundleSupportedPlatforms':['iPhoneOS']}
        ent={'application-identifier':'TEAM.ai.readmex.app','com.apple.developer.team-identifier':'TEAM'}
        profile={'TeamIdentifier':['TEAM'],'ExpirationDate':datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)+datetime.timedelta(days=1),'Entitlements':dict(ent)}
        env={'APP_VERSION':'2.1.0','APP_BUILD_NUMBER':'42','APPLE_TEAM_ID':'TEAM'}
        module.verify_metadata(info,ent,profile,env,push_sdk_present=False)
        for bad in [{'get-task-allow':True},{'aps-environment':'development'},{'application-identifier':'OTHER.ai.readmex.app'}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                module.verify_metadata(info,{**ent,**bad},profile,env,push_sdk_present=False)
        with self.assertRaises(ValueError):
            module.verify_metadata(info,ent,profile,env,push_sdk_present=True)

    def test_vendor_frameworks_may_be_absent_but_not_partial_or_invalid(self):
        spec=importlib.util.spec_from_file_location('verify', SCRIPT)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            app=pathlib.Path(directory)
            self.assertFalse(module.verify_vendor_frameworks(app))
            for name in ['GTSDK','GTCommonSDK']:
                framework=app/'Frameworks'/f'{name}.framework'
                framework.mkdir(parents=True)
                (framework/'Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':'1.0'}))
                if name=='GTSDK':
                    with self.assertRaises(ValueError): module.verify_vendor_frameworks(app)
            self.assertTrue(module.verify_vendor_frameworks(app))
            (framework/'Info.plist').write_bytes(plistlib.dumps({}))
            with self.assertRaises(ValueError): module.verify_vendor_frameworks(app)

    def test_ipad_multitasking_orientation_validation(self):
        spec=importlib.util.spec_from_file_location('verify', SCRIPT)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        portrait='UIInterfaceOrientationPortrait'
        upside_down='UIInterfaceOrientationPortraitUpsideDown'
        iphone=[portrait,'UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight']
        ipad=[*iphone,upside_down]
        info={'CFBundleIdentifier':'ai.readmex.app','CFBundleShortVersionString':'2.1.0','CFBundleVersion':'42','MinimumOSVersion':'18.0','CFBundleSupportedPlatforms':['iPhoneOS'],'UIDeviceFamily':[1,2],'UISupportedInterfaceOrientations':iphone}
        ent={'application-identifier':'TEAM.ai.readmex.app','com.apple.developer.team-identifier':'TEAM','aps-environment':'production','get-task-allow':False}
        profile={'TeamIdentifier':['TEAM'],'ExpirationDate':datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)+datetime.timedelta(days=1),'Entitlements':dict(ent)}
        env={'APP_VERSION':'2.1.0','APP_BUILD_NUMBER':'42','APPLE_TEAM_ID':'TEAM'}
        for overrides in [{},{'UISupportedInterfaceOrientations~ipad':iphone},{'UISupportedInterfaceOrientations':ipad,'UISupportedInterfaceOrientations~ipad':[]}]:
            with self.subTest(overrides=overrides), self.assertRaisesRegex(ValueError,'iPad.*orientations'):
                module.verify_metadata({**info,**overrides},ent,profile,env)
        for overrides in [{'UISupportedInterfaceOrientations~ipad':ipad},{'UISupportedInterfaceOrientations':ipad},{'UIDeviceFamily':[1]},{'UIRequiresFullScreen':True}]:
            with self.subTest(overrides=overrides):
                module.verify_metadata({**info,**overrides},ent,profile,env)

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
