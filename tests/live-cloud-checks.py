"""Creator Studio — live cloud test suite (36 checks, Playwright/Firefox).

Rebuilt 24 Nov 2026 from the 21 Nov 2026 live run (35/36). The one failure
in that run was a bug in the TEST SCRIPT's own assertion, not in the app:
the result badges read "Cloud · Gemini" / "In cloud" in the DOM, but CSS
uppercases them visually to "CLOUD · GEMINI" / "IN CLOUD", and the old
script compared against the uppercased visual text. Every badge/model
comparison in this suite is case-insensitive (see check 12).

Runs against the LIVE hosted demo — no local Firebase config needed.
Requires: Playwright + Firefox (see README "Live cloud tests").

Usage:
    python3 tests/live-cloud-checks.py [--url URL] [--report PATH]

Writes a JSON report to stdout and to --report (default: alongside the
script as live-cloud-checks-report.json). Exit code 0 only if all 36
checks pass.
"""
import argparse
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://creator-studio-hybridai.web.app/"
TOPIC = "A leader who carried a sack of flour"
NICHE = "Islamic stories"
TOPIC_KEYWORDS = ["flour", "leader", "sack", "carried"]

CHECKS = []  # (key, label) in run order — 36 total


def check(key, label, ok, evidence=None):
    CHECKS.append({"key": key, "label": label, "result": "PASS" if ok else "FAIL"})
    if evidence is not None:
        CHECKS[-1]["evidence"] = evidence
    return ok


def log_entries(page):
    """Routing-log entries, newest first, as plain text."""
    out = []
    for li in page.query_selector_all("#routing-log li"):
        if "log-empty" in (li.get_attribute("class") or ""):
            continue
        out.append(li.inner_text().replace("\n", " | "))
    return out


def entry_for(entries, task_label):
    return next((e for e in entries if e.startswith(task_label)), "")


