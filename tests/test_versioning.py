import json
from pathlib import Path
import tempfile
import unittest
from subprocess import CompletedProcess
from unittest.mock import patch
from urllib.error import URLError
import versioning


class VersioningTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        (self.root/'public').mkdir()
        (self.root/'public'/'index.html').write_text('first',encoding='utf-8')
        versioning.CACHE.clear()

    def test_repository_urls_are_restricted_to_github_repositories(self):
        self.assertEqual(versioning.normalize_repository('https://github.com/owner/repository.git/'),'https://github.com/owner/repository')
        for value in ['http://github.com/a/b','https://github.com.evil.test/a/b','https://github.com/a/b?token=secret','https://user:pass@github.com/a/b','https://127.0.0.1/a/b','https://github.com/a/..']:
            with self.subTest(value=value),self.assertRaises(ValueError):versioning.normalize_repository(value)

    def test_source_hash_is_stable_and_does_not_include_local_secrets(self):
        with patch.object(versioning,'git',return_value=''):
            first=versioning.build_info(self.root)
            (self.root/'.local'/'connection.bin').write_bytes(b'private')
            second=versioning.build_info(self.root)
            self.assertEqual(first['hash'],second['hash']);self.assertEqual(first['builtAt'],second['builtAt'])
            (self.root/'public'/'index.html').write_text('changed',encoding='utf-8')
            self.assertNotEqual(versioning.build_info(self.root)['hash'],first['hash'])

    def test_settings_are_persisted_without_credentials(self):
        expected={'repository':'https://github.com/owner/repo','branch':'release/stable'}
        expected['classification']=versioning.default_classification()
        versioning.save_settings(self.root,expected)
        self.assertEqual(versioning.read_settings(self.root),expected)
        self.assertEqual(json.loads((self.root/'.local'/'settings.json').read_text()),expected)

    def test_only_remote_ahead_is_an_available_update(self):
        info={'settings':{'repository':'https://github.com/owner/repo','branch':''},'commit':'a'*40,'dirty':True}
        for state,expected in [('ahead',True),('behind',False),('diverged',False),('identical',False)]:
            with self.subTest(state=state),patch.object(versioning,'build_info',return_value=info),patch.object(versioning,'github',side_effect=[{'default_branch':'main'},{'sha':'b'*40},{'status':state,'ahead_by':1}]):
                result=versioning.check_updates(self.root,True)
                self.assertEqual(result['available'],expected)
                self.assertEqual(result['status'],state)

    def test_offline_check_is_unknown_not_up_to_date(self):
        info={'settings':{'repository':'https://github.com/owner/repo','branch':''},'commit':'a'*40,'dirty':False}
        with patch.object(versioning,'build_info',return_value=info),patch.object(versioning,'github',side_effect=URLError('offline')),patch.object(versioning,'check_with_git',return_value=None):
            result=versioning.check_updates(self.root,True)
            self.assertEqual(result['status'],'unknown');self.assertFalse(result['available'])

    def test_successful_checks_are_cached(self):
        info={'settings':{'repository':'https://github.com/owner/repo','branch':''},'commit':'a'*40,'dirty':False}
        with patch.object(versioning,'build_info',return_value=info),patch.object(versioning,'github',side_effect=[{'default_branch':'main'},{'sha':'a'*40}]) as github:
            self.assertEqual(versioning.check_updates(self.root)['status'],'current')
            self.assertEqual(versioning.check_updates(self.root)['status'],'current')
            self.assertEqual(github.call_count,2)

    def test_git_authentication_can_check_a_private_repository(self):
        remote=CompletedProcess([],0,stdout='ref: refs/heads/main\tHEAD\n'+'a'*40+'\tHEAD\n')
        with patch.object(versioning,'run_git',return_value=remote):
            result=versioning.check_with_git(self.root,{'repository':versioning.DEFAULT_REPOSITORY,'branch':''},'a'*40)
            self.assertEqual(result['status'],'current');self.assertEqual(result['method'],'git')

    def test_git_fallback_detects_remote_ahead_without_pulling(self):
        remote=CompletedProcess([],0,stdout='b'*40+'\trefs/heads/main\n')
        with patch.object(versioning,'run_git',side_effect=[remote,CompletedProcess([],0),CompletedProcess([],0),CompletedProcess([],1)]) as git:
            result=versioning.check_with_git(self.root,{'repository':versioning.DEFAULT_REPOSITORY,'branch':'main'},'a'*40)
            self.assertTrue(result['available'])
            self.assertFalse(any('pull' in call.args for call in git.call_args_list))

    def test_matching_rules_survive_repository_only_saves(self):
        rules=versioning.default_classification()
        rules['sprint']={'labels':['Iteration'],'lists':['Sprints'],'titlePrefixes':[]}
        versioning.save_settings(self.root,{'classification':rules})
        versioning.save_settings(self.root,{'repository':'https://github.com/owner/repo','branch':'main'})
        self.assertEqual(versioning.read_settings(self.root)['classification'],rules)
        self.assertEqual(versioning.read_settings(self.root)['repository'],'https://github.com/owner/repo')

    def test_empty_rules_disable_matching_and_invalid_rules_are_rejected(self):
        rules={kind:{field:[] for field in ['labels','lists','titlePrefixes']} for kind in ['deadline','blocker','sprint']}
        self.assertEqual(versioning.validate_classification(rules),rules)
        with self.assertRaises(ValueError):versioning.validate_classification({'sprint':{'labels':'Sprint'}})


if __name__=='__main__':unittest.main()
