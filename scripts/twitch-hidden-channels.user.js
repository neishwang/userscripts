// ==UserScript==
// @name         Twitch — Hidden channels
// @namespace    https://github.com/neishwang/userscripts
// @version      1.0.0
// @description  Blurs and dims the cards of channels you chose to hide. Purely local, no request to Twitch. Adds a "Hide"/"Unhide" item to the card menu when "Twitch — Card options button everywhere" is installed.
// @author       neishwang
// @match        https://www.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---- Settings -----------------------------------------------------------
    // Hide a channel as soon as "not interested" is sent from the companion
    // script's menu. Twitch stops recommending it, we stop showing it.
    const HIDE_ON_NOT_INTERESTED = true;
    // Bring a hidden card back to normal while the pointer is over it.
    const REVEAL_ON_HOVER = true;
    const BLUR_RADIUS = '14px';
    const HIDDEN_OPACITY = '0.3';
    // -------------------------------------------------------------------------

    const STORE_KEY = 'thc-hidden-channels';
    const HIDDEN_CLASS = 'thc-hidden';
    // Kept on the card so the console API can report what it matched against.
    const LOGIN_ATTR = 'data-thc-login';

    // =========================================================================
    // The list
    // =========================================================================

    /**
     * Logins are stored lowercase: Twitch links carry the display casing, so
     * "Emi_MGE7" and "emi_mge7" are the same channel and must not both end up
     * in the list.
     */
    function load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORE_KEY));
            return new Set(Array.isArray(raw) ? raw.map(l => String(l).toLowerCase()) : []);
        } catch {
            return new Set();
        }
    }

    function save(set) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
        } catch {
            // Quota or private mode; the in-page session still reflects it.
        }
    }

    function isHidden(login) {
        return Boolean(login) && load().has(login.toLowerCase());
    }

    function hide(login) {
        if (!login) return;
        const set = load();
        set.add(login.toLowerCase());
        save(set);
        apply();
    }

    function unhide(login) {
        if (!login) return;
        const set = load();
        set.delete(login.toLowerCase());
        save(set);
        apply();
    }

    function toggle(login) {
        if (isHidden(login)) unhide(login);
        else hide(login);
    }

    // =========================================================================
    // Painting the cards
    // =========================================================================

    const style = document.createElement('style');
    style.textContent = `
        article.${HIDDEN_CLASS} {
            opacity: ${HIDDEN_OPACITY};
            transition: opacity .15s ease;
        }
        /* Blur the media, not the card: filtering the whole article would
           smear the title and the tags into an unreadable mush, and the point
           is to stay able to tell which channel this is. */
        article.${HIDDEN_CLASS} img {
            filter: blur(${BLUR_RADIUS});
            transition: filter .15s ease;
        }
        ${REVEAL_ON_HOVER ? `
        article.${HIDDEN_CLASS}:hover { opacity: 1; }
        article.${HIDDEN_CLASS}:hover img { filter: none; }
        ` : ''}
    `;
    (document.head || document.documentElement).appendChild(style);

    /**
     * The card's channel login, from the link Twitch puts on the title block.
     * The avatar link can point at /login/videos, so only the first path
     * segment is trusted.
     */
    function loginOf(article) {
        const link = article.querySelector('a[data-a-target="preview-card-channel-link"]') ||
            article.querySelector('a[data-a-target="preview-card-image-link"]');
        const href = link && link.getAttribute('href');
        if (!href) return null;

        const segment = href.split('?')[0].split('/').filter(Boolean)[0];
        return segment ? segment.toLowerCase() : null;
    }

    /**
     * Re-decide for every card on every pass rather than marking one as done:
     * Twitch recycles card elements as the directory paginates, so a node that
     * was a hidden channel a moment ago can be showing a different one now.
     */
    function apply() {
        const hidden = load();
        for (const article of document.querySelectorAll('article')) {
            const login = loginOf(article);
            if (!login) continue;
            article.setAttribute(LOGIN_ATTR, login);
            article.classList.toggle(HIDDEN_CLASS, hidden.has(login));
        }
    }

    let pending = false;
    const observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            apply();
        });
    });

    function start() {
        apply();
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    // Another tab changing the list should not leave this one out of date.
    addEventListener('storage', e => {
        if (e.key === STORE_KEY) apply();
    });

    // =========================================================================
    // The menu item, when the companion script is around
    // =========================================================================

    // Twitch localises its own items, and ours sits among them; matching the
    // page language keeps the menu from reading half in one language.
    function labels() {
        const lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
        if (lang.startsWith('fr')) return { hide: 'Masquer la chaîne', show: 'Ne plus masquer' };
        return { hide: 'Hide this channel', show: 'Unhide this channel' };
    }

    // Crossed-out circle for hiding, plain eye for restoring.
    const HIDE_ICON = '<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 ' +
        '12.9-6.31L5.69 16.9A7.96 7.96 0 0 1 4 12Zm4.1 6.31A8 8 0 0 0 20 12c0-1.8-.59-3.45-1.59-4.79L7.1 ' +
        '18.31Z" clip-rule="evenodd"></path>';
    const SHOW_ICON = '<path fill-rule="evenodd" d="M12 5c-4.42 0-8.13 2.94-9.32 6.97a1.5 1.5 0 0 0 0 ' +
        '.86C3.87 16.06 7.58 19 12 19s8.13-2.94 9.32-6.97a1.5 1.5 0 0 0 0-.86C20.13 7.94 16.42 5 12 5Zm0 ' +
        '2c3.4 0 6.28 2.2 7.32 5.24l.05.16-.05.16C18.28 14.8 15.4 17 12 17s-6.28-2.2-7.32-5.24l-.05-.16.05-.16C5.72 ' +
        '9.2 8.6 7 12 7Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" clip-rule="evenodd"></path>';

    let registered = false;

    function register(api) {
        if (registered || !api || typeof api.addItem !== 'function') return;
        registered = true;

        api.addItem({
            id: 'thc-hide-channel',
            label: ctx => (isHidden(ctx.login) ? labels().show : labels().hide),
            icon: ctx => (isHidden(ctx.login) ? SHOW_ICON : HIDE_ICON),
            onSelect: ctx => {
                toggle(ctx.login);
                ctx.close();
            },
        });
    }

    // Load order between two userscripts is not ours to control, so cover both
    // directions: the registry if it is already there, the event if not.
    if (window.tcoMenu) register(window.tcoMenu);
    document.addEventListener('tco:ready', e => register(e.detail));

    document.addEventListener('tco:feedback', e => {
        if (!HIDE_ON_NOT_INTERESTED) return;
        hide(e.detail && e.detail.login);
    });

    // "Not interested" was taken back, so the hide that came with it goes too.
    document.addEventListener('tco:feedback-undone', e => {
        if (!HIDE_ON_NOT_INTERESTED) return;
        unhide(e.detail && e.detail.login);
    });

    // =========================================================================
    // Console API
    // =========================================================================

    // There is no settings page, so the list is managed from the console:
    // twitchHiddenChannels.list(), .hide('login'), .unhide('login'), .clear().
    window.twitchHiddenChannels = {
        list: () => [...load()].sort(),
        hide: login => { hide(login); return [...load()].sort(); },
        unhide: login => { unhide(login); return [...load()].sort(); },
        clear: () => { save(new Set()); apply(); },
    };
})();
