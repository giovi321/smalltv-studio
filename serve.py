#!/usr/bin/env python3
"""Serve SmallTV Studio locally and relay theme uploads to a SmallTV Pro (stdlib only).

    npm run build && python3 serve.py [port]    # http://localhost:4173/

It serves the built editor from dist/. During development, run it next to `npm run dev`:
Vite forwards /__device/ requests here.

Browsers cannot read the device's answers because the firmware sends no CORS headers,
so the editor talks to the TV through this server instead. The relay is deliberately narrow:
it listens on 127.0.0.1 only, forwards only the firmware's theme API routes, only to
private-network addresses, and only for requests that carry the editor's custom header
(which other websites cannot add without a CORS preflight this server never approves).
"""
import ipaddress
import re
import socket
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent / 'dist'
PREFIX = '/__device/'
GUARD_HEADER = 'X-SmallTV-Studio'
ALLOWED = {('GET', '/api/status'), ('GET', '/api/themes'), ('POST', '/api/themes/install'),
           ('POST', '/api/themes/select'), ('POST', '/api/themes/delete')}
MAX_BODY = 4 * 1024 * 1024
TIMEOUT = 60
HOST_RE = re.compile(r'^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:\d{1,5})?$')


def resolve(hostport):
    """Return (ip, port, original host) for a device address, or raise ValueError."""
    if not HOST_RE.match(hostport):
        raise ValueError('Enter an IP address or host name, for example 192.168.1.42.')
    host, _, port = hostport.partition(':')
    port = int(port) if port else 80
    if not 1 <= port <= 65535:
        raise ValueError('The port must be between 1 and 65535.')
    try:
        infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
    except socket.gaierror:
        raise ValueError(f'Cannot find "{host}" on this network.') from None
    ip = infos[0][4][0]
    address = ipaddress.ip_address(ip)
    if not (address.is_private or address.is_link_local):
        raise ValueError('Only devices on your local network are allowed.')
    return ip, port, host


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith(PREFIX + 'ping'):
            super().log_message(fmt, *args)

    def reply(self, code, payload, content_type='application/json'):
        body = payload if isinstance(payload, bytes) else payload.encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, code, message):
        import json
        self.reply(code, json.dumps({'error': message}))

    def do_GET(self):
        if self.path.startswith(PREFIX):
            return self.relay('GET')
        super().do_GET()

    def do_HEAD(self):
        if self.path.startswith(PREFIX):
            return self.fail(405, 'Not allowed')
        super().do_HEAD()

    def do_POST(self):
        if self.path.startswith(PREFIX):
            return self.relay('POST')
        self.fail(405, 'Not allowed')

    def relay(self, method):
        if self.headers.get(GUARD_HEADER) != '1':
            return self.fail(403, 'Missing editor header.')
        rest = urlsplit(self.path).path[len(PREFIX):]
        if rest == 'ping':
            return self.reply(200, '{"relay":true}')
        hostport, _, tail = rest.partition('/')
        path = '/' + tail
        if (method, path) not in ALLOWED:
            return self.fail(403, 'This route is not relayed.')
        try:
            ip, port, host = resolve(hostport)
        except ValueError as error:
            return self.fail(400, str(error))
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            return self.fail(413, 'The package is too large.')
        body = self.rfile.read(length) if length else None
        request = urllib.request.Request(f'http://{ip}:{port}{path}', data=body, method=method)
        request.add_header('Host', hostport)
        if self.headers.get('Content-Type'):
            request.add_header('Content-Type', self.headers['Content-Type'])
        opener = urllib.request.build_opener()
        user, password = self.headers.get('X-Device-User'), self.headers.get('X-Device-Pass')
        if user is not None and password is not None:
            manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            manager.add_password(None, f'http://{ip}:{port}/', user, password)
            opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(manager))
        try:
            with opener.open(request, timeout=TIMEOUT) as response:
                return self.reply(response.status, response.read(), response.headers.get('Content-Type', 'application/json'))
        except urllib.error.HTTPError as error:
            data = error.read()
            if error.code == 401:
                return self.fail(401, 'The TV asks for a password, or the password is wrong.')
            return self.reply(error.code, data, error.headers.get('Content-Type', 'application/json'))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            reason = getattr(error, 'reason', error)
            return self.fail(502, f'Cannot reach the TV at {hostport}: {reason}')


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    if not (ROOT / 'index.html').is_file():
        print('dist/index.html is missing: run `npm run build` first (the TV relay still works for `npm run dev`).')
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'SmallTV Studio: http://localhost:{port}/  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
