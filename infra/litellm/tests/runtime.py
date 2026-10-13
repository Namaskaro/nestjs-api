"""Real pinned gateways with deterministic local HTTP upstreams; no provider access.

Controlled only by the opt-in Jest integration suite on loopback. Not a deployment
entrypoint. Both configured upstream URLs point to this container's loopback.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

import yaml

ROOT = Path(__file__).resolve().parents[1]
requests = []
replies = []
events = []
processes = []
ready = False
lock = threading.Lock()


class MockUpstream(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_GET(self):
        if self.path == "/ready":
            self.respond(200 if ready else 503, {"ready": ready, "version": version("litellm")})
        elif self.path == "/requests":
            with lock:
                self.respond(200, {"requests": requests, "events": events, "pendingReplies": len(replies)})
        else:
            self.respond(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with lock:
            if self.path == "/fixtures":
                requests.clear()
                events.clear()
                replies[:] = body["replies"]
                self.respond(200, {"ok": True})
                return
            requests.append({"path": self.path, "body": body})
            if not replies:
                self.respond(500, {"error": {"message": "Unexpected upstream request", "type": "mock_error"}})
                return
            reply = replies.pop(0)
        if reply.get("delayMs"):
            time.sleep(reply["delayMs"] / 1000)
        result = reply["body"]
        if "model" in result:
            result["model"] = body["model"]
        self.respond(reply.get("status", 200), result)


def capture_output(process, profile):
    for line in process.stdout:
        if line.startswith('{"event": "llm_gateway_deployment"'):
            with lock:
                events.append(json.loads(line))
        # Test container logs only; all credentials and messages are fixtures.
        print(f"[{profile}] {line.rstrip()}", flush=True)


def stop(*_):
    for process in processes:
        process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
server = ThreadingHTTPServer(("0.0.0.0", 9180), MockUpstream)
threading.Thread(target=server.serve_forever, daemon=True).start()
env = {
    **os.environ,
    "PYTHONPATH": str(ROOT),
    "LITELLM_MASTER_KEY": "sk-offline-gateway",
    "LITELLM_LOCAL_MODEL_COST_MAP": "True",
    "DISABLE_ADMIN_UI": "True",
    "DISABLE_SCHEMA_UPDATE": "True",
    "YANDEX_LITE_MODEL": "gpt://offline/yandexgpt-lite/latest",
    "YANDEX_MODEL": "gpt://offline/yandexgpt/latest",
    "YANDEX_API_URL": "http://127.0.0.1:9180/v1",
    "YANDEX_API_KEY": "offline-yandex-key",
    "OPENAI_FAST_MODEL": "gpt-6-luna",
    "OPENAI_STANDARD_MODEL": "gpt-6.1-sol",
    "OPENAI_API_KEY": "offline-openai-key",
}
with tempfile.TemporaryDirectory() as directory:
    profiles = [("yandex", 9181), ("openai", 9182)]
    if os.environ.get("SUPPORT_TEST_DATABASE_URL"):
        profiles.append(("budget", 9183))
    for profile, port in profiles:
        config = yaml.safe_load((ROOT / f"config.{'openai' if profile == 'budget' else profile}.yaml").read_text())
        child_env = dict(env)
        for deployment in config["model_list"]:
            deployment["litellm_params"]["api_base"] = "http://127.0.0.1:9180/v1"
            if profile == "budget":
                # Artificial prices ONLY for checking accounting and a budget
                # threshold. These are not provider tariffs or recommendations.
                deployment["model_info"].update({"input_cost_per_token": 0.001, "output_cost_per_token": 0.002, "pricing_verified": True})
        if profile == "budget":
            child_env.update({
                "DATABASE_URL": os.environ["SUPPORT_TEST_DATABASE_URL"],
                "LITELLM_SALT_KEY": "sk-offline-test-salt-do-not-use",
                "DISABLE_SCHEMA_UPDATE": "false",
                "SUPPORT_REQUIRE_PRICING": "true",
            })
            config["general_settings"]["proxy_batch_write_at"] = 1
        path = Path(directory) / f"{profile}.yaml"
        path.write_text(yaml.safe_dump(config))
        process = subprocess.Popen(
            ["litellm", "--config", str(path), "--host", "0.0.0.0", "--port", str(port)],
            env=child_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        processes.append(process)
        threading.Thread(target=capture_output, args=(process, profile), daemon=True).start()
    for _ in range(240):
        if any(process.poll() is not None for process in processes):
            raise RuntimeError("Test gateway exited during startup")
        try:
            for _, port in profiles:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/health/liveliness", timeout=1).close()
            ready = True
            break
        except Exception:
            time.sleep(0.5)
    if not ready:
        stop()
    print("OFFLINE_GATEWAY_READY", flush=True)
    while True:
        time.sleep(1)
        if any(process.poll() is not None for process in processes):
            stop()
