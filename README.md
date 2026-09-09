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
| [`twitch-not-interested-everywhere`](scripts/twitch-not-interested-everywhere.user.js) | Puts the "not interested" action on every Twitch stream card, including the directory pages where Twitch omits the menu entirely. Rebuilds the native menu, sends the real feedback, and shows Twitch's own removal notice with a working undo. Relearns markup, styles and query hashes from the native menu whenever Twitch changes them, and lets companion scripts add their own items. | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/twitch-not-interested-everywhere.user.js) |
| [`twitch-hidden-channels`](scripts/twitch-hidden-channels.user.js) | Blurs the thumbnail and dims the card of channels you chose to hide, revealing it on hover. The list is local, nothing is sent to Twitch. Standalone it puts a one-click hide button on every card; installed next to `twitch-not-interested-everywhere` it becomes an item in that menu instead, keeps its button on the cards that script leaves to Twitch, and hides a channel automatically when you send "not interested". | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/twitch-hidden-channels.user.js) |

## License

[MIT](LICENSE)
