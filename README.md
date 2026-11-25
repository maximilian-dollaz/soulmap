# The Soul Map

**Know Thyself.**

A whole human understanding system. It maps how you are built, then shapes how you work, and how your AI works with you, to fit.

A 45 minute interview on your Mac that maps how you work: Human Design and Gene Keys from your birth data, then Enneagram, attachment, Big Five, chronotype, values, how you perform, learn, value, belong and contribute (after Peter Drucker's five questions in *Managing Oneself*), and how you create value (after Wealth Dynamics) from your answers. Connect your AI chats, meetings, messages and email and it also learns from how you actually talk and work. It gives you three things: a report for you, a one-minute card that tells others how to work with you, and a soul file your AI tools read so they work the way you do.

Website: https://soulmap.nextmissionsi.com

## Install

Open Terminal and paste:

```bash
curl -fsSL https://soulmap.nextmissionsi.com/install.sh | bash
```

It installs what your Mac is missing (Node, and uv for Python), then opens the Soul Map at http://localhost:3355/soul. No admin password. Allow about 5 minutes.

Needs: macOS, 8 GB of memory, about 2 GB of free disk (8 GB more if you choose the local model).

## Who does the thinking

Onboarding asks you to pick one. You can change it later in Settings.

- **Claude (recommended).** Claude by Anthropic reads your answers and your own lines from meetings, then writes your report. Uses your own Anthropic API key, about 30 cents a report. Get a key at https://console.anthropic.com/settings/keys.
- **Only this Mac.** A free model runs on your Mac through Ollama. Nothing you say leaves it. One download of about 5 GB; reports take a few minutes and read plainer.

## Use it

1. Fill in your name and birth date, time and city, and pick who does the thinking.
2. Answer the questions. Stop any time; it remembers.
3. Optional: open **Connections**. Claude Code connects on its own; Otter and Granola take one click; a Claude.ai export or an email export (.mbox) is picked up from Downloads; iMessage and WhatsApp are read in place once you turn them on and give the Soul Map Full Disk Access. New material syncs once a day.
4. Tap **Build my report**. When new evidence changes the picture, the report and soul file are rewritten, at most once a week.
5. Open **Soul file** and tap **Add to Claude Code**, or copy it into claude.ai, ChatGPT or Grok.
6. Open **Team**, copy your card and send it to the people you work with; paste theirs to see how to work with them.
7. Open **Energy Audit**. After each big task your AI asks how it went and how it affected your energy (0 to 10). Once a week you get an audit of what gave you energy and what drained you, with small adjustments; nothing changes until you say yes.

## What is stored, and where

- Your answers, chart, reports and settings stay in this folder on your Mac (`data/` and `report/`, never committed).
- From meetings, messages and email, only your own words are kept. Other people's words are never stored or sent.
- Messages and email are off until you turn them on, and are scored on this Mac by the local model unless you allow Claude for them.
- The report holds patterns and scores, never quotes.

## Update or remove

- Update: automatic. Once a day (4:17 am, or when the Mac next wakes) it checks for a new version and updates itself; your answers and reports stay. To update right now: `~/SoulMap/scripts/update.sh`. The log is `~/.soulmap/logs/com.soulmap.app.update.log`.
- Stop and remove the background service: `~/SoulMap/uninstall.sh`. Delete `~/SoulMap` to remove your data.

## Layout

- `app/` the app (Next.js). Runs on 127.0.0.1:3355, starts at login. `app/lib/ai.ts` picks Claude or the local model.
- `analysis/hdcalc/` Human Design and Gene Keys calculator (Python, Swiss Ephemeris, offline).
- `analysis/questions/` question banks, interview plan, scoring.
- `analysis/report-prompt.md` the report prompt.
- `evidence/` reads your own side of Claude Code sessions and meetings, scores it, and keeps only numbers and short paraphrases.
- `scripts/local-model.sh` installs Ollama and the local model when you choose it.
- `site/` the website.

## License

MIT. See `LICENSE`.
