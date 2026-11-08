import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import planka
import server


API_KEY = 'fixture-api-key'
PROJECTS = {
    'items': [{'id': '100', 'name': 'Example project'}, {'id': '101', 'name': 'Other project'}],
    'included': {
        'boards': [{'id': '200', 'projectId': '100', 'name': 'Planning'},
                   {'id': '201', 'projectId': '100', 'name': 'Engineering'},
                   {'id': '202', 'projectId': '101', 'name': 'Other board'}],
        'baseCustomFieldGroups': [{'id': '300', 'name': 'Startdatum'}],
        'customFields': [{'id': '400', 'name': 'Datum (DD.MM.YYYY)'}],
    },
}


def board_data():
    return {'included': {
        'lists': [{'id': '500', 'name': 'To do', 'type': 'active'},
                  {'id': '501', 'name': 'Archive', 'type': 'archive'}],
        'users': [{'id': '600', 'name': 'Example Person'}],
        'labels': [{'id': '700', 'name': 'Sprint'}],
        'cardLabels': [{'cardId': '800', 'labelId': '700'}],
        'cardMemberships': [{'cardId': '800', 'userId': '600'}],
        'cards': [{'id': '800', 'name': 'Example sprint', 'listId': '500',
                   'dueDate': '2026-11-16T11:00:00.000Z', 'isDueCompleted': True},
                  {'id': '801', 'name': 'Due only', 'listId': '500', 'dueDate': '2026-11-12T11:00:00Z'},
                  {'id': '802', 'name': 'Archived', 'listId': '501'},
                  {'id': '803', 'name': 'Invalid date', 'listId': '500', 'dueDate': '2026-11-16T11:00:00Z'},
                  {'id': '804', 'name': 'Board field', 'listId': '500'}],
        'customFieldGroups': [{'id': '301', 'name': None, 'baseCustomFieldGroupId': '300'},
                              {'id': '302', 'name': 'Other group'},
                              {'id': '303', 'name': 'Startdatum'}],
        'customFields': [{'id': '401', 'name': 'Datum (DD.MM.YYYY)'}],
        'customFieldValues': [
            {'cardId': '800', 'customFieldGroupId': '301', 'customFieldId': '400', 'content': ' 06.11.2026 '},
            {'cardId': '801', 'customFieldGroupId': '302', 'customFieldId': '401', 'content': '01.11.2026'},
            {'cardId': '803', 'customFieldGroupId': '301', 'customFieldId': '400', 'content': '31.11.2026'},
            {'cardId': '804', 'customFieldGroupId': '303', 'customFieldId': '401', 'content': '07.11.2026'},
        ],
    }}


class PlankaFixture(server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.server.paths.append(self.path)
        if self.headers.get('X-Api-Key') != API_KEY:
            self.send_error(401)
            return
        if self.path == '/redirect/api/projects':
            self.send_response(302)
            self.send_header('Location', '/fixture/api/projects')
            self.end_headers()
            return
        if self.path == '/fixture/api/projects':
            payload = PROJECTS
        elif self.path == '/fixture/api/boards/200':
            payload = board_data()
        elif self.path == '/fixture/api/boards/201':
            payload = {'included': {field: [] for field in board_data()['included']}}
        else:
            self.send_error(404)
            return
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)


class PlankaTests(unittest.TestCase):
    def start_server(self, handler):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        http.paths = []
        worker = threading.Thread(target=http.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(http.server_close)
        self.addCleanup(http.shutdown)
        return http, f'http://127.0.0.1:{http.server_port}'

    def test_connect_and_load_project_without_overwriting_trello(self):
        remote, url = self.start_server(PlankaFixture)
        _, root = self.start_server(server.Handler)
        with tempfile.TemporaryDirectory() as temporary:
            trello_secret = Path(temporary) / 'connection.bin'
            planka_secret = Path(temporary) / 'planka.bin'
            original = server.protect(b'{"key":"existing","token":"existing"}')
            trello_secret.write_bytes(original)
            with patch.object(server, 'SECRET', trello_secret), patch.object(server, 'PLANKA_SECRET', planka_secret):
                def api(path, body=None):
                    request = Request(root + path, data=json.dumps(body).encode() if body is not None else None,
                                      headers={'X-Roadmap-Request': '1', 'Content-Type': 'application/json'})
                    with urlopen(request) as response:
                        return json.load(response)

                status = api('/api/connect', {'provider': 'planka', 'url': url + '/fixture/', 'key': API_KEY})
                self.assertEqual(status, {'connected': True, 'providers': {'trello': True, 'planka': True},
                                          'plankaUrl': url + '/fixture'})
                self.assertNotIn(API_KEY.encode(), planka_secret.read_bytes())
                self.assertEqual(api('/api/status'), status)
                self.assertEqual(api('/api/workspaces?provider=planka')[0]['name'], 'Example project')
                result = api('/api/roadmap?provider=planka&workspace=100')
                self.assertEqual([board['name'] for board in result['boards']], ['Planning', 'Engineering'])
                board = result['boards'][0]
                cards = {card['id']: card for card in board['cards']}
                self.assertEqual(cards['800']['start'], '2026-11-06T00:00:00')
                self.assertEqual(cards['800']['due'], '2026-11-16T11:00:00.000Z')
                self.assertEqual(cards['800']['url'], url + '/fixture/cards/800')
                self.assertTrue(cards['800']['dueComplete'])
                self.assertEqual(cards['800']['idMembers'], [board['members'][0]['id']])
                self.assertEqual(cards['800']['labels'], [{'name': 'Sprint'}])
                self.assertIsNone(cards['801']['start'])
                self.assertNotIn('802', cards)
                self.assertIsNone(cards['803']['start'])
                self.assertEqual(result['invalidStarts'], 1)
                self.assertEqual(cards['804']['start'], '2026-11-07T00:00:00')
                self.assertNotIn('/fixture/api/boards/202', remote.paths)
                self.assertEqual(api('/api/disconnect', {'provider': 'planka'})['providers'],
                                 {'trello': True, 'planka': False})
                self.assertFalse(planka_secret.exists())
                self.assertEqual(trello_secret.read_bytes(), original)

    def test_wrong_key_and_redirect_are_rejected(self):
        remote, url = self.start_server(PlankaFixture)
        with self.assertRaisesRegex(ValueError, 'denied access'):
            planka.projects({'url': url + '/fixture', 'key': 'wrong'})
        with self.assertRaisesRegex(ValueError, 'redirected'):
            planka.projects({'url': url + '/redirect', 'key': API_KEY})
        self.assertEqual(remote.paths, ['/fixture/api/projects', '/redirect/api/projects'])

    def test_url_rejects_credentials_and_non_http_schemes(self):
        for url in ('file:///test', 'https://name:password@server', 'https://server#fragment',
                    'https://server:invalid', 'https://server/../other', r'https://server\\other'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                planka.base_url(url)

    def test_date_parser_validates_real_dates(self):
        self.assertEqual(planka.start_date('29.02.2028'), '2028-02-29T00:00:00')
        for value in ('29.02.2026', '2026-11-06', '06/11/2026', ''):
            with self.subTest(value=value):
                self.assertIsNone(planka.start_date(value))
