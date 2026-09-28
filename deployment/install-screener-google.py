import json
from pathlib import Path

credential_path = Path('/tmp/screener-google-oauth.json')
env_path = Path('/etc/arsant-screener.env')
credentials = json.loads(credential_path.read_text(encoding='utf-8'))['web']
updates = {
    'SCREENER_GOOGLE_CLIENT_ID': credentials['client_id'],
    'SCREENER_GOOGLE_CLIENT_SECRET': credentials['client_secret'],
}
lines = env_path.read_text(encoding='utf-8').splitlines()
seen = set()
output = []
for line in lines:
    key = line.split('=', 1)[0] if '=' in line else ''
    if key in updates:
        output.append(f'{key}={updates[key]}')
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f'{key}={value}')
env_path.write_text('\n'.join(output) + '\n', encoding='utf-8')
