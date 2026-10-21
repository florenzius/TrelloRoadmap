"""Local, read-only Trello roadmap. Python 3.11+, no packages required."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, parse_qs
from urllib.request import Request, urlopen
import webbrowser
import argparse
import versioning

ROOT = Path(__file__).resolve().parent
SECRET = ROOT / '.local' / 'connection.bin'
LOCK = threading.Lock()


def protect(data, decrypt=False):
    # Windows DPAPI binds the saved connection to the current Windows account.
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    target = Blob()
    crypt = ctypes.windll.crypt32
    if decrypt:
        success = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        success = crypt.CryptProtectData(ctypes.byref(source), 'Roadmap', None, None, None, 1, ctypes.byref(target))
    if not success:
        raise OSError('The local encrypted connection could not be read or saved.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


def credentials():
    with LOCK:
        if not SECRET.exists():
            raise ValueError('Connect Trello first.')
        return json.loads(protect(SECRET.read_bytes(), True))


def trello(path, params=None, auth=None):
    auth = auth or credentials()
    url = 'https://api.trello.com/1/' + path + '?' + urlencode(params or {})
    request = Request(url, headers={'Authorization': f'OAuth oauth_consumer_key="{auth["key"]}", oauth_token="{auth["token"]}"', 'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=25) as response:
            return json.load(response)
    except HTTPError as error:
        messages = {401: 'Trello credentials are invalid or expired. Please reconnect.', 403: 'Access to this Trello workspace was denied.', 429: 'Trello received too many requests. Wait briefly and refresh.'}
        raise ValueError(messages.get(error.code, f'Could not load Trello (HTTP {error.code}).')) from None
    except (URLError, TimeoutError):
        raise ValueError('Trello is unreachable. Check your internet connection and refresh.') from None


def roadmap(workspace):
    if not re.fullmatch(r'[a-f0-9]{24}', workspace):
        raise ValueError('Select a valid workspace.')
    boards = trello(f'organizations/{workspace}/boards', {'filter': 'open', 'fields': 'name,url,closed'})

    def load(board):
        board_id = board['id']
        lists = trello(f'boards/{board_id}/lists', {'filter': 'all', 'fields': 'name'})
        members = trello(f'boards/{board_id}/members', {'fields': 'fullName,initials,username'})
        cards = trello(f'boards/{board_id}/cards', {'filter': 'open', 'fields': 'name,start,due,dueComplete,idList,idMembers,url,closed,labels'})
        return {**board, 'lists': lists, 'members': members, 'cards': cards}

    # Do not silently present incomplete data if one board fails.
    with ThreadPoolExecutor(max_workers=3) as executor:
        result = list(executor.map(load, boards))
    return {'boards': result}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)

    def log_message(self, *_):
        pass  # Never log request bodies or Trello credentials.

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        super().end_headers()

    def local_request(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        return self.headers.get('Host') in (expected, f'localhost:{self.server.server_port}')

    def reply(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.local_request():
            return self.reply({'error': 'Local access required.'}, 403)
        parsed = urlsplit(self.path)
        try:
            if parsed.path == '/api/status':
                return self.reply({'connected': SECRET.exists()})
            if parsed.path == '/api/version':
                return self.reply(versioning.build_info(ROOT))
            if parsed.path == '/api/updates':
                return self.reply(versioning.check_updates(ROOT, parse_qs(parsed.query).get('force') == ['1']))
            if parsed.path == '/api/workspaces':
                return self.reply(trello('members/me/organizations', {'fields': 'displayName,name'}))
            if parsed.path == '/api/roadmap':
                return self.reply(roadmap(parse_qs(parsed.query).get('workspace', [''])[0]))
            if parsed.path.startswith('/api/'):
                return self.reply({'error': 'Not found.'}, 404)
            if parsed.path not in ('/', '/index.html', '/app.js', '/updates.js', '/timeline.mjs', '/style.css'):
                return self.reply({'error': 'Not found.'}, 404)
            return super().do_GET()
        except (ValueError, OSError):
            import sys
            error = sys.exc_info()[1]
            return self.reply({'error': str(error)}, 400)

    def do_POST(self):
        origin = self.headers.get('Origin')
        if not self.local_request() or self.headers.get('X-Roadmap-Request') != '1' or (origin and origin != 'http://' + self.headers.get('Host', '')):
            return self.reply({'error': 'Local access required.'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 8192:
                raise ValueError('Invalid request.')
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError('Invalid request.')
            if self.path == '/api/settings':
                return self.reply(versioning.save_settings(ROOT, body))
            if self.path == '/api/connect':
                auth = {name: str(body.get(name, '')).strip() for name in ('key', 'token')}
                if not re.fullmatch(r'[a-fA-F0-9]{32}', auth['key']) or not re.fullmatch(r'[a-zA-Z0-9]{32,256}', auth['token']):
                    raise ValueError('Enter a valid Trello API key and token.')
                trello('members/me', {'fields': 'id'}, auth)
                with LOCK:
                    SECRET.parent.mkdir(exist_ok=True)
                    temporary = SECRET.with_suffix('.tmp')
                    temporary.write_bytes(protect(json.dumps(auth).encode()))
                    os.replace(temporary, SECRET)
                return self.reply({'connected': True})
            if self.path == '/api/disconnect':
                with LOCK:
                    SECRET.unlink(missing_ok=True)
                return self.reply({'connected': False})
            return self.reply({'error': 'Not found.'}, 404)
        except (ValueError, OSError) as error:
            return self.reply({'error': str(error)}, 400)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Roadmap is running at http://127.0.0.1:{args.port}', flush=True)
    if not args.no_browser:
        webbrowser.open(f'http://127.0.0.1:{args.port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
