import http.server
import socketserver
import socket
import threading
import json
import time
import select
import os 

# --- Configuración ---
WEB_PORT = 8000
TCP_HOST = "127.0.0.1" 
TCP_PORT = 5000
TIMEOUT_SECONDS = 120.0 

# --- Estado Global ---
class AppState:
    def __init__(self):
        self.tcp_socket = None
        self.connected = False
        self.messages_queue = []
        self.lock = threading.Lock()
        self.username = ""
        self.last_activity = time.time()

state = AppState()

# --- UTILIDAD: Obtener IP Local ---
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except:
        return "127.0.0.1"

# --- Hilo: Monitor de Conexión ---
def connection_watchdog():
    while True:
        time.sleep(5)
        if state.connected:
            elapsed = time.time() - state.last_activity
            if elapsed > TIMEOUT_SECONDS:
                print(f"⚠️ Inactividad ({elapsed:.0f}s). Liberando recursos.")
                cerrar_conexion_tcp()

def cerrar_conexion_tcp():
    with state.lock:
        if state.connected:
            print(f"🔴 Cerrando conexión TCP de {state.username}")
            if state.tcp_socket:
                try: state.tcp_socket.close()
                except: pass
            state.connected = False
            state.tcp_socket = None
            state.username = ""
            state.messages_queue.append({"type": "status", "payload": "🔴 Desconectado"})

# --- Hilo: Recepción TCP ---
def tcp_receiver():
    print("👂 Hilo de recepción iniciado.")
    buffer_bytes = b""
    
    while state.connected and state.tcp_socket:
        try:
            ready_to_read, _, _ = select.select([state.tcp_socket], [], [], 1.0)
            if ready_to_read:
                data = state.tcp_socket.recv(4096)
                if not data: break
                
                buffer_bytes += data
                while b"\n" in buffer_bytes:
                    line_bytes, buffer_bytes = buffer_bytes.split(b"\n", 1)
                    line_str = line_bytes.decode('utf-8').strip()
                    if line_str:
                        try:
                            msg_json = json.loads(line_str)
                            with state.lock:
                                state.messages_queue.append(msg_json)
                        except: pass
        except: break
            
    cerrar_conexion_tcp()

# --- Servidor HTTP ---
class ChatRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass 

    def do_GET(self):
        state.last_activity = time.time()
        
        if self.path == '/poll':
            msgs = []
            with state.lock:
                if state.messages_queue:
                    msgs = state.messages_queue[:]
                    state.messages_queue.clear()
            self.respond_json(msgs)
            
        elif self.path == '/' or self.path == '/index.html':
            self.send_file("index.html", "text/html")
        elif self.path == '/style.css':
            self.send_file("style.css", "text/css")
        elif self.path == '/script.js':
            self.send_file("script.js", "application/javascript")
            
        # --- RUTA PARA JUEGOS ---
        elif self.path.startswith('/games/'):
            # Busca el archivo dentro de la carpeta MignaGames
            filename = self.path.split('/games/')[1]
            file_path = os.path.join("MignaGames", filename)
            if os.path.exists(file_path):
                self.send_file(file_path, "text/html")
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self):
        state.last_activity = time.time()
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        response = {"status": "ok"}

        if self.path == '/connect':
            self.handle_connect(body, response)
        elif self.path == '/send':
            self.handle_send(body, response)
        elif self.path == '/disconnect':
            cerrar_conexion_tcp()
        
        self.respond_json(response)

    def send_file(self, filename, content_type):
        try:
            with open(filename, "rb") as f:
                self.send_response(200)
                self.send_header("Content-type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(f.read())
        except: self.send_error(404)

    def respond_json(self, data):
        try:
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        except: pass

    def handle_connect(self, body, response):
        try:
            data = json.loads(body)
            username = data.get("username")
            if not state.connected:
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(5.0)
                s.connect((TCP_HOST, TCP_PORT))
                s.settimeout(None)
                s.sendall(username.encode('utf-8'))
                
                state.tcp_socket = s
                state.connected = True
                state.username = username
                threading.Thread(target=tcp_receiver, daemon=True).start()
                response["msg"] = "Conectado"
                print(f"✅ Conexión TCP establecida: {username}")
            else:
                response["msg"] = "Ya conectado"
        except Exception as e:
            print(f"❌ Error conectando: {e}")
            response["status"] = "error"
            response["msg"] = str(e)

    def handle_send(self, body, response):
        if state.connected:
            try:
                msg = json.loads(body).get("message")
                state.tcp_socket.sendall(msg.encode('utf-8'))
            except: response["status"] = "error"

class ThreadingHTTPServer(socketserver.ThreadingTCPServer):
    daemon_threads = True

if __name__ == "__main__":
    threading.Thread(target=connection_watchdog, daemon=True).start()
    lan_ip = get_local_ip()
    
    print("="*50)
    print(f"🚀 CLIENTE WEB INICIADO (Puerto {WEB_PORT})")
    print(f"🌍 Acceso LAN: http://{lan_ip}:{WEB_PORT}")
    print("="*50)
    
    try:
        import webbrowser
        webbrowser.open(f"http://localhost:{WEB_PORT}")
    except: pass
    
    server = ThreadingHTTPServer(("", WEB_PORT), ChatRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        cerrar_conexion_tcp()
        server.server_close()