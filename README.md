- I dont really like the scrolling its not as smooth as I would like but might refine later
- IF you want to see a message inbetween the context window set by `visible messages` in the popup just up it a bit. F**K the smooth scrolling
- 
## Kept Feature (Detailed Guide)

The kept feature lets you save specific visible chat ranges, then hide everything else so you can jump between only the parts you care about.

### Header buttons (what they do)

- `Keep shown`: Saves the messages currently visible on screen as a kept range
- `Only kept`: Shows only kept messages/ranges (hides everything else)
- `Unselect all kept`: Clears all kept ranges/messages
- `Keep loaded`: Temporarily disables paging and shows all loaded messages

### Basic workflow (recommended)

1. Scroll to the first section you care about (example: `45-50 / 100`)
2. Click `Keep shown`
3. Scroll to another section (example: `70-75 / 100`)
4. Click `Keep shown` again
5. Click `Only kept`

Now only the kept sections remain visible, and the in-between messages are hidden.

### Important behavior notes

- `Keep shown` adds to what is already kept (it does not replace)
- `Only kept` with `0` kept shows no messages
- `Unselect all kept` clears everything you saved
- `Keep loaded` and `Only kept` are different modes:
  - `Keep loaded` = show everything currently loaded
  - `Only kept` = show only the ranges you saved

### Example use case

Use kept mode when comparing two parts of a long conversation (like earlier instructions vs later results) without scrolling through the entire middle every time.

# LongerGPTChats: Install From GitHub (Chrome)

## 1. Clone the repo

Open a terminal and run:

```bash
git clone https://github.com/Apache0ne/longergptchats.git
```

This creates a folder named `longergptchats`.

## 2. Open Chrome Extensions

In Chrome, go to:

```text
chrome://extensions/
```

## 3. Enable Developer Mode

Turn on the **Developer mode** toggle (top-right).

## 4. Load the extension

Click **Load unpacked** and select the cloned `longergptchats` folder.

## 5. Use it

Open `https://chatgpt.com/` (or refresh the tab if already open) and use the extension popup/settings.

## Updating after changes

If you edit the extension files, go back to `chrome://extensions/` and click the **Reload** button on the extension card, then refresh ChatGPT.
