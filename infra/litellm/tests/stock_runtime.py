"""Test-only mock HTTP server and stock CLI supervisor. Never a proxy callback.

No imports/patches of LiteLLM, no provider credentials, no forwarding requests.
One unmodified litellm process runs against this loopback upstream at a time.
"""
import json
import os
import select
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

lock = threading.Lock()
requests = []
replies = []
process = None


def configure(providers):
    global process
    if process is not None:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    env = dict(os.environ, LITELLM_MASTER_KEY="sk-offline-gateway",
               LITELLM_LOCAL_MODEL_COST_MAP="True", DISABLE_ADMIN_UI="True",
               DISABLE_SCHEMA_UPDATE="True", LITELLM_TELEMETRY="False")
    for role, provider in zip(["FAST", "STANDARD"], providers):
        assert provider in ["openai", "yandex"]
        model = ("gpt-6-luna" if role == "FAST" else "gpt-6.1-sol") if provider == "openai" else "gpt://offline/yandexgpt/latest"
        env.update({role + "_MODEL": model,
                    role + "_API_BASE": "http://127.0.0.1:9180/" + provider + "/v1",
                    role + "_API_KEY": "sk-offline-" + provider})
    process = subprocess.Popen(["litellm", "--config", "/conformance/tests/stock.config.yaml",
                                "--host", "0.0.0.0", "--port", "9181"], env=env)
    for _ in range(160):
        if process.poll() is not None:
            raise RuntimeError("Stock CLI exited")
        try:
            urllib.request.urlopen("http://127.0.0.1:9181/health/liveliness", timeout=0.4).close()
            return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("Stock CLI startup timeout")


class Mock(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/ready":
            self.respond(200, {"version": version("litellm")})
        elif self.path == "/requests":
            with lock:
                self.respond(200, {"requests": requests, "pending": len(replies)})
        else:
            self.respond(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/configure":
            try:
                configure(body["providers"])
                self.respond(200, {"ok": True})
            except Exception as error:
                self.respond(500, {"error": str(error)})
            return
        with lock:
            if self.path == "/fixtures":
                requests.clear()
                replies[:] = body["replies"]
                self.respond(200, {"ok": True})
                return
            observed = {"path": self.path, "body": body,
                        "authorization": self.headers.get("Authorization"),
                        "disconnected": False, "finished": False}
            requests.append(observed)
            reply = replies.pop(0) if replies else {"status": 500, "body": {"error": {"message": "Unexpected physical send"}}}
        if reply.get("close"):
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            observed["finished"] = True
            return
        until = time.monotonic() + reply.get("delayMs", 0) / 1000
        while time.monotonic() < until:
            ready, _, _ = select.select([self.connection], [], [], 0.01)
            if ready and self.connection.recv(1, socket.MSG_PEEK) == b"":
                observed.update(disconnected=True, finished=True)
                return
        try:
            result = reply.get("body", {})
            if "model" in result:
                result["model"] = body["model"]
            self.respond(reply.get("status", 200), result)
        except (BrokenPipeError, ConnectionResetError):
            observed["disconnected"] = True
        finally:
            observed["finished"] = True


def stop(*_):
    if process is not None:
        process.terminate()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
ThreadingHTTPServer(("0.0.0.0", 9180), Mock).serve_forever()
