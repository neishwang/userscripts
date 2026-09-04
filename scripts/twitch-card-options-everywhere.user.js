// ==UserScript==
// @name         Twitch — Card options button everywhere
// @namespace    https://github.com/neishwang/userscripts
// @version      3.0.0
// @description  Adds the "more options for this channel" button to every stream card, including directory pages where Twitch omits it.
// @author       neishwang
// @match        https://www.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---- Settings -----------------------------------------------------------
    // The single operation behind every item of the native feedback menu.
    const FEEDBACK_OP = 'AddRecommendationFeedback';
    // Replace the card with Twitch's "removed, undo?" notice on success.
    const SHOW_REMOVED_NOTICE = true;
    // How long the "removed, undo?" notice stays before the card goes for good.
    const NOTICE_SECONDS = 6;
    // -------------------------------------------------------------------------

    const GQL_URL = 'https://gql.twitch.tv/gql';
    const STORE_KEY = 'tco-learned-operations';

    /**
     * Known-good request, captured from the native menu on the home page.
     *
     * The sha256 hash is what makes this brittle: Twitch rotates persisted
     * query hashes on deploy. When that happens this default stops working,
     * and the recorder below silently replaces it the next time the user hits
     * the native menu — so the script repairs itself rather than staying dead.
     *
     * Note that "not interested in a channel" and "hide this game" are the same
     * operation, told apart only by input.itemType. Templates are therefore
     * keyed by operation *and* item type, or one would overwrite the other.
     */
    const DEFAULT_TEMPLATES = {
        [`${FEEDBACK_OP}::CHANNEL`]: {
            operationName: FEEDBACK_OP,
            hash: '8aae43e5b7fe68adc70608e35a4c9ec859d2cfde8962347487114703845d7887',
            query: null,
            variables: {
                input: {
                    category: 'NOT_INTERESTED',
                    itemID: '',
                    itemType: 'CHANNEL',
                    sourceItemPage: 'twitch_home',
                    sourceItemRequestID: '',
                    sourceItemTrackingID: '',
                },
            },
        },
    };

    const templateKey = (op, itemType) => `${op}::${itemType || 'UNKNOWN'}`;

    const SKIN_KEY = 'tco-native-button-markup';
    // Marks our clones so they are never mistaken for Twitch's own button,
    // either by the skip check or by the skin recorder.
    const CLONE_ATTR = 'data-tco-clone';

    /**
     * Fallback skin, captured from a home page shelf card.
     *
     * Twitch generates these class names with styled-components and rotates
     * them on deploy, so this copy is only a starting point: captureSkin()
     * replaces it with live markup whenever a real button is on screen.
     */
    const DEFAULT_SKIN =
        '<div class="Layout-sc-1xcs6mc-0 bAGvRo"><div class="Layout-sc-1xcs6mc-0 ehenIY">' +
        '<div class="InjectLayout-sc-1i43xsx-0 bohlnR"><div class="Layout-sc-1xcs6mc-0 hoISqi feedback-card">' +
        '<button class="ScCoreButton-sc-ocjdkq-0 foaenL ScButtonIcon-sc-9yap0r-0 cLnwrX" aria-expanded="false" ' +
        'aria-label="More options for this channel"><div class="ButtonIconFigure-sc-1emm8lf-0 dEsSMI">' +
        '<div class="ScSvgWrapper-sc-wkgzod-0 cnGLHG tw-svg"><svg width="24" height="24" viewBox="0 0 24 24" ' +
        'focusable="false" aria-hidden="true" role="presentation"><path d="M10 5a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm0 ' +
        '7a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm2 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"></path></svg></div></div></button>' +
        '</div></div></div></div>';

    const MENU_SKIN_KEY = 'tco-native-menu-markup';
    const MENU_STYLE_KEY = 'tco-native-menu-styles';

    /**
     * Styled-components injects its rules at runtime, only for components the
     * page has actually mounted. The followed directory never renders this
     * menu, so its panel classes resolve to nothing there and the clone comes
     * out unstyled — the button survives only because the VOD cards on that
     * page happen to use the same button classes.
     *
     * Copying the markup is therefore not enough: we snapshot the computed
     * styles too, and replay them inline where the classes mean nothing.
     * Layout properties we own (position, inset) are deliberately excluded.
     */
    const CAPTURED_PROPS = [
        'background-color', 'background-image', 'border-radius', 'box-shadow', 'box-sizing',
        'color', 'padding', 'margin', 'display', 'flex-direction', 'align-items',
        'justify-content', 'gap', 'width', 'min-width', 'height', 'min-height',
        'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing',
        'cursor', 'overflow', 'text-align', 'white-space', 'opacity', 'fill', 'border',
    ];

    function snapshotStyles(root) {
        return [root, ...root.querySelectorAll('*')].map(el => {
            const computed = getComputedStyle(el);
            const record = {};
            for (const prop of CAPTURED_PROPS) {
                const value = computed.getPropertyValue(prop);
                if (value) record[prop] = value;
            }
            return record;
        });
    }

    /**
     * Replay a snapshot. Indices are positional, so this must run before any
     * element is removed; a length mismatch means the stored styles belong to
     * different markup and are ignored rather than misapplied.
     */
    function applyCapturedStyles(root, styleKey) {
        let styles = null;
        try {
            styles = JSON.parse(localStorage.getItem(styleKey));
        } catch {
            styles = null;
        }
        if (!styles) return false;

        const nodes = [root, ...root.querySelectorAll('*')];
        if (nodes.length !== styles.length) return false;

        nodes.forEach((el, i) => {
            for (const [prop, value] of Object.entries(styles[i] || {})) {
                el.style.setProperty(prop, value);
            }
        });
        return true;
    }

    // Captured from an open native menu; same rotation caveat as DEFAULT_SKIN.
    const DEFAULT_MENU_SKIN = "<div class=\"Layout-sc-1xcs6mc-0 egfniL\" style=\"width: 20rem;\"><div class=\"Layout-sc-1xcs6mc-0 dQMmwU\"><div class=\"Layout-sc-1xcs6mc-0 KTokO\"><div class=\"Layout-sc-1xcs6mc-0 eDiLRr\"><button class=\"ScInteractableBase-sc-ofisyf-0 ScInteractableDefault-sc-ofisyf-1 cQzzvm iTnOTE tw-interactable\"><div class=\"Layout-sc-1xcs6mc-0 dmmLGq\"><div class=\"Layout-sc-1xcs6mc-0 drAA-dO\"><div class=\"Layout-sc-1xcs6mc-0 bPLZqY InjectLayout-sc-1i43xsx-0 tw-drop-down-menu-item-figure\"><div class=\"ScSvgWrapper-sc-wkgzod-0 cwspUC tw-svg\"><svg height=\"24\" viewbox=\"0 0 24 24\" width=\"24\"><path clip-rule=\"evenodd\" d=\"m2.293 3.707 18 18 1.414-1.414-3.683-3.683a7.98 7.98 0 0 0 .37-.404L22 12l-3.605-4.206A8 8 0 0 0 12.32 5h-.64a8 8 0 0 0-4.122 1.144l-3.85-3.851-1.415 1.414Zm6.738 3.91 2.45 2.45a2.003 2.003 0 0 1 2.451 2.451l2.678 2.678c.091-.094.18-.191.266-.291L19.366 12l-2.49-2.905A6 6 0 0 0 12.32 7h-.64a6 6 0 0 0-2.65.616Z\" fill-rule=\"evenodd\"></path><path d=\"M12.32 19c.74 0 1.469-.102 2.167-.299l-1.718-1.718a5.967 5.967 0 0 1-.449.017h-.64a6 6 0 0 1-4.556-2.095L4.634 12l1.455-1.697L4.67 8.885 2 12l3.605 4.206A8 8 0 0 0 11.68 19h.64Z\"></path></svg></div></div></div><div class=\"Layout-sc-1xcs6mc-0 dmulkQ\">Pas intéressé</div></div></button></div><div class=\"Layout-sc-1xcs6mc-0 ScDropDownMenuSeparator-sc-sll02v-0 UOirU giVkI\" role=\"separator\"></div><div class=\"Layout-sc-1xcs6mc-0 eDiLRr\"><button aria-label=\"Signaler la chaîne\" class=\"ScInteractableBase-sc-ofisyf-0 ScInteractableDefault-sc-ofisyf-1 cQzzvm iTnOTE tw-interactable\" data-a-target=\"report-button-report-button\"><div class=\"Layout-sc-1xcs6mc-0 dmmLGq\"><div class=\"Layout-sc-1xcs6mc-0 drAA-dO\"><div class=\"Layout-sc-1xcs6mc-0 bPLZqY InjectLayout-sc-1i43xsx-0 tw-drop-down-menu-item-figure\"><div class=\"ScSvgWrapper-sc-wkgzod-0 cwspUC tw-svg\"><svg height=\"24\" viewbox=\"0 0 24 24\" width=\"24\"><path d=\"M11 14a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm2-7h-2v4h2V7Z\"></path><path clip-rule=\"evenodd\" d=\"m12 22-3-3H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4l-3 3Zm-2.172-5L12 19.172 14.172 17H19V5H5v12h4.828Z\" fill-rule=\"evenodd\"></path></svg></div></div></div><div class=\"Layout-sc-1xcs6mc-0 dmulkQ\">Signaler la chaîne</div></div></button></div></div></div></div>";

    function loadMenuSkin() {
        try {
            return localStorage.getItem(MENU_SKIN_KEY) || DEFAULT_MENU_SKIN;
        } catch {
            return DEFAULT_MENU_SKIN;
        }
    }

    /**
     * Record the native dropdown while it is open. Twitch mounts it in a
     * ReactModal portal, so we look for it on the document rather than inside
     * the card, and take the inner panel without the portal scaffolding.
     */
    function captureMenuSkin() {
        const dialog = document.querySelector('[role="dialog"] .tw-drop-down-menu-item-figure');
        if (!dialog) return;

        const panel = dialog.closest('[role="dialog"]');
        // The panel sits under Popper's positioned wrapper; skip both layers so
        // we store only the menu itself and position it ourselves.
        const inner = panel && panel.querySelector('[style*="width"]');
        if (!inner) return;

        try {
            localStorage.setItem(MENU_SKIN_KEY, inner.outerHTML);
            localStorage.setItem(MENU_STYLE_KEY, JSON.stringify(snapshotStyles(inner)));
        } catch {
            // Quota or private mode; the bundled default still applies.
        }
    }

    const NOTICE_SKIN_KEY = 'tco-native-notice-markup';
    const NOTICE_STYLE_KEY = 'tco-native-notice-styles';
    const DEFAULT_NOTICE = "<div data-a-target=\"hidden-content-notice\" class=\"InjectLayout-sc-1i43xsx-0 kuuQvj\"><div class=\"Layout-sc-1xcs6mc-0 gMuNRc\"><div class=\"Layout-sc-1xcs6mc-0 gFsoQ\"><div class=\"Layout-sc-1xcs6mc-0 dCabsg\"><p class=\"CoreText-sc-1txzju1-0 gUQtFU\">Chaîne recommandée supprimée</p></div><div class=\"Layout-sc-1xcs6mc-0 jSseSd\"><button data-a-target=\"hidden-content-notice-undo\" class=\"ScCoreButton-sc-ocjdkq-0 FISKx\"><div class=\"ScCoreButtonLabel-sc-s7h2b7-0 bfhate\"><div data-a-target=\"tw-core-button-label-text\" class=\"Layout-sc-1xcs6mc-0 zdujK\">Annuler</div></div></button><a class=\"ScCoreButton-sc-ocjdkq-0 FISKx\" rel=\"noopener noreferrer\" href=\"/settings/content-preferences\" target=\"_blank\"><div class=\"ScCoreButtonLabel-sc-s7h2b7-0 bfhate\"><div class=\"Layout-sc-1xcs6mc-0 bPLZqY\"><div class=\"ScCoreButtonIcon-sc-ypak37-0 hdLxbr tw-core-button-icon\"><div class=\"ScSvgWrapper-sc-wkgzod-0 cnGLHG tw-svg\" data-a-selector=\"tw-core-button-icon\"><svg width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path fill-rule=\"evenodd\" d=\"M6 4h14v14h-2V7.5L5.5 20 4 18.5 16.5 6H6V4Z\" clip-rule=\"evenodd\"></path></svg></div></div></div><div data-a-target=\"tw-core-button-label-text\" class=\"Layout-sc-1xcs6mc-0 zdujK\">Paramètres</div></div></a></div></div><div class=\"Layout-sc-1xcs6mc-0 bENkKx\"><div class=\"ScProgressBarWrapper-sc-1aarjxm-0 kBXuek InjectLayout-sc-1i43xsx-0 kotCZg tw-progress-bar\" role=\"progressbar\" aria-valuenow=\"59\" aria-valuemin=\"0\" aria-valuemax=\"100\"><div data-a-target=\"tw-progress-bar-animation\" class=\"ScProgressBarFill-sc-1aarjxm-1 eOfcxg InjectLayout-sc-1i43xsx-0 cWCFeb\"></div></div></div></div></div>";

    function loadNoticeSkin() {
        try {
            return localStorage.getItem(NOTICE_SKIN_KEY) || DEFAULT_NOTICE;
        } catch {
            return DEFAULT_NOTICE;
        }
    }

    /**
     * The card Twitch swaps in after "not interested", with its undo button and
     * countdown bar. Same runtime-class problem as the menu, so we snapshot its
     * computed styles alongside the markup.
     */
    function captureNoticeSkin() {
        const notice = document.querySelector(`[data-a-target="hidden-content-notice"]:not([${CLONE_ATTR}])`);
        if (!notice) return;

        try {
            localStorage.setItem(NOTICE_SKIN_KEY, notice.outerHTML);
            localStorage.setItem(NOTICE_STYLE_KEY, JSON.stringify(snapshotStyles(notice)));
        } catch {
            // Quota or private mode; the bundled default still applies.
        }
    }

    function loadSkin() {
        try {
            return localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN;
        } catch {
            return DEFAULT_SKIN;
        }
    }

    /**
     * Copy the markup of a real Twitch button so our clones keep matching the
     * current build. We take the outermost wrapper, not just the <button>,
     * because the surrounding layout divs carry the spacing.
     */
    function captureSkin() {
        const native = document.querySelector(`.feedback-card:not([${CLONE_ATTR}])`);
        if (!native) return;

        // Walk out to the wrapper that sits as a sibling of the avatar block.
        let wrapper = native;
        for (let i = 0; i < 3 && wrapper.parentElement; i++) wrapper = wrapper.parentElement;

        const clean = wrapper.cloneNode(true);
        // React state attributes would be stale on a clone.
        clean.querySelectorAll('[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'false'));

        try {
            localStorage.setItem(SKIN_KEY, clean.outerHTML);
        } catch {
            // Quota or private mode; the bundled default still applies.
        }
    }

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
     * Anything we observe Twitch send takes precedence over the bundled
     * default, so a rotated hash heals itself without a script update.
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

    /**
     * Mirror the header set Twitch itself sends, Content-Type included.
     *
     * Forcing text/plain here used to look like a way to dodge a CORS
     * preflight, but Authorization and Client-Id already make the request
     * non-simple, so the preflight happens either way and the only effect was
     * sending a content type the endpoint never sees from the real client.
     */
    const FORWARDED_HEADERS = new Set([
        'client-id', 'authorization', 'client-integrity', 'client-session-id',
        'client-version', 'x-device-id', 'content-type', 'accept-language',
    ]);

    function rememberHeaders(headers) {
        if (!headers) return;

        // Headers may arrive as a Headers instance, a plain object, or an array.
        const out = {};
        const set = (key, value) => {
            if (FORWARDED_HEADERS.has(String(key).toLowerCase())) out[key] = value;
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
            if (op.operationName !== FEEDBACK_OP) continue;

            const persisted = op.extensions && op.extensions.persistedQuery;
            const itemType = op.variables && op.variables.input && op.variables.input.itemType;
            saveLearned(templateKey(op.operationName, itemType), {
                operationName: op.operationName,
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

    function collectChannels(value, depth, out) {
        if (!value || typeof value !== 'object' || depth > 3) return;

        if (Array.isArray(value)) {
            for (const item of value) collectChannels(item, depth + 1, out);
            return;
        }
        if (looksLikeChannel(value)) out.push({ id: value.id, login: value.login });
        for (const nested of Object.values(value)) collectChannels(nested, depth + 1, out);
    }

    /**
     * Resolve the numeric channel ID the mutation needs.
     *
     * Card components do not always carry their own channel: on the followed
     * directory the props hold one `users` array shared by every card on the
     * page. Walking up and taking the first match would therefore hand back
     * the same channel — the first one in that array — for all 30 cards, and
     * the feedback would silently land on the wrong streamer.
     *
     * So the login from the card's own link is the authority, and a candidate
     * is accepted only when its login matches it.
     */
    function findChannel(article, domLogin) {
        if (!domLogin) return null;
        const want = domLogin.toLowerCase();

        let fiber = getFiber(article);
        for (let depth = 0; fiber && depth < 45; depth++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            if (!props || typeof props !== 'object') continue;

            const found = [];
            collectChannels(props, 0, found);
            const match = found.find(c => c.login.toLowerCase() === want);
            if (match) return match;
        }
        return null;
    }

    function channelIdFor(article) {
        const link = article.querySelector('a[data-a-target="preview-card-channel-link"]');
        const href = link && link.getAttribute('href');
        // The avatar link can point at /login/videos, so only trust the first segment.
        const login = href ? href.split('/').filter(Boolean)[0] || null : null;

        const match = findChannel(article, login);
        return match ? match.id : null;
    }

    // =========================================================================
    // Sending feedback, and taking it back
    // =========================================================================

    const ID_KEY = /(^id$|itemid|channelid|targetid|userid|broadcasterid)/i;

    /**
     * Swap the channel identifier in a variables payload. Today that is
     * input.itemID, but we match on key name rather than on a fixed path so a
     * learned template with a reshuffled input still retargets correctly.
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

    /**
     * Undo takes the feedbackID that the add mutation hands back, not the
     * channel ID, so it gets its own template rather than going through
     * retarget() — whose key matching deliberately does not touch feedbackID.
     */
    const UNDO_TEMPLATE = {
        operationName: 'UndoRecommendationFeedback',
        hash: '90abc201c85f928551f65c125628ca440a6cc4540cdfd0041c254c18658bb980',
        variables: {
            input: {
                feedbackID: '',
                sourceItemPage: 'twitch_home',
                sourceItemRequestID: '',
                sourceItemTrackingID: '',
            },
        },
    };

    async function sendUndo(feedbackId) {
        const input = Object.assign({}, UNDO_TEMPLATE.variables.input, { feedbackID: feedbackId });
        return post({
            operationName: UNDO_TEMPLATE.operationName,
            variables: { input },
            extensions: { persistedQuery: { version: 1, sha256Hash: UNDO_TEMPLATE.hash } },
        });
    }

    function templateFor(itemType) {
        const key = templateKey(FEEDBACK_OP, itemType);
        return loadLearned()[key] || DEFAULT_TEMPLATES[key] || null;
    }

    async function replay(itemType, channelId) {
        const template = templateFor(itemType);
        if (!template) throw new Error('no request template');
        if (!hasCredentials()) throw new Error('no credentials captured');

        const payload = {
            operationName: template.operationName,
            variables: retarget(template.variables, channelId),
        };
        if (template.hash) payload.extensions = { persistedQuery: { version: 1, sha256Hash: template.hash } };
        else if (template.query) payload.query = template.query;

        return post(payload);
    }

    async function post(payload) {
        if (!hasCredentials()) throw new Error('no credentials captured');

        const res = await nativeFetch(GQL_URL, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, capturedHeaders),
            body: JSON.stringify(payload),
            // No credentials: gql.twitch.tv answers with Access-Control-Allow-Origin: *,
            // and a wildcard is rejected outright for credentialed requests, so
            // 'include' got the call blocked before it ever left the browser.
            // Auth travels in the Authorization header, exactly as Twitch sends it.
            credentials: 'omit',
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
        /* Both the button and the menu are Twitch's own markup carrying
           Twitch's own classes, so they need no styling from us. All we add is
           the layer that stands in for the ReactModal portal. */
        /* Placement must not depend on Twitch's wrapper class. That class only
           carries its order and auto margin on pages where Twitch has actually
           mounted the component; anywhere else the clone falls back to order 0
           and jumps ahead of siblings that carry a positive order — which is
           how it ended up left of the avatar instead of at the row's end. */
        .tco-host { position: relative; order: 999; margin-left: auto; }
        .tco-layer { position: fixed; z-index: 9000; }

        /* Hover is a pseudo-class, so no computed-style snapshot can carry it. */
        .tco-layer button:hover {
            background-color: var(--color-background-interactable-hover, rgba(255, 255, 255, .12));
        }

        /* Used until a native menu has been seen and snapshotted. Twitch's own
           custom properties keep it consistent with the active theme. */
        .tco-fallback > * {
            width: 20rem; padding: .5rem 0; border-radius: .6rem;
            background-color: var(--color-background-base, #18181b);
            box-shadow: 0 4px 8px rgba(0, 0, 0, .5);
            color: var(--color-text-base, #efeff1);
        }
        .tco-fallback button {
            display: block; width: 100%; padding: .5rem 1rem;
            border: none; background: none; color: inherit;
            font: inherit; text-align: left; cursor: pointer;
        }
        /* The row is the div inside the button, not the button: Twitch puts the
           icon column and the label side by side one level down, so flexing the
           button alone leaves them stacked on two lines. */
        .tco-fallback button > div {
            display: flex; align-items: center; gap: .75rem; width: 100%;
        }
        .tco-fallback .tw-drop-down-menu-item-figure,
        .tco-fallback .tw-svg { display: flex; flex: none; }
        .tco-fallback svg { width: 20px; height: 20px; }

        .tco-notice { position: absolute; inset: 0; z-index: 5; }
        .tco-fallback-notice > * {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: .75rem; width: 100%; height: 100%; padding: 1rem; text-align: center;
            background-color: var(--color-background-base, #18181b);
            color: var(--color-text-base, #efeff1);
        }
        .tco-fallback-notice button,
        .tco-fallback-notice a {
            padding: .4rem .8rem; border: none; border-radius: .4rem;
            background-color: var(--color-background-button-secondary-default, rgba(255, 255, 255, .15));
            color: inherit; font: inherit; text-decoration: none; cursor: pointer;
        }
        .tco-fallback-notice [role="progressbar"] {
            width: 80%; height: 4px; border-radius: 2px; overflow: hidden;
            background-color: var(--color-background-button-secondary-default, rgba(255, 255, 255, .15));
        }
        .tco-fallback-notice [role="progressbar"] > * {
            height: 100%; background-color: var(--color-fill-brand, #9147ff);
        }
        .tco-fallback [role="separator"] {
            height: 1px; margin: .5rem 0;
            background-color: var(--color-border-base, rgba(255, 255, 255, .16));
        }
        .tco-fallback svg { fill: currentColor; flex: none; }
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
        // The menu lives on <body>, not inside the card, so a click inside it
        // is not "outside" even though the host does not contain it.
        if (!openMenu) return;
        if (openMenu.host.contains(e.target) || openMenu.menu.contains(e.target)) return;
        closeMenu();
    }, true);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenu();
    });

    // A fixed layer would drift away from its button once the page moves.
    addEventListener('scroll', () => { if (openMenu) closeMenu(); }, true);
    addEventListener('resize', () => { if (openMenu) closeMenu(); });

    const REPORT_TARGET = '[data-a-target="report-button-report-button"]';
    const UNDO_TARGET = '[data-a-target="hidden-content-notice-undo"]';

    /**
     * Stand in for the card Twitch replaces after "not interested".
     *
     * The real card is only hidden, never replaced: React still owns it, so
     * undo restores a live card rather than the dead markup an innerHTML swap
     * would leave behind.
     */
    function showNotice(wrapper, feedbackId) {
        if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';

        const hidden = [...wrapper.children];
        hidden.forEach(el => { el.style.visibility = 'hidden'; });

        const overlay = document.createElement('div');
        overlay.className = 'tco-notice';
        overlay.setAttribute(CLONE_ATTR, '');
        overlay.innerHTML = loadNoticeSkin();

        const panel = overlay.firstElementChild;
        if (!panel || !applyCapturedStyles(panel, NOTICE_STYLE_KEY)) overlay.classList.add('tco-fallback-notice');
        overlay.querySelectorAll(`[data-a-target="hidden-content-notice"]`).forEach(el => el.setAttribute(CLONE_ATTR, ''));

        let timer = null;
        const dismiss = () => { clearTimeout(timer); overlay.remove(); wrapper.remove(); };
        const restore = () => {
            clearTimeout(timer);
            overlay.remove();
            hidden.forEach(el => { el.style.visibility = ''; });
        };

        const undo = overlay.querySelector(UNDO_TARGET);
        if (undo && feedbackId) {
            undo.addEventListener('click', async e => {
                e.preventDefault();
                e.stopPropagation();
                undo.disabled = true;
                try {
                    await sendUndo(feedbackId);
                    restore();
                } catch (err) {
                    undo.disabled = false;
                    undo.title = `Undo failed: ${err.message}`;
                }
            });
        } else if (undo) {
            // No feedback id came back, so undo could not be honoured.
            undo.remove();
        }

        // Drive the countdown bar Twitch shows while undo stays available.
        const bar = overlay.querySelector('[role="progressbar"]');
        const fill = bar && bar.firstElementChild;
        if (fill) {
            fill.style.transition = `width ${NOTICE_SECONDS}s linear`;
            fill.style.width = '100%';
            requestAnimationFrame(() => { fill.style.width = '0%'; });
        }

        timer = setTimeout(dismiss, NOTICE_SECONDS * 1000);
        wrapper.appendChild(overlay);
    }

    /**
     * Twitch renders this menu through a ReactModal portal placed on <body>
     * and positions it with Popper. We reuse its markup but not its plumbing:
     * a fixed-position layer of our own, aligned bottom-end against the button,
     * reproduces the same result without pulling in Popper.
     */
    function positionMenu(layer, button) {
        const b = button.getBoundingClientRect();
        const m = layer.getBoundingClientRect();

        // bottom-end: top edge below the button, right edges aligned.
        let left = b.right - m.width;
        let top = b.bottom + 4;

        // Keep it on screen near the viewport edges.
        left = Math.max(8, Math.min(left, innerWidth - m.width - 8));
        if (top + m.height > innerHeight - 8) top = Math.max(8, b.top - m.height - 4);

        layer.style.left = `${Math.round(left)}px`;
        layer.style.top = `${Math.round(top)}px`;
    }

    function buildMenu(host, button, article) {
        const channelId = channelIdFor(article);

        const layer = document.createElement('div');
        layer.className = 'tco-layer';
        layer.innerHTML = loadMenuSkin();

        // Must run while the markup is still intact: the snapshot is indexed
        // positionally, so removing the report item first would shift it.
        const panel = layer.firstElementChild;
        if (!panel || !applyCapturedStyles(panel)) layer.classList.add('tco-fallback');

        const items = [...layer.querySelectorAll('button')];
        const feedbackItem = items.find(i => !i.matches(REPORT_TARGET));
        const reportItem = items.find(i => i.matches(REPORT_TARGET));

        // "Signaler" opens a React modal flow we cannot invoke from outside,
        // so drop it along with the separator rather than showing a dead item.
        if (reportItem) {
            const row = reportItem.closest('div');
            const sep = row && row.previousElementSibling;
            if (sep && sep.getAttribute('role') === 'separator') sep.remove();
            if (row) row.remove();
        }

        if (!feedbackItem) return;

        // The label is the only leaf div carrying text; the sibling branches
        // hold the icon. Matching on shape avoids depending on a hashed class.
        const labelEl = [...feedbackItem.querySelectorAll('div')]
            .find(d => d.children.length === 0 && d.textContent.trim());
        const setLabel = text => { if (labelEl) labelEl.textContent = text; };

        const ready = Boolean(templateFor('CHANNEL') && channelId && hasCredentials());
        if (!ready) {
            feedbackItem.disabled = true;
            feedbackItem.style.opacity = '.5';
            setLabel(!channelId ? 'Channel ID unavailable' : 'Waiting for credentials');
        }

        feedbackItem.addEventListener('click', async e => {
            e.preventDefault();
            e.stopPropagation();
            if (!ready) return;

            feedbackItem.disabled = true;
            try {
                const body = await replay('CHANNEL', channelId);
                const feedbackId = body?.data?.addRecommendationFeedback?.recommendationFeedback?.id || null;
                closeMenu();
                if (SHOW_REMOVED_NOTICE) {
                    const wrapper = article.closest('[data-target], .shelf-card__impression-wrapper') || article;
                    showNotice(wrapper, feedbackId);
                }
            } catch (err) {
                setLabel(`Failed: ${err.message}`);
                feedbackItem.disabled = false;
            }
        });

        document.body.appendChild(layer);
        positionMenu(layer, button);
        button.setAttribute('aria-expanded', 'true');
        openMenu = { host, button, menu: layer };
    }

    /**
     * The native button is the last child of the row that holds the title
     * block and the avatar, not an overlay on the thumbnail. The avatar link
     * carries a stable data-test-selector, so we locate the row through it
     * rather than through a generated class name.
     */
    function findMetaRow(article) {
        const avatar = article.querySelector('[data-test-selector="preview-card-avatar"]');
        const row = avatar && avatar.parentElement && avatar.parentElement.parentElement;
        return row && row.contains(article.querySelector('[data-test-selector="TitleAndChannel"]')) ? row : null;
    }

    /**
     * Twitch ships two different menus on these cards: the recommendation
     * feedback one on live channels, and a report-only one on VOD cards. Both
     * render the same three-dot affordance, so we treat either as "already has
     * a button" and stay out of the way rather than adding a second one.
     */
    function hasNativeButton(article) {
        return Boolean(
            article.querySelector(`.feedback-card:not([${CLONE_ATTR}])`) ||
            article.querySelector(`[data-a-target="report-button-more-button"]:not([${CLONE_ATTR}])`)
        );
    }

    function ourButton(article) {
        return article.querySelector(`.tco-host[${CLONE_ATTR}]`);
    }

    /**
     * Decide fresh on every pass instead of marking a card as handled once.
     *
     * At document-start we run before React has mounted the native button, so
     * a card can legitimately look button-less and grow one moments later. A
     * sticky marker froze that first, wrong answer and left two buttons side
     * by side; re-deciding lets us withdraw ours as soon as Twitch's appears.
     */
    function reconcile(article) {
        const ours = ourButton(article);
        if (hasNativeButton(article)) {
            if (ours) {
                if (openMenu && ours.contains(openMenu.button)) closeMenu();
                ours.remove();
            }
            return;
        }
        if (!ours) inject(article);
    }

    function inject(article) {
        const row = findMetaRow(article);
        if (!row) return;

        // Insert the skin's own root as a direct child of the row: wrapping it
        // in an extra div would make it a grandchild and break the row's flex
        // layout, since Twitch styles that wrapper as a flex item.
        const stage = document.createElement('div');
        stage.innerHTML = loadSkin();
        const host = stage.firstElementChild;
        if (!host) return;
        host.classList.add('tco-host');
        host.setAttribute(CLONE_ATTR, '');
        host.querySelectorAll('.feedback-card').forEach(el => el.setAttribute(CLONE_ATTR, ''));

        const button = host.querySelector('button');
        if (!button) return;
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');

        button.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const wasOpen = openMenu && openMenu.button === button;
            closeMenu();
            if (!wasOpen) buildMenu(host, button, article);
        });

        row.appendChild(host);
    }

    function scan() {
        captureSkin();
        captureMenuSkin();
        captureNoticeSkin();
        for (const article of document.querySelectorAll('article')) reconcile(article);
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