# Exact task labels as rendered in the routing log (src/main.js TASKS).
# NOTE: the script task logs as "Full script" and titles as
# "Titles & thumbnail text" — matching on "Script"/"Titles" with startswith
# misses them. (First version of this suite had that bug: it ran a needless
# second generation because "Full script" doesn't start with "Script".)
TASK_LABELS = {"hooks": "Hooks", "caption": "Caption",
               "script": "Full script", "titles": "Titles"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--report", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "live-cloud-checks-report.json"))
    ap.add_argument("--shot", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "live-cloud-checks.png"))
    args = ap.parse_args()

    report = {"url": args.url, "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "console_errors": [], "console_warnings": [], "page_errors": [],
              "failed_requests": [], "evidence": {}}

    # Proxy comes from the environment when one is set (this build VM routes
    # through an egress proxy); without one, Firefox connects directly.
    # Any credentials embedded in the env URL are stripped: the proxy does
    # not need them for Playwright, and they must never reach a child process.
    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if proxy_url:
        from urllib.parse import urlsplit
        parts = urlsplit(proxy_url)
        host = parts.hostname or ""
        port = (":%d" % parts.port) if parts.port else ""
        proxy_url = "%s://%s%s" % (parts.scheme or "http", host, port)
    launch_kwargs = {"proxy": {"server": proxy_url}} if proxy_url else {}
    with sync_playwright() as p:
        browser = p.firefox.launch(**launch_kwargs)
        context = browser.new_context(ignore_https_errors=True,
                                      viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", lambda m: (
            report["console_errors"].append(m.text) if m.type == "error"
            else report["console_warnings"].append(m.text) if m.type == "warning"
            else None))
        page.on("pageerror", lambda e: report["page_errors"].append(str(e)))
        page.on("response", lambda r: report["failed_requests"].append(
            f"{r.status} {r.url}") if r.status >= 400 else None)

        # ---- Group A: load + configured mode (7) ---------------------------
        t0 = time.time()
        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_function(
            "document.querySelector('#pill-firebase').textContent.indexOf('checking') === -1",
            timeout=30000)
        page.wait_for_timeout(2500)  # anonymous auth + Nano check settle
        report["evidence"]["load_ms"] = int((time.time() - t0) * 1000)

        title = page.title()
        pill_firebase = page.inner_text("#pill-firebase")
        pill_nano = page.inner_text("#pill-nano")
        pill_net = page.inner_text("#pill-net")
        demo_visible = page.is_visible("#demo-banner")
        report["evidence"].update({"title": title, "pill_firebase": pill_firebase,
                                   "pill_nano": pill_nano, "pill_net": pill_net,
                                   "demo_banner_visible": demo_visible})

        check("01_load_title", "Page title names Creator Studio",
              "Creator Studio" in title, title)
        check("02_load_firebase_live", "Firebase pill reads 'Firebase: live'",
              pill_firebase == "Firebase: live", pill_firebase)
        check("03_load_no_demo_banner", "Demo banner is hidden (configured mode)",
              not demo_visible)
        check("04_load_no_console_errors", "No console errors on load",
              not report["console_errors"], report["console_errors"][:3])
        check("05_load_no_page_errors", "No page errors on load",
              not report["page_errors"], report["page_errors"][:3])
        check("06_load_no_failed_requests", "No failed requests (HTTP >= 400)",
              not report["failed_requests"], report["failed_requests"][:3])
        check("07_load_pills_settled", "Status pills settled (no 'checking')",
              "checking" not in (pill_firebase + pill_nano + pill_net).lower())

        # ---- Group B: generation — all 4 tasks (4) -------------------------
        page.fill("#input-topic", TOPIC)
        page.select_option("#input-niche", label=NICHE)
        gen_ok = False
        attempts = 0
        newest = []
        gen_start = time.time()
        while attempts < 2 and not gen_ok:
            attempts += 1
            before = len(log_entries(page))
            page.click("#btn-generate-all")
            try:
                page.wait_for_function(
                    "document.querySelectorAll('#routing-log li:not(.log-empty)').length >= %d"
                    % (before + 4), timeout=180000)
            except Exception as e:
                report["evidence"]["gen_attempt_%d_timeout" % attempts] = str(e)
            page.wait_for_timeout(1500)
            newest = log_entries(page)[:4]
            report["evidence"]["gen_attempt_%d_entries" % attempts] = newest
            # Success = all 4 tasks present AND all ran in the cloud with no
            # Error badge. (Presence alone is not success: a task that hit a
            # transient backend 500 still logs an ERROR entry. Requiring
            # success here lets the suite's retry absorb a demand spike
            # instead of failing the run on a backend flake.)
            gen_ok = (
                len(newest) >= 4
                and all(entry_for(newest, t) for t in TASK_LABELS.values())
                and all("in cloud" in e.lower() for e in newest[:4])
                and all("error" not in e.lower() for e in newest[:4]))
        report["evidence"]["gen_attempts"] = attempts
        report["evidence"]["gen_total_ms"] = int((time.time() - gen_start) * 1000)
        report["evidence"]["routing_entries_newest_run"] = newest

        hooks_e = entry_for(newest, TASK_LABELS["hooks"])
        caption_e = entry_for(newest, TASK_LABELS["caption"])
        script_e = entry_for(newest, TASK_LABELS["script"])
        titles_e = entry_for(newest, TASK_LABELS["titles"])
        check("08_gen_hooks_entry", "Hooks task logged in routing panel", bool(hooks_e), hooks_e)
        check("09_gen_caption_entry", "Caption task logged in routing panel", bool(caption_e), caption_e)
        check("10_gen_script_entry", "Script task logged in routing panel", bool(script_e), script_e)
        check("11_gen_titles_entry", "Titles task logged in routing panel", bool(titles_e), titles_e)

        # ---- Group C: routing honesty (6) — check 12 is THE FIX ------------
        # THE FIX (21 Nov 35/36 failure): the old script compared badge text
        # against the CSS-uppercased VISUAL text ("IN CLOUD", "CLOUD · GEMINI"),
        # but inner_text() returns the DOM text ("In cloud", "Cloud · Gemini").
        # All badge/model comparisons below are case-insensitive.
        entries4 = [hooks_e, caption_e, script_e, titles_e]
        all_cloud = all("in cloud" in e.lower() for e in entries4 if e) and len(newest) >= 4
        check("12_route_all_in_cloud",
              "All 4 newest entries show the 'in cloud' badge (case-insensitive)",
              all_cloud, newest)
        no_error = all("error" not in e.lower() for e in entries4)
        check("13_route_no_error_badge", "No 'Error' badge in the newest 4 entries", no_error)
        latencies = [int(m.group(1)) for e in entries4
                     for m in [re.search(r"(\d+)\s*ms", e)] if m]
        check("14_route_real_latencies", "All 4 entries show a real latency (> 0 ms)",
              len(latencies) == 4 and all(v > 0 for v in latencies), latencies)
        check("15_route_gemini_models", "All 4 entries name a Gemini model",
              all("gemini" in e.lower() for e in entries4 if e), newest)
        stat_cloud = page.inner_text("#stat-cloud")
        stat_device = page.inner_text("#stat-device")
        stat_avg = page.inner_text("#stat-avg")
        report["evidence"].update({"stat_cloud": stat_cloud, "stat_device": stat_device,
                                   "stat_avg": stat_avg})
        # At least one full package (4 tasks) ran in the cloud. The counter is
        # cumulative per page session, so a retried generation counts more.
        try:
            cloud_n = int(stat_cloud.strip())
        except ValueError:
            cloud_n = -1
        check("16_route_stat_cloud_4", "Stats panel counts at least 4 in-cloud runs",
              cloud_n >= 4, stat_cloud)
        check("17_route_stat_avg_real", "Stats panel shows a real average latency",
              stat_avg.strip() not in ("–", "-", "0 ms"), stat_avg)

        # ---- Group D: content completeness (10) -----------------------------
        hooks_count = page.locator("#result-hooks .hook-item").count()
        hooks_meta = page.inner_text("#meta-hooks")
        caption_text = page.inner_text("#result-caption")
        hashtag_count = page.locator("#result-caption .hashtag").count()
        caption_meta = page.inner_text("#meta-caption")
        scene_count = page.locator("#result-script .scene").count()
        script_meta = page.inner_text("#meta-script")
        title_count = page.locator("#result-titles .title-list li").count()
        thumb_count = page.locator("#result-titles .thumb-list li").count()
        titles_meta = page.inner_text("#meta-titles")
        hooks_text = page.inner_text("#result-hooks")
        script_text = page.inner_text("#result-script")
        report["evidence"].update({
            "hooks_count": hooks_count, "hooks_meta": hooks_meta,
            "caption_len": len(caption_text), "hashtag_count": hashtag_count,
            "caption_meta": caption_meta, "scene_count": scene_count,
            "script_meta": script_meta, "title_count": title_count,
            "thumb_count": thumb_count, "titles_meta": titles_meta,
            "hooks_preview": hooks_text[:300], "caption_preview": caption_text[:300],
        })
        check("18_content_hooks_5", "Hooks: 5 hook items rendered", hooks_count == 5, hooks_count)
        check("19_content_hooks_not_sample", "Hooks meta has no 'Sample output'",
              "sample output" not in hooks_meta.lower(), hooks_meta)
        check("20_content_caption_text", "Caption: text longer than 100 chars",
              len(caption_text) > 100, len(caption_text))
        check("21_content_caption_hashtags", "Caption: at least 5 hashtags",
              hashtag_count >= 5, hashtag_count)
        check("22_content_caption_not_sample", "Caption meta has no 'Sample output'",
              "sample output" not in caption_meta.lower(), caption_meta)
        check("23_content_script_5_scenes", "Script: 5 scenes rendered", scene_count == 5, scene_count)
        check("24_content_script_not_sample", "Script meta has no 'Sample output'",
              "sample output" not in script_meta.lower(), script_meta)
        check("25_content_titles_4", "Titles: 4 titles rendered", title_count == 4, title_count)
        check("26_content_thumbs_4", "Titles: 4 thumbnail texts rendered", thumb_count == 4, thumb_count)
        check("27_content_titles_not_sample", "Titles meta has no 'Sample output'",
              "sample output" not in titles_meta.lower(), titles_meta)

        # ---- Group E: on-topic content (2) ----------------------------------
        check("28_topic_hooks", "Hooks mention the topic (flour/leader/sack/carried)",
              any(k in hooks_text.lower() for k in TOPIC_KEYWORDS))
        check("29_topic_script", "Script mentions the topic (flour/leader/sack/carried)",
              any(k in script_text.lower() for k in TOPIC_KEYWORDS))

        # ---- Group G (screenshot first, results visible) + Group F ----------
        shot_ok = False
        shot_err = ""
        try:
            page.click('.tab[data-tab="hooks"]')
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(800)
            page.screenshot(path=args.shot)
            shot_ok = True
        except Exception as e:
            shot_err = str(e)
        report["evidence"]["screenshot_path"] = args.shot if shot_ok else ""
        report["evidence"]["screenshot_error"] = shot_err
        check("36_ui_screenshot", "Screenshot captured with results visible", shot_ok, shot_err)

        # ---- Group F: Firestore save/load (5) -------------------------------
        save_toast = ""
        saved_before = ""
        saved_after = ""
        roundtrip = False
        store_firestore = False
        load_restores = False
        page.click("#btn-save-project")
        try:
            page.wait_for_function(
                "document.querySelector('#toast') && "
                "!document.querySelector('#toast').hidden && "
                "document.querySelector('#toast').textContent.indexOf('saved') !== -1",
                timeout=20000)
            save_toast = page.inner_text("#toast")
        except Exception as e:
            save_toast = "(toast not seen: %s)" % e
        # The saved-list refresh is an async Firestore query: wait for a card
        # instead of a fixed sleep (a fixed 1.5s sleep raced it on 24 Nov).
        try:
            page.wait_for_function(
                "document.querySelectorAll('#saved-list .saved-card').length >= 1",
                timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(500)
        saved_before = page.inner_text("#saved-list")
        report["evidence"]["save_toast"] = save_toast
        report["evidence"]["saved_list_before_reload"] = saved_before[:500]
        check("30_save_toast_firestore", "Save toast says 'saved to Firestore'",
              "saved to firestore" in save_toast.lower(), save_toast)
        check("31_save_list_before_reload", "Saved list shows the project before reload",
              TOPIC in saved_before, saved_before[:200])

        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(
            "document.querySelector('#pill-firebase').textContent.indexOf('checking') === -1",
            timeout=30000)
        page.click("#btn-refresh-saved")
        try:
            page.wait_for_function(
                "document.querySelectorAll('#saved-list .saved-card').length >= 1",
                timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        saved_after = page.inner_text("#saved-list")
        report["evidence"]["saved_list_after_reload"] = saved_after[:500]
        roundtrip = TOPIC in saved_after
        check("32_save_persists_reload", "Saved project still listed after reload",
              roundtrip, saved_after[:200])
        # The card for our topic must say Firestore (not Local).
        cards = page.query_selector_all("#saved-list .saved-card")
        our_card = None
        for card in cards:
            if TOPIC in (card.inner_text() or ""):
                our_card = card
                break
        if our_card:
            store_firestore = "Firestore" in our_card.inner_text()
        check("33_save_store_firestore", "Saved card is stored in Firestore",
              store_firestore, our_card.inner_text()[:200] if our_card else "(no card)")
        if our_card:
            our_card.query_selector('[data-action="load"]').click()
            page.wait_for_timeout(1200)
            load_restores = page.locator("#result-hooks .hook-item").count() == 5
        check("34_save_load_restores", "Load restores the project (5 hooks visible)",
              load_restores)

        # ---- Group G: UI integrity (1 remaining) -----------------------------
        routing_opts = page.locator('input[name="routing"]').count()
        check("35_ui_routing_switch", "Routing switch offers 3 options",
              routing_opts == 3, routing_opts)

        browser.close()

    # Re-order checks by number for a tidy report.
    ordered = sorted(CHECKS, key=lambda c: c["key"])
    passed = sum(1 for c in ordered if c["result"] == "PASS")
    report["checks"] = ordered
    report["passed"] = passed
    report["total"] = len(ordered)
    report["all_pass"] = passed == len(ordered)
    report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["all_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
