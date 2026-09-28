"""
Real-time screenshots of the console via the Chrome DevTools protocol (used for docs/screenshots).

    python docs/capture.py "http://localhost:8000/?view=live&autoplay=1" docs/screenshots/live_monitor.png --wait 25
"""

import argparse
import asyncio
import base64
import json
import subprocess
import tempfile
import time
import urllib.request

import websockets

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


async def capture(url: str, out: str, wait: float, width: int, height: int, clicks=(), port: int = 9333):
    profile = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                             "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                             f"--window-size={width},{height}", "--hide-scrollbars", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read())
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=50_000_000) as ws:
            n = 0

            async def call(method, **params):
                nonlocal n
                n += 1
                await ws.send(json.dumps({"id": n, "method": method, "params": params}))
                while True:
                    msg = json.loads(await ws.recv())
                    if msg.get("id") == n:
                        return msg.get("result", {})

            await call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
            await call("Runtime.enable")
            await call("Page.navigate", url=url)
            for label in clicks:
                await asyncio.sleep(6)
                js = ("(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(%s));"
                      " if (b) { b.click(); return 'clicked'; } return 'not found'; })()") % json.dumps(label)
                r = await call("Runtime.evaluate", expression=js, returnByValue=True)
                print("click", label, "->", r.get("result", {}).get("value"))
            await asyncio.sleep(wait)
            errs = await call("Runtime.evaluate", expression="window.__errors || []", returnByValue=True)
            print("page errors:", errs.get("result", {}).get("value"))
            shot = await call("Page.captureScreenshot", format="png")
            with open(out, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
    finally:
        proc.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("out")
    ap.add_argument("--wait", type=float, default=10)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1300)
    ap.add_argument("--click", action="append", default=[], help="click the first button containing this text")
    a = ap.parse_args()
    asyncio.run(capture(a.url, a.out, a.wait, a.width, a.height, a.click))
    print("saved", a.out)
