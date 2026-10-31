"""Acceptance LIC-3216: sitemap lastmod is generated at deploy time from git history.

critério -> teste
c1 | lastmod = date of last commit touching each route's index.html | Lastmod::test_c1_lastmod_is_date_of_last_commit_touching_each_route
c2 | real site/sitemap.xml: no changefreq/priority/lastmod, one loc per indexable page | RealSitemap::test_c2_*
c3 | indexable page missing from sitemap fails; noindex page does not | Coverage::test_c3_*
c4 | deploy.yml: checkout fetch-depth 0, render_sitemap before upload | DeployYml::test_c4_*
c_vazio | no <url> / loc without index.html -> exit 1, sitemap untouched | Edge::test_c_vazio_*
c_falha | route without commit / shallow clone -> exit 1, sitemap untouched | Edge::test_c_falha_*
c_repete | idempotent; stale lastmod replaced | Edge::test_c_repete_*
c_org, c_papel: not applicable (static site, no org and no role).

Contract: python3 scripts/render_sitemap.py <site_dir>  (repo root = <site_dir>.parent).
Git runs with explicit author/committer dates and a clean environment. Stdlib only, no network.
HTML is read with HTMLParser, never regex on <script>.
"""
import os
import re
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SCRIPT = ROOT / "scripts" / "render_sitemap.py"
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

PAGE = "<!doctype html><html><head><title>t</title>%s</head><body>%s</body></html>"
NOINDEX = '<meta name="robots" content="noindex" />'


class _Robots(HTMLParser):
    def __init__(self):
        super().__init__()
        self.noindex = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and (a.get("name") or "").lower() == "robots" \
                and "noindex" in (a.get("content") or "").lower():
            self.noindex = True


def is_noindex(path):
    p = _Robots()
    p.feed(Path(path).read_text(encoding="utf-8"))
    return p.noindex


def git_env():
    env = {"PATH": os.environ.get("PATH", ""), "HOME": tempfile.gettempdir(),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C"}
    return env


def git(repo, *args, date=None):
    env = git_env()
    if date:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date
    r = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t",
                        "-c", "commit.gpgsign=false", "-C", str(repo), *args],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError("git %s failed: %s" % (args, r.stderr))
    return r.stdout.strip()


def commit(repo, msg, date):
    git(repo, "add", "-A")
    git(repo, "commit", "-m", msg, date=date)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def sitemap_xml(routes, extra=""):
    urls = "".join("  <url>\n    <loc>https://example.test%s</loc>\n%s  </url>\n" % (r, extra)
                   for r in routes)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n' % urls)


def page_path(site, route):
    return site / route.strip("/") / "index.html" if route.strip("/") else site / "index.html"


def run_script(site, cwd):
    if not SCRIPT.exists():
        raise AssertionError("scripts/render_sitemap.py não existe")
    return subprocess.run([sys.executable, str(SCRIPT), str(site)], cwd=str(cwd),
                          env=git_env(), capture_output=True, text=True)


def lastmods(xml_text):
    """route -> list of lastmod texts, parsed with ElementTree."""
    out = {}
    for u in ET.fromstring(xml_text).findall(NS + "url"):
        loc = u.find(NS + "loc").text
        out[loc.replace("https://example.test", "")] = [e.text for e in u.findall(NS + "lastmod")]
    return out


def make_repo(tmp, routes=("/", "/a/", "/en/b/")):
    """Temp git repo with site/ pages and sitemap, all committed on 2026-01-05."""
    repo = Path(tmp) / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    site = repo / "site"
    for r in routes:
        write(page_path(site, r), PAGE % ("", "page " + r))
    write(site / "sitemap.xml", sitemap_xml(routes))
    commit(repo, "initial", "2026-01-05T12:00:00+0000")
    return repo, site


