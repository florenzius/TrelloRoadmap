"""Local build identity and GitHub update checks without changing working files."""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

DEFAULT_REPOSITORY = 'https://github.com/florenzius/TrelloRoadmap'
LOCK = threading.RLock()
CACHE = {}


def default_classification():
    return {'deadline': {'labels': ['Deadline'], 'lists': [], 'titlePrefixes': ['Deadline']},
            'blocker': {'labels': ['Blocker'], 'lists': [], 'titlePrefixes': []},
            'sprint': {'labels': ['Sprint'], 'lists': [], 'titlePrefixes': []}}


def validate_classification(value):
    defaults = default_classification()
    if not isinstance(value, dict):
        raise ValueError('Matching rules must be an object.')
    result = {}
    for kind, default in defaults.items():
        rule = value.get(kind, default)
        if not isinstance(rule, dict):
            raise ValueError('Each matching rule must be an object.')
        result[kind] = {}
        for field in ('labels', 'lists', 'titlePrefixes'):
            terms = rule.get(field, default[field])
            if not isinstance(terms, list) or len(terms) > 20 or any(not isinstance(term, str) or len(term) > 120 for term in terms):
                raise ValueError('Use at most 20 matching terms of up to 120 characters each.')
            result[kind][field] = list(dict.fromkeys(term.strip() for term in terms if term.strip()))
    return result


def normalize_repository(value):
    value = str(value).strip()
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or parsed.netloc.lower() != 'github.com' or parsed.query or parsed.fragment:
        raise ValueError('Use an HTTPS GitHub repository URL, for example https://github.com/owner/repository.')
    path = parsed.path.rstrip('/')
    if path.endswith('.git'):
        path = path[:-4]
    if not re.fullmatch(r'/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}', path):
        raise ValueError('Enter a GitHub repository URL containing its owner and repository name.')
    if path.split('/')[-1] in ('.', '..'):
        raise ValueError('Invalid repository name.')
    return 'https://github.com' + path


