from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def test_digest_command_and_launchagent_are_documented():
    command = (ROOT / ".opencode" / "commands" / "job-digest.md").read_text(encoding="utf-8")
    plist = (ROOT / "ops" / "com.victor.ai-job-search.digest.plist").read_text(encoding="utf-8")
    script = (ROOT / "tools" / "daily_digest.sh").read_text(encoding="utf-8")

    assert command.startswith("---\ndescription: Ejecuta búsqueda y ranking diarios")
    assert "# /job-digest" in command
    assert "/job-scrape" in command
    assert "/job-rank" in command
    assert "secondbrain" in command.lower()
    assert "StartCalendarInterval" in plist
    assert "Hour" in plist
    assert "daily_digest.sh" in plist
    assert "opencode run" in script
    assert "--command job-scrape" in script
    assert "--command job-rank" in script
    assert "tools/digest.py" in script
