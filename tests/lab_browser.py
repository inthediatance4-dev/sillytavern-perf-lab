"""Shared target for the isolated performance-lab browser scripts.

`npm run perf:lab` serves this checkout at http://127.0.0.1:8780/. The SillyTavern
page has no separate lab marker, so callers check the title and that navigation
stayed on the configured origin before creating synthetic data.

Environment:
- LAB_URL or LAB_ORIGIN: base URL (default http://127.0.0.1:8780/)
- LAB_BROWSER_EXECUTABLE: optional browser path. Unset uses Playwright's bundled Chromium.
- LAB_EVIDENCE_DIR: screenshot and results directory (default <repo>/.evidence/browser)

Prerequisites: Python Playwright, and `playwright install chromium` when no
executable override is set.
"""
import os
import pathlib


def lab_origin():
    origin = os.environ.get('LAB_URL') or os.environ.get('LAB_ORIGIN') or 'http://127.0.0.1:8780/'
    if not origin.endswith('/'):
        origin += '/'
    return origin


def evidence_dir(root):
    override = os.environ.get('LAB_EVIDENCE_DIR')
    out = pathlib.Path(override) if override else pathlib.Path(root) / '.evidence' / 'browser'
    out.mkdir(parents=True, exist_ok=True)
    return out


def launch_chromium(playwright):
    kwargs = {'headless': True, 'args': ['--disable-gpu']}
    executable = os.environ.get('LAB_BROWSER_EXECUTABLE')
    if executable:
        kwargs['executable_path'] = executable
    return playwright.chromium.launch(**kwargs)


def assert_lab_page(page, origin):
    """Confirm this is SillyTavern on the configured lab origin before mutations."""
    title = page.title()
    if 'SillyTavern' not in title:
        raise AssertionError(f'Expected SillyTavern at the isolated lab, got title {title!r} from {page.url!r}')
    prefix = origin.rstrip('/')
    if not page.url.startswith(prefix):
        raise AssertionError(f'Page {page.url} is outside the configured lab origin {origin}')
