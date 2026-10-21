/**
 * Oracio — gestionnaire de consentement aux cookies.
 *
 * Principes : rien n'est chargé avant un choix explicite ; refuser est aussi simple qu'accepter ;
 * chaque finalité se règle séparément ; le choix est modifiable à tout moment ([data-o-consent-open]) ;
 * un retrait supprime les cookies concernés et recharge la page pour arrêter les scripts déjà lancés.
 *
 * API : window.OracioConsent.{ has(cat), open(), grant(cat), onChange(fn) }
 */
(() => {
	const config = window.OracioConsentConfig;
	if (!config) return;

	const COOKIE = 'oracio_consent';
	const optional = Object.keys(config.categories).filter((c) => !config.categories[c].required);
	const listeners = [];
	let state = read();
	let loaded = {};

	/* ---------- Stockage du choix ---------- */
	function read() {
		const match = document.cookie.match(/(?:^|;\s*)oracio_consent=([^;]+)/);
		if (!match) return null;
		try {
			const value = JSON.parse(decodeURIComponent(match[1]));
			if (value.v !== config.version) return null;
			return value;
		} catch (e) {
			return null;
		}
	}

	function uuid() {
		if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
		const b = crypto.getRandomValues(new Uint8Array(16));
		b[6] = (b[6] & 0x0f) | 0x40;
		b[8] = (b[8] & 0x3f) | 0x80;
		const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
		return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
	}

	function save(choices, action) {
		const previous = state ? { ...state.c } : {};
		state = { v: config.version, id: (state && state.id) || uuid(), t: Math.floor(Date.now() / 1000), c: choices };
		const secure = location.protocol === 'https:' ? '; Secure' : '';
		document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(state))}; Max-Age=${config.months * 30 * 86400}; Path=/; SameSite=Lax${secure}`;
		log(action);
		const withdrawn = optional.filter((c) => previous[c] && !choices[c]);
		if (withdrawn.length) {
			withdrawn.forEach(clearCookies);
			// Les scripts déjà exécutés ne peuvent pas être déchargés : rechargement pour repartir sans eux.
			location.reload();
			return;
		}
		apply();
		listeners.forEach((fn) => fn({ ...choices }));
	}

	function log(action) {
		try {
			fetch(config.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'omit',
				keepalive: true,
				body: JSON.stringify({ id: state.id, action, choices: state.c, version: config.version }),
			});
		} catch (e) {
			/* La preuve n'est pas bloquante pour la navigation. */
		}
	}

	function has(category) {
		if (config.categories[category] && config.categories[category].required) return true;
		return !!(state && state.c && state.c[category]);
	}

	/* ---------- Suppression des cookies d'une finalité retirée ---------- */
	function clearCookies(category) {
		const names = [];
		config.services
			.filter((s) => s.category === category)
			.forEach((s) => s.cookies.forEach((c) => c[0].split(',').forEach((n) => names.push(n.trim()))));
		const existing = document.cookie.split(';').map((c) => c.split('=')[0].trim());
		const host = location.hostname;
		const parts = host.split('.');
		const domains = ['', host, `.${host}`, parts.length > 1 ? `.${parts.slice(-2).join('.')}` : ''];
		existing.forEach((cookie) => {
			const match = names.some((n) => (n.endsWith('*') ? cookie.startsWith(n.slice(0, -1)) : cookie === n));
			if (!match) return;
			domains.forEach((d) => {
				document.cookie = `${cookie}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ''}`;
			});
		});
	}

	/* ---------- Chargement des services autorisés ---------- */
	function script(src, attrs = {}) {
		const s = document.createElement('script');
		s.src = src;
		s.async = true;
		Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
		document.head.appendChild(s);
		return s;
	}

	function gtag() {
		window.dataLayer = window.dataLayer || [];
		window.dataLayer.push(arguments); // eslint-disable-line prefer-rest-params
	}

	function consentModeState() {
		const stats = has('statistiques') ? 'granted' : 'denied';
		const ads = has('marketing') ? 'granted' : 'denied';
		return {
			analytics_storage: stats,
			ad_storage: ads,
			ad_user_data: ads,
			ad_personalization: ads,
			functionality_storage: 'denied',
			personalization_storage: 'denied',
			security_storage: 'granted',
		};
	}

	function apply() {
		const load = config.load || {};
		const google = (load.gtm || load.ga4) && (has('statistiques') || has('marketing'));
		if (google) {
			window.dataLayer = window.dataLayer || [];
			if (!loaded.consentDefault) {
				gtag('consent', 'default', {
					analytics_storage: 'denied',
					ad_storage: 'denied',
					ad_user_data: 'denied',
					ad_personalization: 'denied',
					functionality_storage: 'denied',
					personalization_storage: 'denied',
					security_storage: 'granted',
				});
				gtag('set', 'ads_data_redaction', true);
				loaded.consentDefault = true;
			}
			gtag('consent', 'update', consentModeState());
			if (load.ga4 && has('statistiques') && !loaded.ga4) {
				gtag('js', new Date());
				gtag('config', load.ga4, { cookie_expires: 34128000 });
				script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(load.ga4)}`);
				loaded.ga4 = true;
			}
			if (load.gtm && !loaded.gtm) {
				window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
				script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(load.gtm)}`);
				loaded.gtm = true;
			}
		}
		if (load.brevo && has('marketing') && !loaded.brevo) {
			window.Brevo = window.Brevo || [];
			const init = { client_key: load.brevo };
			if (!load.brevoPush) init.push = { enabled: false };
			window.Brevo.push(['init', init]);
			script('https://cdn.brevo.com/js/sdk-loader.js');
			loaded.brevo = true;
		}
		if (has('externes')) revealSlots();
	}

	/* ---------- Contenus externes : emplacements [data-o-consent-slot] ---------- */
	function revealSlots() {
		document.querySelectorAll('[data-o-consent-slot]').forEach((slot) => {
			const tpl = slot.querySelector('template');
			if (!tpl) return;
			const fragment = tpl.content.cloneNode(true);
			const wrapper = document.createElement('div');
			wrapper.className = slot.dataset.oConsentClass || '';
			wrapper.appendChild(fragment);
			slot.replaceWith(wrapper);
			// Les <script> clonés depuis un <template> ne s'exécutent pas : on les recrée.
			wrapper.querySelectorAll('script').forEach((old) => {
				const s = document.createElement('script');
				[...old.attributes].forEach((a) => s.setAttribute(a.name, a.value));
				s.textContent = old.textContent;
				old.replaceWith(s);
			});
		});
	}

	function grant(category) {
		const choices = Object.fromEntries(optional.map((c) => [c, has(c) ? 1 : 0]));
		choices[category] = 1;
		save(choices, 'grant');
	}

	/* ---------- Calendly : fenêtre intégrée si les contenus externes sont acceptés ---------- */
	let calendlyLoading = null;
	function loadCalendly() {
		if (window.Calendly) return Promise.resolve();
		if (calendlyLoading) return calendlyLoading;
		const css = document.createElement('link');
		css.rel = 'stylesheet';
		css.href = 'https://assets.calendly.com/assets/external/widget.css';
		document.head.appendChild(css);
		calendlyLoading = new Promise((resolve, reject) => {
			const s = script('https://assets.calendly.com/assets/external/widget.js');
			s.onload = resolve;
			s.onerror = reject;
		});
		return calendlyLoading;
	}

	document.addEventListener('click', (event) => {
		const link = event.target.closest('[data-o-booking], .is-calendly a, a.is-calendly');
		if (!link || !has('externes') || event.metaKey || event.ctrlKey || event.shiftKey) return;
		event.preventDefault();
		loadCalendly()
			.then(() => window.Calendly.initPopupWidget({ url: `${link.href.split('?')[0]}?hide_gdpr_banner=1&primary_color=393667` }))
			.catch(() => window.open(link.href, '_blank', 'noopener'));
	});

	/* ---------- Interface : bannière et préférences ---------- */
	const t = {
		title: 'Cookies et confidentialité',
		text:
			'Nous utilisons des cookies nécessaires au fonctionnement du site. Avec votre accord, nous utilisons aussi des cookies de mesure d’audience et de marketing, et nous affichons des services de tiers (agenda Calendly, actualités Webwin). Vous pouvez tout accepter, tout refuser ou choisir par finalité, et changer d’avis à tout moment avec le lien « Gérer mes cookies » en bas de chaque page.',
		policy: 'Politique de confidentialité et cookies',
		accept: 'Tout accepter',
		reject: 'Tout refuser',
		customize: 'Personnaliser',
		save: 'Enregistrer mes choix',
		prefsTitle: 'Vos préférences de cookies',
		prefsIntro: 'Activez uniquement les finalités que vous acceptez. Les cookies nécessaires ne peuvent pas être désactivés. Votre choix est conservé ' + config.months + ' mois.',
		always: 'Toujours actifs',
		details: 'Services et cookies',
		close: 'Fermer',
	};

	let banner = null;
	let dialog = null;

	function el(tag, attrs = {}, children = []) {
		const node = document.createElement(tag);
		Object.entries(attrs).forEach(([k, v]) => {
			if (k === 'text') node.textContent = v;
			else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
			else node.setAttribute(k, v);
		});
		children.forEach((c) => c && node.appendChild(c));
		return node;
	}

	function allChoices(value) {
		return Object.fromEntries(optional.map((c) => [c, value]));
	}

	function hideBanner() {
		const node = banner || document.querySelector('[data-oc-banner]');
		if (node) node.hidden = true;
	}

	function showBanner() {
		if (banner) {
			banner.hidden = false;
			return;
		}
		// Bannière rendue par le serveur (wp_body_open) ; création en secours si le thème ne l'appelle pas.
		banner = document.querySelector('[data-oc-banner]');
		if (!banner) {
			banner = el('section', { class: 'oc-banner', 'aria-labelledby': 'oc-banner-title', 'data-oc-banner': '' }, [
				el('div', { class: 'oc-banner__inner' }, [
					el('h2', { class: 'oc-banner__title', id: 'oc-banner-title', text: t.title }),
					el('p', { class: 'oc-banner__text', text: t.text }),
					el('p', { class: 'oc-banner__policy' }, [el('a', { href: config.policyUrl, text: t.policy })]),
					el('div', { class: 'oc-actions' }, [
						el('button', { type: 'button', class: 'oc-btn', 'data-oc-action': 'reject', text: t.reject }),
						el('button', { type: 'button', class: 'oc-btn', 'data-oc-action': 'customize', text: t.customize }),
						el('button', { type: 'button', class: 'oc-btn', 'data-oc-action': 'accept', text: t.accept }),
					]),
				]),
			]);
			document.body.prepend(banner);
		}
		banner.hidden = false;
		banner.addEventListener('click', (event) => {
			const action = event.target.closest('[data-oc-action]');
			if (!action) return;
			const kind = action.dataset.ocAction;
			if (kind === 'reject') {
				save(allChoices(0), 'reject_all');
				hideBanner();
			} else if (kind === 'accept') {
				save(allChoices(1), 'accept_all');
				hideBanner();
			} else open();
		});
	}

	function buildDialog() {
		const form = el('form', { method: 'dialog', class: 'oc-dialog__form' });
		const list = el('div', { class: 'oc-cats' });
		Object.entries(config.categories).forEach(([id, cat]) => {
			const services = config.services.filter((s) => s.category === id);
			if (!cat.required && !services.length) return;
			const inputId = `oc-cat-${id}`;
			const control = cat.required
				? el('span', { class: 'oc-always', text: t.always })
				: el('input', { type: 'checkbox', role: 'switch', id: inputId, name: id, class: 'oc-switch', 'aria-describedby': `${inputId}-desc` });
			const serviceList = el(
				'ul',
				{ class: 'oc-services' },
				services.map((s) =>
					el('li', {}, [
						el('strong', { text: s.name }),
						el('span', { text: ` — ${s.provider}. ${s.purpose} ` }),
						el('span', { class: 'oc-cookie-names', text: s.cookies.map((c) => `${c[0]} (${c[1]})`).join(' ; ') }),
					])
				)
			);
			list.appendChild(
				el('div', { class: 'oc-cat' }, [
					el('div', { class: 'oc-cat__head' }, [
						cat.required ? el('h3', { class: 'oc-cat__title', text: cat.label }) : el('label', { class: 'oc-cat__title', for: inputId, text: cat.label }),
						control,
					]),
					el('p', { class: 'oc-cat__desc', id: `${inputId}-desc`, text: cat.description }),
					services.length ? el('details', { class: 'oc-cat__details' }, [el('summary', { text: t.details }), serviceList]) : null,
				])
			);
		});
		form.appendChild(el('h2', { class: 'oc-dialog__title', id: 'oc-dialog-title', text: t.prefsTitle }));
		form.appendChild(el('p', { class: 'oc-dialog__intro', text: t.prefsIntro }));
		form.appendChild(list);
		form.appendChild(
			el('div', { class: 'oc-actions oc-actions--dialog' }, [
				el('button', { type: 'button', class: 'oc-btn', text: t.reject, onclick: () => { save(allChoices(0), 'reject_all'); close(); } }),
				el('button', { type: 'button', class: 'oc-btn', text: t.accept, onclick: () => { save(allChoices(1), 'accept_all'); close(); } }),
				el('button', {
					type: 'button',
					class: 'oc-btn oc-btn--primary',
					text: t.save,
					onclick: () => {
						const choices = Object.fromEntries(optional.map((c) => [c, form.elements[c] && form.elements[c].checked ? 1 : 0]));
						save(choices, 'custom');
						close();
					},
				}),
			])
		);
		const closeBtn = el('button', { type: 'button', class: 'oc-dialog__close', 'aria-label': t.close, onclick: () => close() }, []);
		closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
		dialog = el('dialog', { class: 'oc-dialog', 'aria-labelledby': 'oc-dialog-title' }, [closeBtn, form]);
		document.body.appendChild(dialog);
	}

	function open() {
		if (!dialog) buildDialog();
		optional.forEach((c) => {
			const input = dialog.querySelector(`[name="${c}"]`);
			if (input) input.checked = has(c);
		});
		dialog.showModal();
	}

	function close() {
		if (dialog && dialog.open) dialog.close();
		if (state) hideBanner();
	}

	document.addEventListener('click', (event) => {
		const opener = event.target.closest('[data-o-consent-open]');
		if (opener) {
			event.preventDefault();
			open();
		}
		const granter = event.target.closest('[data-o-consent-grant]');
		if (granter) {
			event.preventDefault();
			grant(granter.dataset.oConsentGrant);
		}
	});

	window.OracioConsent = { has, open, grant, onChange: (fn) => listeners.push(fn) };

	const start = () => {
		// Un script retiré peut réécrire ses cookies pendant le rechargement : on les supprime à chaque visite
		// tant que la finalité n'est pas acceptée.
		optional.filter((c) => !has(c)).forEach(clearCookies);
		if (state) apply();
		else showBanner();
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
	else start();
})();
