"""Tests for tools/workplace.py - the /scrape workplace verdict.

A real /scrape run presented linkedin 4427563735 ("Senior Azure Integration
Developer") as a remote High match because LinkedIn's --remote filter returned
it; the signed-in posting page labels it On-site and its text never says
remote. These pin the rule that fixes it: only work-arrangement phrasing counts,
silence is "unknown" (never remote), and a page label beats the text.
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from workplace import classify  # noqa: E402

TOOL = Path(__file__).resolve().parent.parent / "tools" / "workplace.py"


def verdict(text, label=None):
    return classify(text, label)["workplace"]


class Verdicts(unittest.TestCase):
    def test_silence_is_unknown_not_remote(self):
        # The 4427563735 description: Azure stack, "Location: US/CA", no arrangement.
        text = "Location: US/CA\nRole: Senior Azure Integration Services Developer\nExp: 12+ Years"
        self.assertEqual(verdict(text), "unknown")

    def test_label_overrides_text(self):
        self.assertEqual(verdict("Location: US/CA", label="On-site"), "onsite")
        self.assertEqual(verdict("Work Mode: Remote", label="Hybrid"), "hybrid")
        self.assertEqual(classify("x", "On-site")["source"], "label")

    def test_unrecognised_label_falls_back_to_text(self):
        self.assertEqual(verdict("Work Mode: Remote", label="Full-time"), "remote")

    def test_remote_phrasings(self):
        for text in [
            "Work Mode: Remote",
            "Location: Remote",
            "Remote (Occasional travel)",
            "Integration Developer (.NET / Azure)- Remote -Harrisburg, PA",
            "#LI-REMOTE",
            "Kforce has a client that is seeking a remote Senior Integration Developer",
            "This is a fully remote role.",
            "Remote in Canada",
        ]:
            self.assertEqual(verdict(text), "remote", text)

    def test_hybrid_phrasings_beat_remote_mentions(self):
        for text in [
            "Hybrid: Markham, Ontario",
            "Position Type: Hybrid",
            "This role follows a hybrid work model requiring three days per week onsite.",
            "Remote work considered.\nYou will be in the office 2 days a week.",
            # Principal Financial 4482797439 - read as remote before this pattern existed.
            "hybrid (including at least three office days in a typical workweek), and remote work arrangements",
        ]:
            self.assertEqual(verdict(text), "hybrid", text)

    def test_onsite_phrasings(self):
        for text in ["Workplace: On-site", "This is an on-site role in Dallas.", "#LI-Onsite", "No remote work."]:
            self.assertEqual(verdict(text), "onsite", text)

    def test_technology_words_are_not_arrangements(self):
        for text in [
            "Collaborates with BAW, Informatica and MuleSoft developers to implement hybrid integration solutions",
            "Strong understanding of Active Directory, Entra ID, and hybrid identity",
            "Experience with hybrid environments, secure connectivity",
            "Onsite perks, including catered lunches when working from one of our offices",
            "Provide training or onsite assistance as needed",
            "Remote debugging of Azure Functions",
        ]:
            self.assertEqual(verdict(text), "unknown", text)

    def test_remote_and_onsite_is_mixed(self):
        self.assertEqual(verdict("Location: Remote\nThis is an on-site role 5 days."), "mixed")


class Cli(unittest.TestCase):
    def run_tool(self, args, stdin=""):
        return subprocess.run([sys.executable, str(TOOL), *args], input=stdin.encode("utf-8"),
                              capture_output=True)

    def test_reads_detail_json_from_stdin(self):
        obj = {"title": "Integration Developer", "location": "US", "description": "Work Mode: Remote"}
        out = self.run_tool([], json.dumps(obj))
        self.assertEqual(out.returncode, 0)
        self.assertEqual(json.loads(out.stdout.decode("utf-8"))["workplace"], "remote")

    def test_label_flag(self):
        out = self.run_tool(["--text", "Location: US/CA", "--label", "On-site"])
        self.assertEqual(json.loads(out.stdout.decode("utf-8"))["workplace"], "onsite")

    def test_bad_stdin_exits_2(self):
        self.assertEqual(self.run_tool([], "not json").returncode, 2)


if __name__ == "__main__":
    unittest.main()
