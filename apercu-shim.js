/**
 * Aperçu statique du site Oracio (GitHub Pages) : simule l'API WordPress dans le navigateur
 * pour que les formulaires, le parcours de rendez-vous et le bandeau cookies fonctionnent
 * comme sur le site final. RIEN n'est envoyé : aucune demande ne quitte le navigateur.
 * Routes simulées (contrats de includes/booking-availability.php et forms.php) : form-token, booking/form,
 * booking/availability, consent, forms/{contact,callback,booking}. Les dates de l'assistant sont celles du jour
 * de la visite. La recherche (page 404) est faite dans le navigateur sur l'index exporté (recherche/index.json).
 */
(() => {
	const prefix = (window.ORACIO_APERCU && window.ORACIO_APERCU.prefix) || '';
	const realFetch = window.fetch.bind(window);
	const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
	const pad = (n) => String(n).padStart(2, '0');
	const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const parse = (s) => {
		const [y, m, d] = s.split('-').map(Number);
		return new Date(y, m - 1, d);
	};

	// Jours fériés légaux belges (fixes et liés à Pâques).
	const easter = (y) => {
		const a = y % 19;
		const b = Math.floor(y / 100);
		const c = y % 100;
		const d = Math.floor(b / 4);
		const e = b % 4;
		const f = Math.floor((b + 8) / 25);
		const g = Math.floor((b - f + 1) / 3);
		const h = (19 * a + b - d - g + 15) % 30;
		const i = Math.floor(c / 4);
		const k = c % 4;
		const l = (32 + 2 * e + 2 * i - h - k) % 7;
		const m = Math.floor((a + 11 * h + 22 * l) / 451);
		const month = Math.floor((h + l - 7 * m + 114) / 31);
		const day = ((h + l - 7 * m + 114) % 31) + 1;
		return new Date(y, month - 1, day);
	};
	const holidays = (y) => {
		const e = easter(y);
		const plus = (n) => iso(new Date(e.getFullYear(), e.getMonth(), e.getDate() + n));
		return {
			[`${y}-01-01`]: 'Nouvel An',
			[plus(1)]: 'Lundi de Pâques',
			[`${y}-05-01`]: 'Fête du Travail',
			[plus(39)]: 'Ascension',
			[plus(50)]: 'Lundi de Pentecôte',
			[`${y}-07-21`]: 'Fête nationale',
			[`${y}-08-15`]: 'Assomption',
			[`${y}-11-01`]: 'Toussaint',
			[`${y}-11-11`]: 'Armistice',
			[`${y}-12-25`]: 'Noël',
		};
	};
	const slots = [];
	for (let t = 9 * 60; t + 30 <= 17 * 60; t += 30) slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);

	const ISO = /^\d{4}-\d{2}-\d{2}$/;
	const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

	// Fenêtre de réservation calculée le jour de la visite (et non le jour de l'export) : premier jour ouvré suivant,
	// 60 jours au plus (réglages de la préproduction).
	const bookingWindow = () => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		let min = addDays(today, 1);
		while ([0, 6].includes(min.getDay()) || holidays(min.getFullYear())[iso(min)]) min = addDays(min, 1);
		return { today, min, max: addDays(today, 60) };
	};

	// Contrat §1 (includes/booking-availability.php) : intervalle ramené à [aujourd'hui, date maximale], 62 jours au
	// plus, mêmes statuts et mêmes motifs que le serveur.
	const availability = (url) => {
		const { today, min, max } = bookingWindow();
		let from = ISO.test(url.searchParams.get('from') || '') ? parse(url.searchParams.get('from')) : today;
		let to = ISO.test(url.searchParams.get('to') || '') ? parse(url.searchParams.get('to')) : addDays(today, 34);
		if (from < today) from = today;
		if (to > max) to = max;
		const days = [];
		for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) {
			const key = iso(d);
			const holiday = holidays(d.getFullYear())[key];
			let status = 'open';
			let reason = null;
			if (d < min) {
				status = 'out_of_range';
				reason = 'Délai trop court';
			} else if ([0, 6].includes(d.getDay())) {
				status = 'closed';
				reason = 'Cabinet fermé';
			} else if (holiday) {
				status = 'holiday';
				reason = holiday;
			}
			const day = { date: key, status, reason };
			if (status === 'open') day.slots = slots.map((time) => ({ time, available: true }));
			days.push(day);
		}
		return { timezone: 'Europe/Brussels', duration: 30, slotMinutes: 30, min: iso(min), max: iso(max), autoConfirm: false, days };
	};

	// Configuration de l'assistant (JSON rendu par le serveur) : dates du jour de la visite.
	const freshConfig = (text) => {
		try {
			const cfg = JSON.parse(text);
			const { today, min, max } = bookingWindow();
			Object.assign(cfg, { today: iso(today), min: iso(min), max: iso(max) });
			return JSON.stringify(cfg).replace(/</g, '\\u003c');
		} catch (e) {
			return text;
		}
	};
	const freshForm = (html) => html.replace(/(<script[^>]*data-o-rdv-config[^>]*>)([\s\S]*?)(<\/script>)/g, (m, open, body, close) => open + freshConfig(body) + close);
	// Assistant de la page Contact : configuration corrigée avant l'exécution de booking.js (script différé).
	const fixInline = () => document.querySelectorAll('script[data-o-rdv-config]').forEach((s) => (s.textContent = freshConfig(s.textContent)));
	if (document.readyState === 'loading') {
		document.addEventListener('readystatechange', function once() {
			if (document.readyState === 'loading') return;
			document.removeEventListener('readystatechange', once);
			fixInline();
		});
	} else fixInline();

	// Choix de l'assistant : titre de la carte (« Au bureau de Zaventem ») et détail (adresse), comme le récapitulatif
	// du serveur (oracio_booking_summary).
	const choiceOf = (name, value) => {
		const input = [...document.querySelectorAll(`form[data-o-form="booking"] [name="${name}"]`)].find((el) => el.value === value && (el.checked || el.tagName === 'OPTION'));
		if (!input) return { title: value, meta: '' };
		const label = input.closest('label') || (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`));
		if (!label) return { title: value, meta: '' };
		const title = label.querySelector('.o-choice__title');
		const meta = label.querySelector('.o-choice__meta');
		return { title: (title ? title.textContent : label.textContent.split('\n')[0]).trim() || value, meta: meta ? meta.textContent.trim() : '' };
	};
	const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
	const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
	const dateLabel = (d) => `${DAYS[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	const paramsOf = (body) => {
		if (body instanceof URLSearchParams) return body;
		if (typeof body === 'string') return new URLSearchParams(body);
		if (typeof FormData === 'function' && body instanceof FormData) return new URLSearchParams(body);
		return new URLSearchParams();
	};
	const MESSAGE = 'Aperçu de démonstration : aucune demande n’a été envoyée. Sur le site en ligne, le cabinet reçoit votre demande par e-mail.';

	window.fetch = async (input, init = {}) => {
		// Adresse donnée en texte, en objet URL (booking.js, booking-launcher.js) ou en objet Request.
		const raw = typeof Request === 'function' && input instanceof Request ? input.url : String(input);
		const url = new URL(raw, location.href);
		if (!url.pathname.includes('/wp-json/')) return realFetch(input, init);
		const route = url.pathname.split('/wp-json/')[1].replace(/\/$/, '');
		if (route === 'oracio/v1/form-token') return json({ token: 'apercu' });
		if (route === 'oracio/v1/booking/form') {
			const res = await realFetch(`${prefix}/wp-json/oracio/v1/booking/form.json`, { cache: 'no-cache' });
			if (!res.ok) return res;
			const data = await res.json();
			if (data && typeof data.html === 'string') data.html = freshForm(data.html);
			return json(data);
		}
		if (route === 'oracio/v1/booking/availability') return json(availability(url));
		if (route === 'oracio/v1/consent') return json({ ok: true });
		const form = /^oracio\/v1\/forms\/(contact|callback|booking)$/.exec(route);
		if (form) {
			const params = paramsOf(init && init.body);
			await new Promise((resolve) => setTimeout(resolve, 600));
			// Contrat §2 : { ok, message, ack, newsletter } ; rendez-vous : status et summary en plus (sans donnée personnelle).
			// Aucun accusé de réception ni inscription dans l'aperçu : ack et newsletter vides.
			const result = { ok: true, message: MESSAGE, ack: '', newsletter: '' };
			if (form[1] !== 'booking') return json(result);
			const date = params.get('date_souhaitee') || '';
			const objet = choiceOf('objet', params.get('objet') || '');
			const mode = choiceOf('modalite', params.get('modalite') || '');
			return json({
				...result,
				status: 'a_confirmer',
				summary: {
					objet: objet.title,
					modalite: mode.title,
					adresse: /\d/.test(mode.meta) ? mode.meta : null,
					date,
					dateLabel: ISO.test(date) ? dateLabel(parse(date)) : date,
					creneau: params.get('creneau') || '',
					duree: 30,
				},
			});
		}
		// Route non simulée : réponse d'erreur WordPress (visible dans la console pendant les contrôles).
		return json({ code: 'rest_no_route', message: 'Aperçu : route non simulée.', data: { status: 404 } }, 404);
	};

	/* ---------- Recherche (page 404, page de résultats) ---------- */
	// GitHub Pages ignore « ?s= » (l'accueil s'afficherait) : la recherche est envoyée à la page de résultats de l'aperçu
	// (gabarit search.php exporté), qui applique les règles de WordPress à l'index exporté (recherche/index.json) :
	// termes découpés comme WP_Query (guillemets, mots vides, « -mot » exclu), chaque terme dans le titre, l'extrait ou le
	// contenu, sans tenir compte des accents ni de la casse ; ordre de pertinence de WP_Query puis du plus récent au plus
	// ancien ; 10 résultats par page ; extrait et surlignage de search.php.
	const MODEL = 'apercu-recherche-modele';
	const searchPage = `${prefix}/recherche/`;
	document.addEventListener(
		'submit',
		(event) => {
			const form = event.target;
			if (!form || !form.matches || !form.matches('form[role="search"]') || !form.elements.s) return;
			event.preventDefault();
			const q = form.elements.s.value.trim();
			location.href = q ? `${searchPage}?s=${encodeURIComponent(q)}` : `${prefix}/`;
		},
		true
	);
	const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
	const el = (tag, cls, text) => {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text) node.textContent = text;
		return node;
	};
	// oracio_reading_glue : espaces insécables dans les nombres (« 100 000 », « 10 % »).
	const glue = (text) => text.replace(/(?<=\d)[ \u00A0](?=\d{3}(?!\d))/g, '\u202F').replace(/(?<=\d) (?=(?:\u20AC|%|min\b|ans?\b|mois\b|semaines\b))/g, '\u00A0');
	// WP_Query::parse_search() et parse_search_terms().
	const parseTerms = (q, stopwords) => {
		const raw = q.match(/".*?("|$)|((?<=[\t ",+])|^)[^\t ",+]+/g) || [];
		const terms = [];
		raw.forEach((term) => {
			term = /^".+"$/.test(term) ? term.replace(/^["']+|["']+$/g, '') : term.replace(/^["' ]+|["' ]+$/g, '');
			if (!term || (term.length === 1 && /^[a-z-]$/i.test(term))) return;
			if (stopwords.includes(term.toLowerCase())) return;
			terms.push(term);
		});
		return { count: raw.length, terms: !terms.length || terms.length > 9 ? [q] : terms };
	};
	// oracio_reading_search_excerpt : extrait centré sur la première occurrence, 30 mots, termes surlignés.
	const excerpt = (raw, q) => {
		let text = raw.replace(/\s+/g, ' ').trim();
		const words = q.trim().split(/\s+/).filter((t) => [...t].length >= 2);
		let start = 0;
		words.forEach((t) => {
			const pos = text.toLowerCase().indexOf(t.toLowerCase());
			if (pos !== -1 && (start === 0 || pos < start)) start = pos;
		});
		let lead = '';
		if (start > 90) {
			const space = text.slice(0, start - 60).lastIndexOf(' ');
			text = text.slice(space === -1 ? start - 60 : space + 1);
			lead = '\u2026 ';
		}
		const list = text.split(/[\n\r\t ]+/).filter(Boolean);
		text = lead + (list.length > 30 ? `${list.slice(0, 30).join(' ')}\u2026` : list.join(' '));
		const p = el('p', 'o-results__excerpt');
		if (!words.length) {
			p.textContent = glue(text);
			return p;
		}
		const re = new RegExp(`(${words.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');
		text.split(re).forEach((piece, i) => p.append(i % 2 ? el('mark', '', glue(piece)) : glue(piece)));
		return p;
	};
	const ICON_PAGE = '<svg class="o-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5Z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h4"/></svg>';
	const ICON_ARROW = '<svg class="o-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M7 17 17 7M8 7h9v9"/></svg>';
	// Carte de résultat : même balisage que search.php (titre et image rendus par WordPress pendant l'export).
	const resultItem = (it, q) => {
		const li = el('li', 'o-results__item');
		const media = el('div', it.i ? 'o-results__media' : 'o-results__media o-results__media--icon');
		if (it.i) media.innerHTML = it.i;
		else {
			media.setAttribute('aria-hidden', 'true');
			media.innerHTML = ICON_PAGE;
		}
		const body = el('div', 'o-results__body');
		const title = el('h2', 'o-results__title');
		const link = document.createElement('a');
		link.href = it.u;
		if (it.h) link.innerHTML = it.h;
		else link.textContent = it.t;
		title.append(link);
		body.append(el('p', 'o-results__type', it.k), title, excerpt(it.x || '', q));
		const arrow = el('span', 'o-results__arrow');
		arrow.setAttribute('aria-hidden', 'true');
		arrow.innerHTML = ICON_ARROW;
		li.append(media, body, arrow);
		return li;
	};
	const pagination = (q, current, total) => {
		const nav = el('nav', 'navigation o-pagination');
		nav.setAttribute('aria-label', 'Pagination');
		const links = el('div', 'nav-links');
		const link = (cls, n, text) => {
			const a = el('a', cls, text);
			a.href = `${searchPage}?s=${encodeURIComponent(q)}${n > 1 ? `&page=${n}` : ''}`;
			return a;
		};
		if (current > 1) links.append(link('prev page-numbers', current - 1, 'Précédent'), ' ');
		for (let n = 1; n <= total; n++) {
			if (n === current) {
				const span = el('span', 'page-numbers current', String(n));
				span.setAttribute('aria-current', 'page');
				links.append(span, ' ');
			} else links.append(link('page-numbers', n, String(n)), ' ');
		}
		if (current < total) links.append(link('next page-numbers', current + 1, 'Suivant'));
		nav.append(el('h2', 'screen-reader-text', 'Pagination'), links);
		return nav;
	};
	async function renderSearch() {
		const container = document.querySelector('.o-search-page');
		if (!container) return;
		const params = new URLSearchParams(location.search);
		const q = (params.get('s') || '').trim();
		let data = { stopwords: [], items: [] };
		try {
			data = await (await realFetch(`${prefix}/recherche/index.json`)).json();
		} catch (e) {
			/* index absent : aucun résultat */
		}
		const { count, terms } = parseTerms(q, data.stopwords || []);
		const include = terms.filter((t) => !(t.length > 1 && t[0] === '-')).map(norm);
		const exclude = terms.filter((t) => t.length > 1 && t[0] === '-').map((t) => norm(t.slice(1)));
		const has = (it, k) => norm(it.t).includes(k) || norm(it.e).includes(k) || norm(it.c).includes(k);
		const found = q ? (data.items || []).filter((it) => include.every((k) => has(it, k)) && !exclude.some((k) => has(it, k))) : [];
		const sentence = /(?:\s|^)-/.test(q) ? '' : norm(q);
		const rank = (it) => {
			const t = norm(it.t);
			if (count <= 1) return include.length && t.includes(include[0]) ? 1 : 6;
			if (sentence && t.includes(sentence)) return 1;
			if (include.length < 7 && include.every((k) => t.includes(k))) return 2;
			if (include.length > 1 && include.length < 7 && include.some((k) => t.includes(k))) return 3;
			if (sentence && norm(it.e).includes(sentence)) return 4;
			if (sentence && norm(it.c).includes(sentence)) return 5;
			return 6;
		};
		found.sort((a, b) => rank(a) - rank(b) || (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
		const n = found.length;
		const title = document.querySelector('.o-page-header__title');
		if (title) title.textContent = q ? `Résultats pour «\u202F${q}\u202F»` : 'Recherche';
		const lead = document.querySelector('.o-page-header__lead');
		if (lead) lead.textContent = `${n} ${n <= 1 ? 'résultat' : 'résultats'}`;
		document.title = document.title.split(MODEL).join(q);
		document.querySelectorAll('input[name="s"]').forEach((input) => {
			input.value = q;
			input.setAttribute('value', q);
		});
		if (!n) return; // gabarit « aucun résultat » tel quel
		const pages = Math.ceil(n / 10);
		const current = Math.min(Math.max(1, parseInt(params.get('page'), 10) || 1), pages);
		const panel = container.querySelector('.o-search-panel');
		if (panel) {
			panel.classList.remove('o-search-panel--empty');
			const message = panel.querySelector('.o-search-panel__message');
			if (message) message.remove();
		}
		const shortcuts = container.querySelector('.o-shortcuts');
		if (shortcuts) shortcuts.remove();
		const list = el('ol', 'o-results');
		found.slice((current - 1) * 10, current * 10).forEach((it) => list.append(resultItem(it, q)));
		container.append(list);
		if (pages > 1) container.append(pagination(q, current, pages));
	}
	if (location.pathname === searchPage) {
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSearch);
		else renderSearch();
	}
})();
