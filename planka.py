"""Read Planka v2 projects into the existing Roadmap board format."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from hashlib import sha256
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def base_url(value):
    value = str(value).strip().rstrip('/')
    try:
        url = urlsplit(value)
        url.port  # Reject malformed ports.
        if (len(value) <= 1024 and url.scheme in ('https', 'http')
                and url.hostname and '@' not in url.netloc
                and not re.search(r'[\\\s\x00-\x1f\x7f?#]', value)
                and re.fullmatch(r'[a-zA-Z0-9.\-:\[\]]+', url.netloc)
                and re.fullmatch(r'[a-zA-Z0-9._~/-]*', url.path)
                and not {'.', '..'}.intersection(url.path.split('/'))):
            return url._replace(netloc=url.netloc.lower()).geturl()
    except ValueError:
        pass
    raise ValueError('Enter the Planka server URL, for example https://planka.example.com.')


def get(auth, path):
    request = Request(auth['url'] + '/api/' + path, headers={
        'X-Api-Key': auth['key'], 'Accept': 'application/json',
    })
    try:
        with build_opener(NoRedirects()).open(request, timeout=25) as response:
            data = json.load(response)
            if isinstance(data, dict):
                return data
    except HTTPError as error:
        with error:
            status = error.code
        if 300 <= status < 400:
            raise ValueError('Planka redirected the request. Use the final Planka server URL.') from None
        if status in (401, 403):
            raise ValueError('Planka denied access. Check the API key and project permissions.') from None
        raise ValueError(f'Could not load Planka (HTTP {status}).') from None
    except (URLError, TimeoutError, OSError):
        raise ValueError('Could not reach Planka. Check its URL and connection.') from None
    except ValueError:
        pass
    raise ValueError('The server did not return Planka API data. Check the URL and Planka version.')


def records(data, field):
    value = data.get(field)
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError('Unexpected Planka API response. Check that the server is running Planka v2.')
    return value


def included(data):
    value = data.get('included')
    if not isinstance(value, dict):
        raise ValueError('Unexpected Planka API response. Check that the server is running Planka v2.')
    return value


def index(items):
    return {item['id']: item for item in items}


def scope(auth):
    return 'planka:' + sha256(auth['url'].encode()).hexdigest()[:16] + ':'


def projects(auth):
    return records(get(auth, 'projects'), 'items')


def start_date(value):
    match = re.fullmatch(r'([0-9]{2})\.([0-9]{2})\.([0-9]{4})', value.strip())
    if not match:
        return None
    day, month, year = map(int, match.groups())
    try:
        # No timezone suffix: the date represents midnight on the viewer's calendar.
        return date(year, month, day).isoformat() + 'T00:00:00'
    except ValueError:
        return None


def normalize_board(board, data, project_data, auth):
    related = included(data)
    labels = index(records(related, 'labels'))
    lists = index(records(related, 'lists'))
    members = records(related, 'users')
    base_groups = index(project_data.get('baseCustomFieldGroups', []))
    groups = index(related.get('customFieldGroups', []))
    fields = index(project_data.get('customFields', []) + related.get('customFields', []))
    card_labels, card_members, starts = defaultdict(list), defaultdict(list), defaultdict(set)
    for link in records(related, 'cardLabels'):
        if label := labels.get(link['labelId']):
            card_labels[link['cardId']].append({'name': label['name']})
    prefix = scope(auth)
    for link in records(related, 'cardMemberships'):
        card_members[link['cardId']].append(prefix + link['userId'])
    for value in related.get('customFieldValues', []):
        group = groups.get(value['customFieldGroupId'], {})
        name = group.get('name') or base_groups.get(group.get('baseCustomFieldGroupId'), {}).get('name')
        field = fields.get(value['customFieldId'], {})
        if name == 'Startdatum' and field.get('name') == 'Datum (DD.MM.YYYY)':
            if content := value['content'].strip():
                starts[value['cardId']].add(content)

    invalid = 0
    cards = []
    for card in records(related, 'cards'):
        if ('template' in card['name'].casefold()
                or lists.get(card['listId'], {}).get('type') in ('archive', 'trash')):
            continue
        card_id = card['id']
        if not re.fullmatch(r'[0-9]+', card_id):
            raise ValueError('Planka returned an invalid card ID.')
        values = starts[card_id]
        start = start_date(next(iter(values))) if len(values) == 1 else None
        invalid += bool(values) and start is None
        cards.append({'id': card_id, 'name': card['name'], 'idList': card['listId'],
                      'idMembers': card_members[card_id], 'labels': card_labels[card_id],
                      'start': start, 'due': card.get('dueDate'),
                      'dueComplete': card.get('isDueCompleted') is True or card.get('isClosed') is True,
                      'url': auth['url'] + '/cards/' + card_id})
    return ({'id': prefix + board['id'], 'name': board['name'],
             'lists': [{'id': item['id'], 'name': item.get('name')} for item in lists.values()],
             'members': [{'id': prefix + member['id'], 'fullName': member.get('name'),
                          'username': member.get('username')} for member in members],
             'cards': cards}, invalid)


def roadmap(auth, project_id):
    if not re.fullmatch(r'[0-9]{1,32}', project_id):
        raise ValueError('Select a valid Planka project.')
    data = get(auth, 'projects')
    if not any(project['id'] == project_id for project in records(data, 'items')):
        raise ValueError('This Planka project is not available to the connected account.')
    project_data = included(data)
    boards = [board for board in records(project_data, 'boards') if board['projectId'] == project_id]

    def load(board):
        if not re.fullmatch(r'[0-9]+', board['id']):
            raise ValueError('Planka returned an invalid board ID.')
        return normalize_board(board, get(auth, 'boards/' + board['id']), project_data, auth)

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(load, boards))
    return {'boards': [board for board, _ in results],
            'invalidStarts': sum(invalid for _, invalid in results)}
