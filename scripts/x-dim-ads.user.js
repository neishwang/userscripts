// ==UserScript==
// @name         X (Twitter) — Dim ads to 40% opacity
// @namespace    https://github.com/neishwang/userscripts
// @version      1.1.0
// @description  Dims ads in the X/Twitter timeline to 40% opacity (back to 100% on hover).
// @author       neishwang
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---- Settings -----------------------------------------------------------
    // Ad opacity
    const OPACITY = 0.4;
    // Restore full opacity on hover
    const HOVER_FULL = true;
    // -------------------------------------------------------------------------

    const MARK = 'data-dimmed-ad';

    const AD_LABEL = /^(Ad|Ads|Promoted|Sponsored|Publicité|Sponsorisé|Werbung|Gesponsert|Anuncio|Patrocinado|Annuncio|Sponsorizzato|Реклама|广告|プロモーション)$/i;

    // Styles are injected once.
    const style = document.createElement('style');
    style.textContent = `
        [${MARK}] {
            opacity: ${OPACITY} !important;
            transition: opacity .2s ease;
        }
        ${HOVER_FULL ? `[${MARK}]:hover { opacity: 1 !important; }` : ''}
    `;
    (document.head || document.documentElement).appendChild(style);

    /**
     * Ad detection.
     *
     * We only look at the tweet header (the name + handle + date line), which
     * contains either a <time> element or the "Ad" label — never both. That is
     * the only stable structural difference between a promoted tweet and a
     * regular one.
     *
     * Note: we do NOT rely on data-testid="placementTracking". X also uses it
     * as a tracking wrapper for video playback, so starting a video on a
     * regular tweet used to make it look like an ad.
     */
    function isAd(cell) {
        const article = cell.querySelector('article[data-testid="tweet"]');
        if (!article) return false;

        const userName = article.querySelector('[data-testid="User-Name"]');
        const caret = article.querySelector('[data-testid="caret"]');
        if (!userName || !caret) return false;

        // Lowest common ancestor of the handle and the "…" button: the header line.
        let header = caret.parentElement;
        while (header && header !== article && !header.contains(userName)) {
            header = header.parentElement;
        }
        if (!header || header === article) return false;

        // A regular tweet always shows its date in that line; an ad does not.
        if (header.querySelector('time')) return false;

        return [...header.querySelectorAll('span')]
            .some(s => AD_LABEL.test(s.textContent.trim()));
    }

    function apply(cell) {
        // Always re-evaluate: the timeline is virtualized, X recycles cells from
        // one tweet to the next. A sticky mark would "stick" to the cell.
        const ad = isAd(cell);
        if (ad === cell.hasAttribute(MARK)) return;
        if (ad) cell.setAttribute(MARK, '');
        else cell.removeAttribute(MARK);
    }

    function scan() {
        for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
            apply(cell);
        }
    }

    let pending = false;
    const observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            scan();
        });
    });

    function start() {
        scan();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
