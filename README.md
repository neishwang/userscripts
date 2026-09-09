# userscripts

Personal userscripts for Tampermonkey / Violentmonkey / Greasemonkey.

## Installation

1. Install a userscript manager:
   [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Click the **Install** link below — the extension picks up the `.user.js` file
   automatically and offers to install it.

## Scripts

| Script | Description | Install |
| ------ | ----------- | ------- |
| [`x-dim-ads`](scripts/x-dim-ads.user.js) | Dims ads in the X/Twitter timeline to 40% opacity, back to 100% on hover. Detection is based on the tweet header: a regular tweet shows a date, an ad shows an "Ad" label instead. | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/x-dim-ads.user.js) |
| [`twitch-card-options-everywhere`](scripts/twitch-card-options-everywhere.user.js) | Adds the "more options for this channel" button to every Twitch stream card, including the directory pages where Twitch omits it. Rebuilds the native menu, sends the real "not interested" feedback, and shows Twitch's own removal notice with a working undo. Relearns markup, styles and query hashes from the native menu whenever Twitch changes them. | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/twitch-card-options-everywhere.user.js) |
| [`twitch-hidden-channels`](scripts/twitch-hidden-channels.user.js) | Blurs the thumbnail and dims the card of channels you chose to hide. The list is local, nothing is sent to Twitch. Companion to `twitch-card-options-everywhere`: it adds a "Hide this channel" item to the card menu, and hides a channel automatically when you send "not interested". Works on its own too, with the list managed from the console. | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/twitch-hidden-channels.user.js) |

## License

[MIT](LICENSE)
