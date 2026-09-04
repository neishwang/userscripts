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
| [`twitch-card-options-everywhere`](scripts/twitch-card-options-everywhere.user.js) | Adds the "more options for this channel" button to every Twitch stream card, including the directory pages where Twitch omits it. Learns the GraphQL request from Twitch's own native menu instead of hardcoding query hashes. | [Install](https://raw.githubusercontent.com/neishwang/userscripts/main/scripts/twitch-card-options-everywhere.user.js) |

## License

[MIT](LICENSE)