class Lastmod(unittest.TestCase):
    def test_c1_lastmod_is_date_of_last_commit_touching_each_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp)
            # helper sanity: git log really reports the explicit commit date
            self.assertEqual(git(repo, "log", "-1", "--format=%cs", "--", "site/index.html"), "2026-01-05")
            write(site / "a" / "index.html", PAGE % ("", "page a changed"))
            commit(repo, "touch a", "2026-02-10T12:00:00+0000")
            write(site / "en" / "b" / "index.html", PAGE % ("", "page b changed"))
            commit(repo, "touch b", "2026-03-15T12:00:00+0000")
            write(repo / "README.md", "unrelated")
            commit(repo, "unrelated", "2026-04-20T12:00:00+0000")
            self.assertEqual(git(repo, "log", "-1", "--format=%cs", "--", "site/a/index.html"), "2026-02-10")

            r = run_script(site, repo)
            self.assertEqual(r.returncode, 0, r.stderr)
            got = lastmods((site / "sitemap.xml").read_text(encoding="utf-8"))
            self.assertEqual(got, {"/": ["2026-01-05"], "/a/": ["2026-02-10"], "/en/b/": ["2026-03-15"]})
            xml = (site / "sitemap.xml").read_text(encoding="utf-8")
            self.assertRegex(xml, r"</loc>\s*<lastmod>2026-01-05</lastmod>")


def real_pages():
    return sorted(SITE.rglob("index.html"))


class RealSitemap(unittest.TestCase):
    def test_c2_real_sitemap_has_no_changefreq_priority_or_lastmod(self):
        root = ET.fromstring((SITE / "sitemap.xml").read_text(encoding="utf-8"))
        for tag in ("changefreq", "priority", "lastmod"):
            self.assertEqual(root.findall(".//" + NS + tag), [], "sitemap.xml still has <%s>" % tag)

    def test_c2_real_sitemap_has_one_loc_per_indexable_page(self):
        pages = [p for p in real_pages() if not is_noindex(p)]
        self.assertEqual(len(pages), 18)
        expected = set()
        for p in pages:
            rel = p.parent.relative_to(SITE).as_posix()
            expected.add("/" if rel == "." else "/%s/" % rel)
        root = ET.fromstring((SITE / "sitemap.xml").read_text(encoding="utf-8"))
        locs = [u.find(NS + "loc").text for u in root.findall(NS + "url")]
        paths = [re.sub(r"^https?://[^/]+", "", loc) for loc in locs]
        self.assertEqual(len(paths), len(set(paths)), "duplicate loc")
        self.assertEqual(set(paths), expected)


class Coverage(unittest.TestCase):
    def test_c3_indexable_page_missing_from_sitemap_fails_and_leaves_sitemap_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/", "/a/"))
            write(site / "orphan" / "index.html", PAGE % ("", "orphan"))
            commit(repo, "orphan", "2026-01-06T12:00:00+0000")
            before = (site / "sitemap.xml").read_bytes()
            r = run_script(site, repo)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("orphan", r.stderr)
            self.assertEqual((site / "sitemap.xml").read_bytes(), before)

    def test_c3_noindex_page_missing_from_sitemap_does_not_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/", "/a/"))
            write(site / "hidden" / "index.html", PAGE % (NOINDEX, "hidden"))
            commit(repo, "hidden", "2026-01-06T12:00:00+0000")
            r = run_script(site, repo)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(lastmods((site / "sitemap.xml").read_text(encoding="utf-8")),
                             {"/": ["2026-01-05"], "/a/": ["2026-01-05"]})


class DeployYml(unittest.TestCase):
    def setUp(self):
        self.y = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")

    def test_c4_checkout_fetches_full_history(self):
        m = re.search(r"uses:\s*actions/checkout@v4[ \t]*\n((?:[ \t]+(?:with:|[\w-]+:.*)\n?)*)", self.y)
        self.assertIsNotNone(m, "checkout@v4 step not found")
        self.assertRegex(m.group(1), r"with:\s*\n\s+fetch-depth:\s*0\b")

    def test_c4_renders_sitemap_after_checkout_and_before_upload(self):
        lines = [ln for ln in self.y.splitlines() if "python3 scripts/render_sitemap.py site" in ln]
        self.assertEqual(len(lines), 1, "render_sitemap step missing from deploy.yml")
        self.assertNotIn("|| true", lines[0])
        step = self.y.find("python3 scripts/render_sitemap.py site")
        self.assertGreater(step, self.y.find("actions/checkout@v4"))
        self.assertLess(step, self.y.find("actions/upload-pages-artifact"))


