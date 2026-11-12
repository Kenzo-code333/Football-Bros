#!/usr/bin/env python3
"""Bundle Gridiron Blitz into ONE self-contained HTML file (CSS and all JS modules inlined).

Each game module is embedded as a base64 data: URL and wired up through the import map,
so the file works when opened directly from disk (file://) or from any static host.
Three.js and PeerJS still load from the CDN, so an internet connection is needed.

Usage: python3 tools/build-single.py [output.html]
"""
import base64, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / 'gridiron-blitz.html')
html = (root / 'index.html').read_text()
css = (root / 'style.css').read_text()

entries = {}
for f in sorted((root / 'js').glob('*.js')):
    src = f.read_text()
    # rewrite relative imports ('./x.js') to bare specifiers resolved by the import map
    src = re.sub(r"""(from\s+|import\s*\(\s*|import\s+)(['"])\./([\w-]+\.js)\2""", r"\1\2gb/\3\2", src)
    entries['gb/' + f.name] = 'data:text/javascript;base64,' + base64.b64encode(src.encode()).decode()

imap_match = re.search(r'("imports"\s*:\s*\{)', html)
extra = ''.join(f'\n    "{k}": "{v}",' for k, v in entries.items())
html = html[:imap_match.end()] + extra + html[imap_match.end():]
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
html = html.replace('<script type="module" src="js/main.js"></script>', "<script type=\"module\">import 'gb/main.js';</script>")
assert 'src="js/' not in html and 'href="style.css"' not in html
out.write_text(html)
print(f'wrote {out} ({out.stat().st_size // 1024} KB, {len(entries)} modules)')
