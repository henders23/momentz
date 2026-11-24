"""Build the runnable prototype pages from the design-canvas source files.

The design canvas stores each screen as design/<Name>.dc.html. This script copies
each one to a plain page at the repo root, points it at runtime.js instead of the
canvas runtime, and rewrites links between screens to the new file names.

Run from the repo root:  python3 scripts/build.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"

# Canvas file -> prototype page, in flow order.
PAGES = {
    "Main.dc.html": "index.html",
    "Talk.dc.html": "chat-opening.html",
    "Chat.dc.html": "chat.html",
    "Takeaway.dc.html": "summary.html",
    "Playbook.dc.html": "playbook.html",
}


def build() -> None:
    for source, target in PAGES.items():
        html = (DESIGN / source).read_text(encoding="utf-8")
        html = html.replace('<script src="./support.js"></script>', '<script src="./runtime.js"></script>')
        for old, new in PAGES.items():
            html = html.replace(f'href="{old}"', f'href="{new}"')
        (ROOT / target).write_text(html, encoding="utf-8")
        print(f"design/{source} -> {target}")


if __name__ == "__main__":
    build()