class Edge(unittest.TestCase):
    def _fails_untouched(self, site, repo, *needles):
        before = (site / "sitemap.xml").read_bytes()
        r = run_script(site, repo)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("error: sitemap not rendered:", r.stderr)
        for n in needles:
            self.assertIn(n, r.stderr)
        self.assertEqual((site / "sitemap.xml").read_bytes(), before)
        self.assertNotIn("<lastmod></lastmod>", before.decode("utf-8"))

    def test_c_vazio_sitemap_without_url_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/",))
            write(site / "sitemap.xml", sitemap_xml([]))
            commit(repo, "empty sitemap", "2026-01-06T12:00:00+0000")
            self._fails_untouched(site, repo)

    def test_c_vazio_missing_sitemap_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/",))
            (site / "sitemap.xml").unlink()
            r = run_script(site, repo)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn("error: sitemap not rendered:", r.stderr)

    def test_c_vazio_loc_without_index_html_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/", "/a/"))
            write(site / "sitemap.xml", sitemap_xml(["/", "/a/", "/ghost/"]))
            commit(repo, "ghost loc", "2026-01-06T12:00:00+0000")
            self._fails_untouched(site, repo, "/ghost/")

    def test_c_falha_route_without_commit_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/", "/a/"))
            write(site / "sitemap.xml", sitemap_xml(["/", "/a/", "/fresh/"]))
            commit(repo, "sitemap with fresh", "2026-01-06T12:00:00+0000")
            write(site / "fresh" / "index.html", PAGE % ("", "uncommitted"))
            self.assertEqual(git(repo, "log", "-1", "--format=%cs", "--", "site/fresh/index.html"), "")
            self._fails_untouched(site, repo, "/fresh/")

    def test_c_falha_shallow_clone_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp)
            write(site / "a" / "index.html", PAGE % ("", "changed"))
            commit(repo, "second", "2026-02-10T12:00:00+0000")
            clone = Path(tmp) / "clone"
            subprocess.run(["git", "clone", "-q", "--depth", "1", "file://%s" % repo, str(clone)],
                           env=git_env(), check=True, capture_output=True)
            self.assertEqual(git(clone, "rev-parse", "--is-shallow-repository"), "true")
            self._fails_untouched(clone / "site", clone, "shallow", "fetch-depth: 0")

    def test_c_repete_running_twice_gives_same_xml_with_one_lastmod_per_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp)
            self.assertEqual(run_script(site, repo).returncode, 0)
            first = (site / "sitemap.xml").read_bytes()
            r = run_script(site, repo)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((site / "sitemap.xml").read_bytes(), first)
            for v in lastmods(first.decode("utf-8")).values():
                self.assertEqual(v, ["2026-01-05"])

    def test_c_repete_stale_lastmod_is_replaced_and_changefreq_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, site = make_repo(tmp, routes=("/", "/a/"))
            stale = sitemap_xml(["/", "/a/"], extra="    <lastmod>1999-12-31</lastmod>\n"
                                                    "    <changefreq>weekly</changefreq>\n")
            write(site / "sitemap.xml", stale)
            commit(repo, "stale sitemap", "2026-01-06T12:00:00+0000")
            r = run_script(site, repo)
            self.assertEqual(r.returncode, 0, r.stderr)
            xml = (site / "sitemap.xml").read_text(encoding="utf-8")
            self.assertEqual(lastmods(xml), {"/": ["2026-01-05"], "/a/": ["2026-01-05"]})
            self.assertNotIn("1999-12-31", xml)
            self.assertEqual(xml.count("<changefreq>weekly</changefreq>"), 2)


if __name__ == "__main__":
    unittest.main()