def git(root, *args):
    executable = shutil.which('git')
    if not executable:
        return ''
    try:
        result = subprocess.run([executable, '-C', str(root), *args], capture_output=True,
                                text=True, timeout=8, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return result.stdout.strip() if result.returncode == 0 else ''
    except (OSError, subprocess.TimeoutExpired):
        return ''


def run_git(root, *args):
    executable = shutil.which('git')
    if not executable:
        raise OSError('Git is not installed.')
    return subprocess.run([executable, '-C', str(root), *args], capture_output=True,
                          text=True, timeout=30, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                          env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'})


def check_with_git(root, settings, local_commit):
    """Use existing Git credentials for private repositories; never pull the worktree."""
    ref = 'refs/heads/' + settings['branch'] if settings['branch'] else 'HEAD'
    remote = run_git(root, 'ls-remote', '--symref', settings['repository'], ref)
    if remote.returncode:
        return None
    branch = settings['branch']
    latest = None
    for line in remote.stdout.splitlines():
        if line.startswith('ref: refs/heads/'):
            branch = line.split('\t')[0].removeprefix('ref: refs/heads/')
        elif re.match(r'^[a-f0-9]{40}\s', line):
            latest = line.split()[0]
    if not latest or not local_commit:
        return None
    result = {'latestCommit': latest, 'branch': branch, 'method': 'git'}
    if local_commit == latest:
        return {**result, 'status': 'current', 'available': False, 'message': 'This checkout is up to date with GitHub.'}
    fetched = run_git(root, 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', settings['repository'], branch or 'HEAD')
    if fetched.returncode:
        return None
    ahead = run_git(root, 'merge-base', '--is-ancestor', local_commit, latest).returncode
    behind = run_git(root, 'merge-base', '--is-ancestor', latest, local_commit).returncode
    if ahead not in (0, 1) or behind not in (0, 1):
        return None
    if ahead == 0:
        return {**result, 'status': 'ahead', 'available': True,
                'message': 'A newer version is available on GitHub. Pull or re-clone the repository, then restart Trello Roadmap.'}
    return {**result, 'status': 'behind' if behind == 0 else 'diverged', 'available': False,
            'message': 'This checkout contains local commits ahead of GitHub.' if behind == 0 else 'Local and GitHub history have diverged. Review your checkout before updating.'}
def read_settings(root):
    defaults = {'repository': DEFAULT_REPOSITORY, 'branch': '', 'classification': default_classification()}
    path = root / '.local' / 'settings.json'
    try:
        saved = json.loads(path.read_text(encoding='utf-8'))
        return {'repository': normalize_repository(saved.get('repository', DEFAULT_REPOSITORY)),
                'branch': validate_branch(saved.get('branch', '')),
                'classification': validate_classification(saved.get('classification', default_classification()))}
    except (OSError, ValueError, TypeError, AttributeError):
        return defaults


def validate_branch(value):
    branch = str(value).strip()
    if len(branch) > 150 or (branch and not re.fullmatch(r'[A-Za-z0-9_./-]+', branch)) or '..' in branch:
        raise ValueError('Enter a valid branch name, or leave it blank to use the default branch.')
    return branch


def save_settings(root, body):
    with LOCK:
        current = read_settings(root)
        settings = {'repository': normalize_repository(body.get('repository', current['repository'])),
                    'branch': validate_branch(body.get('branch', current['branch'])),
                    'classification': validate_classification(body.get('classification', current['classification']))}
        path = root / '.local' / 'settings.json'
        path.parent.mkdir(exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(settings), encoding='utf-8')
        temporary.replace(path)
        CACHE.clear()
    return settings


def build_info(root):
    # Hash executable source only: no credentials, browser settings, or personal data.
    paths = [root / name for name in ('server.py', 'versioning.py', 'Start-Roadmap.cmd')]
    paths += sorted((root / 'public').glob('*'))
    digest = hashlib.sha256()
    for path in paths:
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(b'\0')
            digest.update(path.read_bytes())
    source_hash = digest.hexdigest()
    with LOCK:
        path = root / '.local' / 'build-info.json'
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            saved = {}
        if saved.get('hash') != source_hash or not saved.get('builtAt'):
            saved = {'hash': source_hash, 'builtAt': datetime.now(timezone.utc).isoformat(timespec='seconds')}
            path.parent.mkdir(exist_ok=True)
            path.write_text(json.dumps(saved), encoding='utf-8')
    commit = git(root, 'rev-parse', 'HEAD')
    return {**saved, 'shortHash': source_hash[:12], 'commit': commit or None,
            'dirty': bool(git(root, 'status', '--porcelain', '--untracked-files=normal')),
            'gitBranch': git(root, 'branch', '--show-current') or None,
            'settings': read_settings(root)}


def github(path):
    request = Request('https://api.github.com/' + path, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'TrelloRoadmap',
        'X-GitHub-Api-Version': '2022-11-28'})
    # Never reuse the user's Trello token for a different service.
    with urlopen(request, timeout=12) as response:
        return json.load(response)


def check_updates(root, force=False):
    info = build_info(root)
    settings = info['settings']
    key = (settings['repository'], settings['branch'], info['commit'])
    with LOCK:
        cached = CACHE.get(key)
        if not force and cached and time.monotonic() - cached[0] < 900:
            return cached[1]
    result = {'status': 'unknown', 'available': False, 'repository': settings['repository'],
              'branch': settings['branch'], 'localCommit': info['commit'], 'dirty': info['dirty']}
    try:
        repo = settings['repository'].removeprefix('https://github.com/')
        metadata = github('repos/' + repo)
        branch = settings['branch'] or metadata['default_branch']
        result['branch'] = branch
        latest = github('repos/' + repo + '/commits/' + quote(branch, safe=''))
        result['latestCommit'] = latest['sha']
        if not info['commit']:
            result['message'] = 'Clone this repository with Git to enable version comparisons.'
        elif info['commit'] == latest['sha']:
            result.update(status='current', message='This checkout is up to date with GitHub.')
        else:
            comparison = github('repos/' + repo + '/compare/' + info['commit'] + '...' + latest['sha'])
            state = comparison['status']
            result.update(status=state, available=state == 'ahead' and comparison.get('ahead_by', 0) > 0)
            result['message'] = {
                'ahead': 'A newer version is available on GitHub. Pull or re-clone the repository, then restart Trello Roadmap.',
                'behind': 'This checkout contains local commits ahead of GitHub.',
                'diverged': 'Local and GitHub history have diverged. Review your checkout before updating.',
                'identical': 'This checkout is up to date with GitHub.',
            }.get(state, 'Could not determine whether an update is available.')
    except HTTPError as error:
        error.close()
        result['message'] = {403: 'GitHub update check is rate-limited or access is unavailable. Try again later.',
                             429: 'GitHub update check is rate-limited. Try again later.',
                             404: 'Repository, branch, or commit could not be accessed. For private repositories, sign in with Git on this computer and retry.'}.get(error.code, 'GitHub update check failed. Try again later.')
    except (URLError, TimeoutError, OSError, ValueError, KeyError, TypeError):
        result['message'] = 'GitHub could not be reached or returned an invalid response. Update status is unknown.'
    if result['status'] == 'unknown' and info['commit']:
        try:
            fallback = check_with_git(root, settings, info['commit'])
            if fallback:
                result.update(fallback)
        except (OSError, subprocess.TimeoutExpired):
            result['message'] += ' Git authentication was also unavailable; sign in with Git on this computer and try again.'
    with LOCK:
        CACHE[key] = (time.monotonic(), result)
    return result
