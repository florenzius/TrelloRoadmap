import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('roadmap_server', Path(__file__).parents[1] / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class ServerTests(unittest.TestCase):
    def test_windows_encryption_round_trip(self):
        plain = b'{"key":"example","token":"local-test-only"}'
        encrypted = server.protect(plain)
        self.assertNotIn(b'local-test-only', encrypted)
        self.assertEqual(server.protect(encrypted, True), plain)

    def test_workspace_collects_all_boards_and_card_status(self):
        def fake_trello(path, params=None):
            if path.endswith('/boards'):
                return [{'id': 'board1', 'name': 'One'}, {'id': 'board2', 'name': 'Two'}]
            if path.endswith('/cards'):
                self.assertIn('labels',params['fields'].split(','))
                return [{'id': 'card', 'dueComplete': True, 'due': '2026-10-19','labels':[{'name':'Deadline'}]}]
            return []
        with patch.object(server, 'trello', side_effect=fake_trello):
            result = server.roadmap('a' * 24)
        self.assertEqual(len(result['boards']), 2)
        self.assertTrue(result['boards'][0]['cards'][0]['dueComplete'])
        self.assertEqual(result['boards'][0]['cards'][0]['labels'][0]['name'],'Deadline')

    def test_http_blocks_cross_origin_and_serves_no_secrets(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        root = f'http://127.0.0.1:{http.server_port}'
        try:
            with urlopen(root) as response:
                self.assertIn(b'Trello Roadmap', response.read())
            request = Request(root + '/api/connect', data=b'{}', headers={'Origin': 'https://example.com', 'X-Roadmap-Request': '1'})
            with self.assertRaises(HTTPError) as error:
                urlopen(request)
            self.assertEqual(error.exception.code, 403)
            with self.assertRaises(HTTPError) as error:
                urlopen(root + '/.local/connection.bin')
            self.assertEqual(error.exception.code, 404)
            with tempfile.TemporaryDirectory() as temporary:
                with patch.object(server, 'SECRET', Path(temporary) / 'secret.bin'), patch.object(server, 'trello', return_value={'id':'test'}):
                    request = Request(root+'/api/connect', data=json.dumps({'key':'a'*32,'token':'b'*64}).encode(), headers={'X-Roadmap-Request':'1','Content-Type':'application/json'})
                    with urlopen(request) as response:
                        self.assertTrue(json.load(response)['connected'])
                    self.assertEqual(server.credentials()['token'],'b'*64)
                    with urlopen(root+'/api/status') as response:
                        self.assertEqual(json.load(response),{'connected':True})
                    request = Request(root+'/api/disconnect', data=b'{}', headers={'X-Roadmap-Request':'1'})
                    with urlopen(request) as response:
                        self.assertFalse(json.load(response)['connected'])
        finally:
            http.shutdown()
            http.server_close()


if __name__ == '__main__':
    unittest.main()
