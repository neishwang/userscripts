// ==UserScript==
// @name         Twitch — Card options button everywhere
// @namespace    https://github.com/neishwang/userscripts
// @version      1.0.0
// @description  Adds the "more options for this channel" button to every stream card, including directory pages where Twitch omits it.
// @author       neishwang
// @match        https://www.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---- Settings -----------------------------------------------------------
    // Operation names we try to learn from Twitch's own GraphQL traffic.
    const LEARNABLE_OPS = /recommendationfeedback|notinterested|shelffeedback|feedback/i;
    // Hide the card locally once an action succeeds, for immediate feedback.
    const HIDE_ON_SUCCESS = true;
    // -------------------------------------------------------------------------

    const MARK = 'data-tco-injected';
    const GQL_URL = 'https://gql.twitch.tv/gql';
    const STORE_KEY = 'tco-learned-operations';

    // Kept in memory only, never persisted: this holds the user's session token,
    // captured from Twitch's own requests so we can replay against the same
    // endpoint with the same credentials the page already uses.
    let capturedHeaders = null;

    // Keep a pristine reference before patching, so our own calls do not recurse
    // back into the recorder.
    const nativeFetch = window.fetch.bind(window);

    // =========================================================================
    // Learning: watch Twitch's GraphQL traffic
    // =========================================================================

    /**
     * Twitch drives the native menu through persisted GraphQL queries, whose
     * sha256 hashes rotate on every deploy. Rather than hardcoding them, we
     * observe the real request the native button makes and store its shape.
     * The user only has to use the native menu once, on a page that still has
     * it (the logged-in home page), to unlock the action everywhere else.
     */
    function loadLearned() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        } catch {
            return {};
        }
    }

    function saveLearned(name, template) {
        const all = loadLearned();
        all[name] = template;
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(all));
        } catch {
            // Quota or private mode; the in-page session still works.
        }
    }

    const AUTH_HEADERS = /^(client-id|authorization|client-integrity|client-session-id|client-version|x-device-id)$/i;

    function rememberHeaders(headers) {
        if (!headers) return;

        // Headers may arrive as a Headers instance, a plain object, or an array.
        const out = {};
        const set = (key, value) => {
            if (AUTH_HEADERS.test(String(key))) out[key] = value;
        };

        if (typeof headers.forEach === 'function' && !Array.isArray(headers)) headers.forEach((v, k) => set(k, v));
        else if (Array.isArray(headers)) headers.forEach(([k, v]) => set(k, v));
        else Object.entries(headers).forEach(([k, v]) => set(k, v));

        if (Object.keys(out).length) capturedHeaders = Object.assign({}, capturedHeaders, out);
    }

    function hasCredentials() {
        return Boolean(capturedHeaders && (capturedHeaders.Authorization || capturedHeaders.authorization));
    }

    function inspectGqlBody(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        for (const op of (Array.isArray(parsed) ? parsed : [parsed])) {
            if (!op || typeof op !== 'object') continue;
            const name = op.operationName;
            if (!name || !LEARNABLE_OPS.test(name)) continue;

            const persisted = op.extensions && op.extensions.persistedQuery;
            saveLearned(name, {
                operationName: name,
                hash: (persisted && persisted.sha256Hash) || null,
                query: op.query || null,
                variables: op.variables || {},
                learnedAt: new Date().toISOString(),
            });
        }
    }

    window.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.includes('gql.twitch.tv')) {
                rememberHeaders((init && init.headers) || (input && input.headers));
                const body = init && init.body;
                if (typeof body === 'string') inspectGqlBody(body);
            }
        } catch {
            // Never let instrumentation break the page.
        }
        return nativeFetch(input, init);
    };

    // Twitch also issues some GraphQL calls over XHR.
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._tcoIsGql = String(url).includes('gql.twitch.tv');
        this._tcoHeaders = {};
        return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
        if (this._tcoIsGql) this._tcoHeaders[key] = value;
        return nativeSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        try {
            if (this._tcoIsGql) {
                rememberHeaders(this._tcoHeaders);
                if (typeof body === 'string') inspectGqlBody(body);
            }
        } catch {
            // Ignore.
        }
        return nativeSend.apply(this, arguments);
    };

    // =========================================================================
    // Reading the card's own React state
    // =========================================================================

    /**
     * Cards expose their channel login in the DOM, but the GraphQL mutation
     * needs the numeric channel ID. React keeps it in the fiber tree hanging
     * off the DOM node, so we walk up from the card looking for props that
     * carry both an id and a login.
     */
    function getFiber(el) {
        for (const key in el) {
            if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) return el[key];
        }
        return null;
    }

    function looksLikeChannel(value) {
        return Boolean(value) && typeof value === 'object' &&
            typeof value.id === 'string' && /^\d+$/.test(value.id) &&
            typeof value.login === 'string';
    }

    function findChannel(article) {
        let fiber = getFiber(article);

        // Bounded walk: deep enough to reach the card component, cheap enough
        // to run on every card.
        for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            if (!props || typeof props !== 'object') continue;

            for (const value of Object.values(props)) {
                if (looksLikeChannel(value)) return { id: value.id, login: value.login };
                if (value && typeof value === 'object') {
                    for (const nested of Object.values(value)) {
                        if (looksLikeChannel(nested)) return { id: nested.id, login: nested.login };
                    }
                }
            }
        }
        return null;
    }

    function firstSegment(href) {
        return href ? href.split('/').filter(Boolean)[0] || null : null;
    }

    function readCard(article) {
        const channelLink = article.querySelector('a[data-a-target="preview-card-channel-link"]');
        // The avatar link can point at /login/videos, so only trust the first segment.
        const login = firstSegment(channelLink && channelLink.getAttribute('href'));

        const gameLink = article.querySelector('a[data-a-target="preview-card-game-link"]');
        const category = gameLink ? {
            name: gameLink.textContent.trim(),
            slug: (gameLink.getAttribute('href') || '').split('/').filter(Boolean).pop() || null,
        } : null;

        const fromReact = findChannel(article);
        return {
            login: (fromReact && fromReact.login) || login,
            id: (fromReact && fromReact.id) || null,
            category,
        };
    }

    // =========================================================================
    // Replaying a learned mutation against a different channel
    // =========================================================================

    const ID_KEY = /(^id$|itemid|channelid|targetid|userid|broadcasterid)/i;

    /**
     * Swap the channel identifier in a recorded variables payload. We match on
     * key name rather than on the recorded value, since we never know which
     * channel the user originally acted on.
     */
    function retarget(variables, channelId) {
        if (Array.isArray(variables)) return variables.map(v => retarget(v, channelId));
        if (!variables || typeof variables !== 'object') return variables;

        const out = {};
        for (const [key, value] of Object.entries(variables)) {
            if (ID_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) out[key] = channelId;
            else out[key] = retarget(value, channelId);
        }
        return out;
    }

    async function replay(operationName, channelId) {
        const learned = loadLearned()[operationName];
        if (!learned) throw new Error('nothing learned yet');
        if (!hasCredentials()) throw new Error('no credentials captured');

        const payload = {
            operationName: learned.operationName,
            variables: retarget(learned.variables, channelId),
        };
        if (learned.hash) payload.extensions = { persistedQuery: { version: 1, sha256Hash: learned.hash } };
        else if (learned.query) payload.query = learned.query;

        const res = await nativeFetch(GQL_URL, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, capturedHeaders),
            body: JSON.stringify(payload),
            credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        const body = Array.isArray(json) ? json[0] : json;
        if (body && body.errors && body.errors.length) throw new Error(body.errors[0].message || 'GraphQL error');
        return body;
    }

    // =========================================================================
    // UI
    // =========================================================================

    const style = document.createElement('style');
    style.textContent = `
        .tco-host { position: absolute; top: 6px; right: 6px; z-index: 10; }
        .tco-button {
            display: flex; align-items: center; justify-content: center;
            width: 30px; height: 30px; padding: 0;
            border: none; border-radius: 4px; cursor: pointer;
            color: var(--color-text-button-secondary, #efeff1);
            background-color: var(--color-background-button-secondary-default, rgba(0, 0, 0, .6));
            opacity: 0; transition: opacity .15s ease, background-color .15s ease;
        }
        article:hover .tco-button,
        .tco-button[aria-expanded="true"],
        .tco-button:focus-visible { opacity: 1; }
        .tco-button:hover { background-color: var(--color-background-button-secondary-hover, rgba(0, 0, 0, .85)); }
        .tco-menu {
            position: absolute; top: 34px; right: 0; min-width: 230px; padding: 6px 0;
            border-radius: 6px; font-size: 13px;
            color: var(--color-text-base, #efeff1);
            background-color: var(--color-background-body, #18181b);
            box-shadow: 0 4px 12px rgba(0, 0, 0, .5);
        }
        .tco-item {
            display: block; width: 100%; padding: 8px 14px; border: none;
            font: inherit; text-align: left; color: inherit; background: none; cursor: pointer;
        }
        .tco-item:hover:not(:disabled) { background-color: var(--color-background-interactable-hover, rgba(255, 255, 255, .1)); }
        .tco-item:disabled { opacity: .5; cursor: default; }
        .tco-note { padding: 8px 14px; font-size: 12px; line-height: 1.4; opacity: .7; }
    `;
    (document.head || document.documentElement).appendChild(style);

    let openMenu = null;

    function closeMenu() {
        if (!openMenu) return;
        openMenu.menu.remove();
        openMenu.button.setAttribute('aria-expanded', 'false');
        openMenu = null;
    }

    document.addEventListener('click', e => {
        if (openMenu && !openMenu.host.contains(e.target)) closeMenu();
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenu();
    });

    function buildMenu(host, button, article) {
        const card = readCard(article);
        const menu = document.createElement('div');
        menu.className = 'tco-menu';
        menu.setAttribute('role', 'menu');

        const learnedNames = Object.keys(loadLearned());
        const opName = learnedNames[0] || null;
        const ready = Boolean(opName && card.id && hasCredentials());

        const addItem = (label, onClick, enabled) => {
            const item = document.createElement('button');
            item.className = 'tco-item';
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.textContent = label;
            item.disabled = enabled === false;
            item.addEventListener('click', onClick);
            menu.appendChild(item);
            return item;
        };

        const notInterested = addItem(`Not interested in ${card.login || 'this channel'}`, async () => {
            notInterested.disabled = true;
            notInterested.textContent = 'Sending…';
            try {
                await replay(opName, card.id);
                if (HIDE_ON_SUCCESS) {
                    // Remove the outermost wrapper so the grid does not keep a gap.
                    const wrapper = article.closest('[data-target], .shelf-card__impression-wrapper') || article;
                    wrapper.remove();
                }
                closeMenu();
            } catch (err) {
                notInterested.textContent = `Failed: ${err.message}`;
            }
        }, ready);

        if (card.category) {
            addItem(`Open category: ${card.category.name}`, () => {
                location.href = `/directory/category/${card.category.slug}`;
            }, Boolean(card.category.slug));
        }

        addItem('Open channel in a new tab', () => {
            window.open(`https://www.twitch.tv/${card.login}`, '_blank', 'noopener');
            closeMenu();
        }, Boolean(card.login));

        if (!ready) {
            const note = document.createElement('div');
            note.className = 'tco-note';
            note.textContent = !opName
                ? 'Use the native "…" menu once on the home page to teach this script the request.'
                : !card.id
                    ? 'Could not read this channel ID from the page.'
                    : 'No Twitch credentials captured yet — reload the page.';
            menu.appendChild(note);
        }

        host.appendChild(menu);
        button.setAttribute('aria-expanded', 'true');
        openMenu = { host, button, menu };
    }

    function inject(article) {
        if (article.hasAttribute(MARK)) return;
        // Never double up where Twitch already renders its own button.
        if (article.querySelector('.feedback-card')) return;
        article.setAttribute(MARK, '');

        if (getComputedStyle(article).position === 'static') article.style.position = 'relative';

        const host = document.createElement('div');
        host.className = 'tco-host';

        const button = document.createElement('button');
        button.className = 'tco-button';
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'More options for this channel');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '20');
        icon.setAttribute('height', '20');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M10 5a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm0 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm2 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z');
        icon.appendChild(path);
        button.appendChild(icon);

        button.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const wasOpen = openMenu && openMenu.button === button;
            closeMenu();
            if (!wasOpen) buildMenu(host, button, article);
        });

        host.appendChild(button);
        article.appendChild(host);
    }

    function scan() {
        for (const article of document.querySelectorAll('article')) inject(article);
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
