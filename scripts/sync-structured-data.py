#!/usr/bin/env python3
"""Keep the machine-readable copies of the page in step with the page itself.

Run it after editing the FAQ or any fact on the page:

    python3 scripts/sync-structured-data.py           # update, and set today's date
    python3 scripts/sync-structured-data.py --check   # only report differences

It rebuilds the FAQ inside the structured data (the application/ld+json block
in public/index.html) from the visible FAQ, and writes the same "last updated"
date into the structured data (dateModified), public/sitemap.xml (<lastmod>)
and public/llms.txt ("Last updated:"). The key facts in llms.txt are written by
hand: check them too when a fact changes.

Standard library only; no install needed.
"""
import datetime
import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = ROOT / "public" / "index.html"
SITEMAP = ROOT / "public" / "sitemap.xml"
LLMS = ROOT / "public" / "llms.txt"

LD_RE = re.compile(r'(<script type="application/ld\+json">\n)(.*?)(\n  </script>)', re.S)
LASTMOD_RE = re.compile(r"<lastmod>(\d{4}-\d{2}-\d{2})</lastmod>")
LLMS_DATE_RE = re.compile(r"^Last updated: (\d{4}-\d{2}-\d{2})\.", re.M)


def text_of(fragment):
    """Visible text of an HTML fragment, with whitespace collapsed."""
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def visible_faq(page):
    start = page.index('<div class="faq__list')
    section = page[start:page.index("</section>", start)]
    pairs = re.findall(r"<summary>(.*?)</summary>\s*<p>(.*?)</p>", section, re.S)
    return [{"@type": "Question", "name": text_of(q),
             "acceptedAnswer": {"@type": "Answer", "text": text_of(a)}} for q, a in pairs]


def main():
    check_only = "--check" in sys.argv[1:]
    page = INDEX.read_text(encoding="utf-8")
    match = LD_RE.search(page)
    data = json.loads(match.group(2))
    faq_node = next(n for n in data["@graph"] if n["@type"] == "FAQPage")
    faq = visible_faq(page)

    sitemap = SITEMAP.read_text(encoding="utf-8")
    llms = LLMS.read_text(encoding="utf-8")
    dates = {
        "structured data (dateModified)": faq_node.get("dateModified"),
        "sitemap.xml (lastmod)": LASTMOD_RE.search(sitemap).group(1),
        "llms.txt (Last updated)": LLMS_DATE_RE.search(llms).group(1),
    }

    if check_only:
        problems = []
        if faq_node["mainEntity"] != faq:
            have = {q["name"]: q for q in faq_node["mainEntity"]}
            for q in faq:
                if have.get(q["name"]) != q:
                    problems.append(f"FAQ differs from the page: {q['name']}")
            for name in have.keys() - {q["name"] for q in faq}:
                problems.append(f"FAQ question no longer on the page: {name}")
            if not problems:
                problems.append("FAQ questions are in a different order from the page")
        if len(set(dates.values())) > 1:
            problems.append("dates differ: " + ", ".join(f"{k} {v}" for k, v in dates.items()))
        for problem in problems:
            print(problem)
        print("OK: structured data matches the page" if not problems else
              "Run without --check to fix.")
        return 1 if problems else 0

    today = datetime.date.today().isoformat()
    faq_node["mainEntity"] = faq
    faq_node["dateModified"] = today
    page = page[:match.start(2)] + json.dumps(data, ensure_ascii=False, indent=2) + page[match.end(2):]
    INDEX.write_text(page, encoding="utf-8")
    SITEMAP.write_text(LASTMOD_RE.sub(f"<lastmod>{today}</lastmod>", sitemap), encoding="utf-8")
    LLMS.write_text(LLMS_DATE_RE.sub(f"Last updated: {today}.", llms), encoding="utf-8")
    print(f"Updated: {len(faq)} FAQ questions in the structured data; date {today} set in "
          "index.html, sitemap.xml and llms.txt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
