// ==UserScript==
// @name         Twitch — Hidden channels
// @namespace    https://github.com/neishwang/userscripts
// @version      1.2.0
// @description  Blurs and dims the cards of channels you chose to hide. Purely local, no request to Twitch. Adds its item to the menu of "Twitch — Card options button everywhere" when that script is installed, and puts up a button and menu of its own when it is not.
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
    // Companion script only: standalone has no view of that request.
    const HIDE_ON_NOT_INTERESTED = true;
    // Bring a hidden card back to normal while the pointer is over it.
    const REVEAL_ON_HOVER = true;
    const BLUR_RADIUS = '14px';
    const HIDDEN_OPACITY = '0.3';
    // Also put our button on the cards that carry Twitch's own menu — the
    // ones the companion script stands down on. That native menu can send
    // "not interested" but cannot hide anything, so without this there is no
    // way to hide a channel from the home page.
    const BUTTON_ON_NATIVE_CARDS = true;
    // How long to wait for the companion script before putting up our own
    // button. Both scripts run at document-start, so this only has to cover
    // the gap between two userscripts starting, not page load.
    const COMPANION_GRACE_MS = 1500;
    // -------------------------------------------------------------------------

    // 'pending' until we know whether the companion script is around: putting
    // up our own button straight away would mean two of them on every card for
    // as long as it takes the other script to start. Declared here because
    // apply() reads it, and apply() runs before the mode section is reached.
    let mode = 'pending';

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
    // Labels and icons
    // =========================================================================

    /**
     * Twitch localises its own menu items, and in companion mode ours sits
     * among them; following the page language keeps the menu from reading half
     * in one language. Resolved at call time because React sets the lang
     * attribute after we start.
     */
    function labels() {
        const lang = (document.documentElement.lang || navigator.language || '').toLowerCase();
        if (lang.startsWith('fr')) {
            return { hide: 'Masquer la chaîne', show: 'Ne plus masquer', options: 'Options de masquage' };
        }
        return { hide: 'Hide this channel', show: 'Unhide this channel', options: 'Hiding options' };
    }

    const itemLabel = login => (isHidden(login) ? labels().show : labels().hide);

    /**
     * Twitch's own crossed-out eye, copied from the "not interested" item of
     * the native card menu. Using Twitch's icon where Twitch has one is what
     * keeps our entry from standing out as foreign.
     */
    const HIDE_ICON = '<path clip-rule="evenodd" fill-rule="evenodd" d="m2.293 3.707 18 18 1.414-1.414-3.683-3.683a7.98 ' +
        '7.98 0 0 0 .37-.404L22 12l-3.605-4.206A8 8 0 0 0 12.32 5h-.64a8 8 0 0 0-4.122 1.144l-3.85-3.851-1.415 ' +
        '1.414Zm6.738 3.91 2.45 2.45a2.003 2.003 0 0 1 2.451 2.451l2.678 2.678c.091-.094.18-.191.266-.291L19.366 ' +
        '12l-2.49-2.905A6 6 0 0 0 12.32 7h-.64a6 6 0 0 0-2.65.616Z"></path>' +
        '<path d="M12.32 19c.74 0 1.469-.102 2.167-.299l-1.718-1.718a5.967 5.967 0 0 1-.449.017h-.64a6 6 0 0 ' +
        '1-4.556-2.095L4.634 12l1.455-1.697L4.67 8.885 2 12l3.605 4.206A8 8 0 0 0 11.68 19h.64Z"></path>';

    /**
     * Lucide's plain eye (MIT), for the unhide direction: Twitch ships the
     * crossed-out one on this menu but no matching open eye we can lift.
     *
     * Lucide draws with strokes where Twitch fills, so the presentation
     * attributes ride on the group rather than on the <svg>: our item is
     * rendered inside Twitch's own <svg> element in companion mode, and an
     * attribute on the group beats the fill inherited from it.
     */
    const SHOW_ICON = '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 ' +
        '.696 10.75 10.75 0 0 1-19.876 0"></path><circle cx="12" cy="12" r="3"></circle></g>';

    const itemIcon = login => (isHidden(login) ? SHOW_ICON : HIDE_ICON);

    const svgFor = icon =>
        `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`;

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

        /* --- Standalone button and menu -----------------------------------
           Only ever on screen when the companion script is absent, so nothing
           here has to agree with its markup. Twitch's own custom properties
           keep it consistent with the active theme. */

        /* Same trick the companion uses: the row is a flex container whose
           children carry an explicit order, so a plain append would land the
           button ahead of the avatar instead of at the end. */
        .thc-host {
            display: flex; align-items: center;
            order: 999; margin-left: auto; flex: none;
        }
        .thc-host button {
            display: flex; align-items: center; justify-content: center;
            width: 2rem; height: 2rem; padding: 0;
            border: none; border-radius: .4rem; background: none;
            color: var(--color-fill-button-icon, #efeff1); cursor: pointer;
        }
        .thc-host button:hover,
        .thc-menu button:hover {
            background-color: var(--color-background-interactable-hover, rgba(255, 255, 255, .12));
        }
        .thc-host svg, .thc-menu svg { width: 20px; height: 20px; fill: currentColor; flex: none; }

        .thc-menu {
            position: fixed; z-index: 9000;
            width: 16rem; padding: .5rem 0; border-radius: .6rem;
            background-color: var(--color-background-base, #18181b);
            box-shadow: 0 4px 8px rgba(0, 0, 0, .5);
            color: var(--color-text-base, #efeff1);
        }
        .thc-menu button {
            display: flex; align-items: center; gap: .75rem;
            width: 100%; padding: .5rem 1rem;
            border: none; background: none; color: inherit;
            font: inherit; text-align: left; cursor: pointer;
        }
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
            // Writing the same value back still counts as a mutation, which would
            // wake this very observer on every frame for as long as the page is open.
            if (article.getAttribute(LOGIN_ATTR) !== login) article.setAttribute(LOGIN_ATTR, login);
            article.classList.toggle(HIDDEN_CLASS, hidden.has(login));
            reconcileButton(article);
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
    // Standalone mode: our own button and menu
    // =========================================================================

    let openMenu = null;

    function closeMenu() {
        if (!openMenu) return;
        openMenu.menu.remove();
        openMenu.button.setAttribute('aria-expanded', 'false');
        openMenu = null;
    }

    document.addEventListener('click', e => {
        // The menu is mounted on <body>, so a click inside it is not "outside"
        // even though the button does not contain it.
        if (!openMenu) return;
        if (openMenu.button.contains(e.target) || openMenu.menu.contains(e.target)) return;
        closeMenu();
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenu();
    });

    /**
     * A fixed layer drifts away from its button once the page moves, so it is
     * moved along rather than dismissed. Closing on scroll was the tempting
     * shortcut, but focusing a button can scroll its container on its own, and
     * that would shut the menu the moment it opened.
     */
    function trackMenu() {
        if (!openMenu) return;
        if (!openMenu.button.isConnected) {
            closeMenu();
            return;
        }
        positionMenu(openMenu.menu, openMenu.button);
    }

    addEventListener('scroll', trackMenu, true);
    addEventListener('resize', trackMenu);

    /** bottom-end against the button, kept inside the viewport. */
    function positionMenu(menu, button) {
        const b = button.getBoundingClientRect();
        const m = menu.getBoundingClientRect();

        let left = Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8));
        let top = b.bottom + 4;
        if (top + m.height > innerHeight - 8) top = Math.max(8, b.top - m.height - 4);

        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function buildMenu(button, article) {
        const login = loginOf(article);

        const menu = document.createElement('div');
        menu.className = 'thc-menu';
        menu.setAttribute('role', 'menu');

        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.innerHTML = `${svgFor(itemIcon(login))}<span></span>`;
        // Titles arrive from Twitch, so the label goes in as text, never markup.
        item.lastElementChild.textContent = itemLabel(login);

        item.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            toggle(login);
        });

        menu.appendChild(item);
        document.body.appendChild(menu);
        positionMenu(menu, button);
        button.setAttribute('aria-expanded', 'true');
        openMenu = { button, menu };
    }

    /**
     * The row that holds the title block and the avatar — where Twitch puts
     * its own card button. The avatar link carries a stable data-test-selector,
     * so the row is found through it rather than through a generated class.
     */
    function findMetaRow(article) {
        const avatar = article.querySelector('[data-test-selector="preview-card-avatar"]');
        const row = avatar && avatar.parentElement && avatar.parentElement.parentElement;
        return row && row.contains(article.querySelector('[data-test-selector="TitleAndChannel"]')) ? row : null;
    }

    /**
     * Whether this card wants a button of ours.
     *
     * Standalone, every card does. Alongside the companion, only the cards it
     * deliberately leaves alone do: it stands down wherever Twitch ships its
     * own menu, and that menu offers "not interested" but nothing that hides
     * anything locally. On the cards it does take over, our item is already in
     * its menu and a second button would be a duplicate.
     *
     * While the mode is still 'pending' the answer is no, which is what keeps
     * two buttons off the cards during the grace window.
     */
    function shouldInject(article) {
        if (mode === 'standalone') return true;
        if (mode !== 'companion') return false;
        return BUTTON_ON_NATIVE_CARDS && !article.querySelector('.tco-host');
    }

    /**
     * One button per card, added once and then left alone — except for its
     * icon, which follows the channel's state and so is refreshed on every
     * pass. Twitch's own three-dot button may sit next to ours; the icon is
     * deliberately different so the two do not read as duplicates.
     *
     * The decision is retaken on every pass rather than remembered, because
     * the companion can inject its own button into a card after we have
     * already looked at it — in which case ours has to come back out.
     */
    function reconcileButton(article) {
        const existing = article.querySelector('.thc-host');

        if (!shouldInject(article)) {
            if (existing) {
                if (openMenu && existing.contains(openMenu.button)) closeMenu();
                existing.remove();
            }
            return;
        }

        const login = loginOf(article);
        if (!login) return;

        // Repainting the icon on every pass is what a card recycled under a
        // different channel needs — but only when it actually changed. Writing
        // the same markup back each frame mutates the DOM, which wakes our own
        // observer and Twitch's rendering, and the resulting churn tore the
        // button out from under the pointer: with the element replaced between
        // mousedown and mouseup, the browser never fired a click at all.
        const state = `${login}:${isHidden(login) ? 'hidden' : 'shown'}`;
        if (existing) {
            if (existing.dataset.thcState !== state) {
                existing.dataset.thcState = state;
                const button = existing.querySelector('button');
                if (button) {
                    button.innerHTML = svgFor(itemIcon(login));
                    button.setAttribute('aria-label', labels().options);
                }
            }
            return;
        }

        const row = findMetaRow(article);
        if (!row) return;

        const host = document.createElement('div');
        host.className = 'thc-host';
        host.dataset.thcState = state;

        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', labels().options);
        button.innerHTML = svgFor(itemIcon(login));

        const open = e => {
            e.preventDefault();
            e.stopPropagation();
            const wasOpen = openMenu && openMenu.button === button;
            closeMenu();
            if (!wasOpen) buildMenu(button, article);
        };

        // mousedown rather than click, so that a re-render of the card between
        // press and release cannot swallow the interaction. preventDefault
        // keeps the press from focus-scrolling the card into view.
        button.addEventListener('mousedown', open);
        button.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') open(e);
        });

        host.appendChild(button);
        row.appendChild(host);
    }

    // =========================================================================
    // Picking a mode
    // =========================================================================

    function useCompanion(api) {
        if (mode === 'companion' || !api || typeof api.addItem !== 'function') return;

        // A companion that shows up late takes over: the buttons we put on the
        // cards it handles come down, and the item moves into its menu.
        mode = 'companion';

        api.addItem({
            id: 'thc-hide-channel',
            label: ctx => itemLabel(ctx.login),
            icon: ctx => itemIcon(ctx.login),
            onSelect: ctx => {
                toggle(ctx.login);
                ctx.close();
            },
        });

        // Deciding the mode is only half of it: the pass that ran while it was
        // still 'pending' put no button anywhere, so the cards are repainted
        // against the answer we now have.
        apply();
    }

    // Load order between two userscripts is not ours to control, so cover both
    // directions: the registry if it is already there, the event if not.
    if (window.tcoMenu) useCompanion(window.tcoMenu);
    document.addEventListener('tco:ready', e => useCompanion(e.detail));

    setTimeout(() => {
        if (mode !== 'pending') return;
        mode = 'standalone';
        apply();
    }, COMPANION_GRACE_MS);

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
