# Trello Roadmap

A local, read-only roadmap for any Trello workspace. Combine multiple boards in one timeline, with global deadlines, all-day blockers, and a floating project minimap.

## Run

Requires **Windows, Python 3.11+**, and an internet connection for Trello. No Python packages or frontend build tools are required. Git enables GitHub version comparisons; Node.js is only needed for JavaScript tests.

```powershell
git clone https://github.com/florenzius/TrelloRoadmap.git
cd TrelloRoadmap
python server.py
```

Or double-click `Start-Roadmap.cmd`. Open **http://127.0.0.1:8765**. Keep the server running; press Ctrl+C in its console to stop. If the port is occupied, stop the existing instance or use `python server.py --port 8766`. Use `--no-browser` to skip opening a browser.

## Connect Trello

1. Create/open a Power-Up in [Trello's developer portal](https://trello.com/apps/admin) and generate an API key under **Trello Auth**. Publishing or installing the Power-Up on your boards is unnecessary.
2. In Trello Roadmap, choose **Connection**, enter the key, and click **Create a read-only token in Trello**. Paste the resulting token and connect.
3. Select a workspace. Trello Roadmap loads its accessible, non-archived boards and cards. Press **F5** to refresh Trello data.

Credentials are encrypted with Windows DPAPI for your Windows account and stored in the ignored `.local/` directory. Removing the local connection does not revoke the token at Trello. Trello Roadmap only sends **GET** requests to Trello.

## Features

- **Boards:** toggle task lanes and choose board colors. **View:** hide assignee names or date/list details, and set local display names for members.
- **Time:** start dates begin at midnight; card endings and deadline lines use the exact local due time. Cards without dates are hidden. Completed cards use 40% opacity. The Now line updates every minute.
- **Deadlines:** use the `Deadline` label or a title such as `Deadline 1`. They appear as red milestones, independently of board visibility.
- **Blockers:** use the `Blocker` label. The entire start and end days are blocked across all boards; hours are ignored. For example, 21 December–3 January includes all 14 days. Blockers take precedence over deadlines and never appear as tasks.
- **Sprints:** use the `Sprint` label. Sprints respect the exact local due time and appear in a separate top row and as named bands above the minimap. Non-overlapping sprints share a row. They do not shade board lanes and never appear as tasks. Like blockers and deadlines, they remain visible when their source board is hidden.
- **Minimap:** reopen it with the floating bottom-right button. Set the project start/end dates, or use **Fit to cards** to include the earliest and latest dates of all loaded cards, including hidden boards; the end date is inclusive. It shows board-colored blocks, global blockers, and a dated line for every deadline. Close with ×, Escape, or a click outside. Ranges are saved per workspace in this browser.

Card titles, lists, workspace names, and member names remain as supplied by Trello. The application UI is English. Browser preferences are retained when using the same local address and port.

### Configurable Trello matching

Open **Settings → Trello matching rules** to change how deadlines, blockers, and sprints are detected. For each type, enter comma-separated **label names**, **list names**, and/or **title prefixes**. An item matches when any configured method matches; matching ignores case, while labels and list names must match fully. Title prefixes stop at a word boundary (`Meeting` matches `Meeting 6`, but not `Meetings to research`). Leave a method blank to disable it, or all three blank to disable that type. **Restore default rules** fills the original defaults; press **Save settings** to apply them.

If rules overlap, priority is **blocker → sprint → deadline → task**. Rules are stored locally with application settings, persist across restarts, and apply to both the timeline and minimap without changing Trello. Deadline rows reserve the measured width of visible content, so nearby labels can share a row while actual text overlaps still wrap.

## Versions and updates

The footer shows the SHA-256 fingerprint of the running application source and its local build date: when that source snapshot was first loaded. Click it or open **Settings** to configure a GitHub repository and optional branch (blank uses its default branch).

Trello Roadmap checks GitHub when opened, caches results for 15 minutes, and displays a notice when the remote branch is ahead of the local Git commit. **Check again** forces a fresh check. Private repositories use existing local Git authentication as a fallback. Git may fetch commit metadata to compare history; it never pulls or modifies working files. Missing access, rate limits, missing Git, and offline checks are reported explicitly. Trello credentials are never sent to GitHub.

To update, preserve any local changes, then run `git pull --ff-only` or clone a fresh checkout. **Restart the Python server** and refresh the browser. Browser refresh alone cannot reload server changes. A fresh clone needs the ignored `.local/` directory copied separately to preserve the connection on the same Windows account.

## Troubleshooting

If buttons do nothing and the footer stays on “Loading build information…”, check the browser console for a module MIME-type error. Older versions relied on system file associations for `.js` and `.mjs`; some Windows installations return a non-JavaScript type, which browsers block. Update the checkout, stop and restart the Python server, then refresh the browser with Ctrl+F5. The server now sets these content types explicitly.

## Development

```powershell
node --test tests/timeline.test.mjs
python -m unittest discover -s tests -v
```

`server.py` serves the app and reads Trello; `versioning.py` handles build identity and GitHub checks; `public/` contains the buildless UI. Keep `.local/`, credentials, and personal screenshots out of commits.
