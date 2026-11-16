#!/usr/bin/env python3
# MQ Server: serve esta pasta na rede local, com CORS (para o MQ Creator e o MQ Server Client).
# Uso: python3 servir.py [porta]   (por omissão 8080)
import http.server, socket, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.mqs': 'application/octet-stream', '.webmanifest': 'application/manifest+json',
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'}
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()
    def log_message(self, fmt, *a):
        pass

def ips():
    out = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('10.255.255.255', 1)); out.add(s.getsockname()[0]); s.close()
    except Exception:
        pass
    try:
        for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET): out.add(i[4][0])
    except Exception:
        pass
    return sorted(x for x in out if not x.startswith('127.'))

srv = http.server.ThreadingHTTPServer(('', PORT), H)
print('MQ Server a correr. Escreva um destes enderecos no MQ Creator ou no MQ Server Client:')
print('  neste computador:  http://localhost:%d/' % PORT)
for ip in ips():
    print('  na rede local:     http://%s:%d/' % (ip, PORT))
print('Ctrl+C para parar.')
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
