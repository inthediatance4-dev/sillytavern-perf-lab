#!/usr/bin/env python3
"""
Repeatable multi-sample browser fluency & frame-budget harness (opt-in Playwright).

Recorded Reference Baseline (Chromium 1440x900 @ 2x DPR, Windows 11, Node v24):
  - drawer_switch_median_ms :   3.1 ms   (budget <=  25.0 ms)
  - inline_open_median_ms   : 126.0 ms   (budget <= 200.0 ms)
  - popup_open_median_ms    : 215.0 ms   (budget <= 320.0 ms)
  - scroll_median_frame_ms  :  16.7 ms
  - scroll_p95_frame_ms     :  16.8 ms   (budget <=  34.0 ms)
  - scroll_long_tasks       :   0        (budget ==   0)
  - glide_median_ms         : 180.0 ms   (budget <= 320.0 ms)
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

BUDGETS = {
    "drawer_switch_median_ms": 25.0,
    "inline_open_median_ms": 200.0,
    "popup_open_median_ms": 320.0,
    "scroll_p95_frame_ms": 34.0,
    "scroll_long_tasks_total": 0,
    "glide_median_ms": 320.0,
}


def wait_http(url: str, timeout_s: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.3)
    raise RuntimeError(f"Server did not become ready at {url}")


def nearest_p95(values: list[float]) -> float:
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(len(ordered) * 0.95)))
    return round(ordered[idx], 2)


def run_probe(url: str, samples: int) -> dict:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        errors: list[str] = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(url, wait_until="networkidle")
        page.wait_for_selector("#top-bar")
        page.wait_for_selector("#apple_appearance_toggle")
        page.wait_for_timeout(600)
        page.evaluate("document.querySelector('dialog.popup[open] .popup-button-ok')?.click()")
        page.wait_for_timeout(200)
        page.evaluate("""async () => {
            const ctx = SillyTavern.getContext();
            if (ctx.characters.length > 0) await ctx.selectCharacterById(0);
        }""")
        page.wait_for_selector("#chat .mes", timeout=15000)
        page.wait_for_timeout(300)

        drawer_samples: list[float] = []
        inline_samples: list[float] = []
        popup_samples: list[float] = []
        glide_samples: list[float] = []
        all_frame_deltas: list[float] = []
        long_tasks_total = 0

        for i in range(samples + 1):  # 1 warmup + N measured
            d_ms = page.evaluate("""async () => {
                const ai = document.querySelector('#ai-config-button .drawer-toggle');
                const ext = document.querySelector('#extensions-settings-button .drawer-toggle');
                const block = document.getElementById('rm_extensions_block');
                ai.click();
                await new Promise(r => requestAnimationFrame(r));
                const t0 = performance.now();
                ext.click();
                while (!block.classList.contains('openDrawer')) {
                    await new Promise(r => setTimeout(r, 2));
                }
                return performance.now() - t0;
            }""")
            in_ms = page.evaluate("""async () => {
                const toggle = document.querySelector('#affinity_settings .inline-drawer-toggle');
                const content = document.querySelector('#affinity_settings .inline-drawer-content');
                if (getComputedStyle(content).display !== 'none') {
                    toggle.click();
                    await new Promise(r => setTimeout(r, 150));
                }
                const t0 = performance.now();
                toggle.click();
                while (content.style.height !== '' || getComputedStyle(content).display === 'none') {
                    if (performance.now() - t0 > 600) break;
                    await new Promise(r => setTimeout(r, 5));
                }
                return performance.now() - t0;
            }""")
            page.keyboard.press("Escape")
            page.wait_for_timeout(80)

            pop_ms = page.evaluate("""async () => {
                const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
                const t0 = performance.now();
                let ready = null;
                const dlg = new Popup('<p>Fluency probe</p>', POPUP_TYPE.CONFIRM, null, {
                    onOpen: () => { ready = performance.now() - t0; },
                });
                const shown = dlg.show();
                while (ready === null && performance.now() - t0 < 1000) {
                    await new Promise(r => setTimeout(r, 6));
                }
                await dlg.completeCancelled();
                await shown;
                return ready;
            }""")

            scroll_run = page.evaluate("""async () => {
                const chat = document.getElementById('chat');
                const sample = chat.querySelector('.mes');
                for (let k = 0; k < 24; k++) {
                    const c = sample.cloneNode(true);
                    c.setAttribute('data-probe-clone', '1');
                    chat.append(c);
                }
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                let longTasks = 0;
                const po = new PerformanceObserver(l => { longTasks += l.getEntries().length; });
                try { po.observe({ entryTypes: ['longtask'] }); } catch {}
                chat.scrollTop = 60;
                chat.dispatchEvent(new Event('scroll'));
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const deltas = [];
                let prev = performance.now();
                for (let f = 0; f < 30; f++) {
                    chat.scrollTop = 60 + f * 36;
                    await new Promise(r => requestAnimationFrame(now => {
                        deltas.push(now - prev);
                        prev = now;
                        r();
                    }));
                }
                po.disconnect();
                chat.scrollTop = 80;
                chat.dispatchEvent(new Event('scroll'));
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                const pill = document.getElementById('apple_scroll_bottom');
                const g0 = performance.now();
                pill.click();
                while (chat.scrollHeight - chat.scrollTop - chat.clientHeight > 2) {
                    if (performance.now() - g0 > 800) break;
                    await new Promise(r => requestAnimationFrame(r));
                }
                const glideMs = performance.now() - g0;
                for (const el of chat.querySelectorAll('[data-probe-clone="1"]')) el.remove();
                return { deltas, longTasks, glideMs };
            }""")

            if i > 0:  # record post-warmup samples
                drawer_samples.append(round(d_ms, 2))
                inline_samples.append(round(in_ms, 2))
                popup_samples.append(round(pop_ms, 2))
                glide_samples.append(round(scroll_run["glideMs"], 2))
                all_frame_deltas.extend(scroll_run["deltas"])
                long_tasks_total += int(scroll_run["longTasks"])

        browser.close()

    summary = {
        "samples": samples,
        "drawer_switch_median_ms": round(statistics.median(drawer_samples), 2),
        "inline_open_median_ms": round(statistics.median(inline_samples), 2),
        "popup_open_median_ms": round(statistics.median(popup_samples), 2),
        "scroll_median_frame_ms": round(statistics.median(all_frame_deltas), 2),
        "scroll_p95_frame_ms": nearest_p95(all_frame_deltas),
        "scroll_long_tasks_total": long_tasks_total,
        "glide_median_ms": round(statistics.median(glide_samples), 2),
        "page_errors": errors,
        "budgets": BUDGETS,
    }
    failures: list[str] = []
    if errors:
        failures.append(f"page_errors={errors}")
    for key, cap in BUDGETS.items():
        if summary[key] > cap:
            failures.append(f"{key}={summary[key]} exceeds budget {cap}")
    summary["passed"] = len(failures) == 0
    summary["failures"] = failures
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--json", default="")
    args = parser.parse_args()

    proc = None
    url = args.url
    repo = Path(__file__).resolve().parent.parent
    try:
        if not url:
            port = 8780
            proc = subprocess.Popen(
                ["node", "scripts/start-performance-lab.mjs"],
                cwd=str(repo),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            url = f"http://127.0.0.1:{port}/"
            wait_http(url)

        result = run_probe(url, args.samples)
        text = json.dumps(result, indent=2, ensure_ascii=False)
        print(text)
        if args.json:
            Path(args.json).write_text(text + "\n", encoding="utf-8")
        return 0 if result["passed"] else 1
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
