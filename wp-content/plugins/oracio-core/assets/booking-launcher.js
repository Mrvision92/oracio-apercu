/**
 * Oracio — lanceur du panneau « Prendre rendez-vous » (chargé sur toutes les pages : quelques Ko, aucune dépendance).
 *
 * Tout lien vers la section #rendez-vous de la page Contact, ou tout élément [data-o-rdv], ouvre l'assistant de
 * prise de rendez-vous dans un panneau modal (<dialog>) sans quitter la page. Le formulaire (rendu par le serveur,
 * jeton inclus : GET /oracio/v1/booking/form) et le script de l'assistant (booking.js) ne sont chargés qu'au
 * survol du lien ou à la première ouverture ; aucune requête vers un autre site.
 * Valeurs initiales non personnelles : data-o-rdv-objet, data-o-rdv-profil, data-o-rdv-modalite, ou paramètres
 * ?objet=&profil=&modalite= de l'adresse du lien (listes blanches, contrôlées par booking.js et par le serveur).
 * Sur une page qui affiche déjà l'assistant (page Contact), le lien fait défiler jusqu'à lui.
 * Pendant l'envoi, Échap et × (aria-disabled) ne ferment pas le panneau ; une demande aboutie panneau fermé est
 * montrée (écran de succès) à la réouverture, jamais un formulaire vierge.
 * Sans JavaScript, ou si le chargement échoue, le lien mène à la page Contact où le formulaire complet fonctionne.
 * Configuration : window.OracioRdv (includes/booking-form.php).
 */
(() => {
	const cfg = window.OracioRdv;
	if (!cfg || typeof HTMLDialogElement !== 'function') return;
	const target = new URL(cfg.target, location.href);
	const slash = (p) => p.replace(/\/?$/, '/');

	function isTrigger(el) {
		if (el.hasAttribute('data-o-rdv')) return true;
		if (el.tagName !== 'A' || !el.href || el.hasAttribute('download') || (el.target && el.target !== '_self')) return false;
		try {
			const url = new URL(el.href, location.href);
			return url.origin === target.origin && slash(url.pathname) === slash(target.pathname) && url.hash === target.hash;
		} catch (e) {
			return false;
		}
	}
	const triggerFrom = (node) => {
		const el = node && node.closest ? node.closest('a[href], [data-o-rdv]') : null;
		return el && isTrigger(el) ? el : null;
	};
	// Valeurs initiales : paramètres ?objet=&profil=&modalite= de l'adresse du lien, puis attributs data-o-rdv-*
	// (prioritaires). Listes blanches appliquées par booking.js et par le serveur.
	const prefillOf = (el) => {
		const out = {};
		let params = null;
		try {
			params = el.href ? new URL(el.href, location.href).searchParams : null;
		} catch (e) {
			params = null;
		}
		['objet', 'profil', 'modalite'].forEach((key) => {
			const value = el.getAttribute(`data-o-rdv-${key}`) || (params && params.get(key));
			if (value) out[key] = value;
		});
		return out;
	};

	/* ---------- Chargements à la demande ---------- */
	let scriptLoad = null;
	const loadScript = () =>
		scriptLoad ||
		(scriptLoad = window.OracioBooking
			? Promise.resolve()
			: new Promise((resolve, reject) => {
					const s = document.createElement('script');
					s.src = cfg.script;
					s.async = true;
					s.onload = () => (window.OracioBooking ? resolve() : reject(new Error('booking.js')));
					s.onerror = () => {
						scriptLoad = null;
						s.remove();
						reject(new Error('booking.js'));
					};
					document.head.appendChild(s);
				}));

	// Formulaire du panneau : la page d'origine (chemin seul, jamais de paramètre) sert à l'archivage et au profil déduit.
	const fetchForm = () => {
		const url = new URL(cfg.formUrl, location.href);
		url.searchParams.set('source', location.pathname);
		return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((d) => (d && typeof d.html === 'string' ? d.html : Promise.reject(new Error('html'))));
	};

	let dialog = null;
	let body = null;
	let closeBtn = null;
	let trigger = null;
	let instance = null; // assistant monté dans le panneau
	let finished = false; // demande envoyée : un nouveau formulaire sera chargé à la prochaine ouverture
	let unseen = false; // demande aboutie panneau fermé : écran de succès à montrer à la réouverture
	let prefetched = null; // formulaire chargé d'avance (survol, focus)
	let busy = false; // chargement du panneau en cours

	const prefetch = () => {
		if (instance && !finished) return;
		if (!prefetched) {
			prefetched = fetchForm();
			prefetched.catch(() => (prefetched = null));
		}
		loadScript().catch(() => {});
	};

	/* ---------- Panneau ---------- */
	const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;

	function build() {
		dialog = document.createElement('dialog');
		dialog.className = 'o-rdv-dialog';
		dialog.setAttribute('aria-labelledby', 'o-rdv-dialog-title');
		dialog.innerHTML =
			'<div class="o-rdv-dialog__head">' +
			'<h2 class="o-rdv-dialog__title" id="o-rdv-dialog-title" tabindex="-1">Prendre rendez-vous</h2>' +
			`<button type="button" class="o-rdv-dialog__close">${svg('M6 6l12 12M18 6 6 18')}<span class="screen-reader-text">Fermer la prise de rendez-vous</span></button>` +
			'</div><div class="o-rdv-dialog__body"></div>';
		body = dialog.querySelector('.o-rdv-dialog__body');
		closeBtn = dialog.querySelector('.o-rdv-dialog__close');
		const sending = () => !!body.querySelector('[data-o-rdv-sending]');
		closeBtn.addEventListener('click', () => sending() || dialog.close());
		dialog.addEventListener('cancel', (e) => sending() && e.preventDefault());
		dialog.addEventListener('close', () => {
			document.documentElement.classList.remove('o-rdv-locked');
			if (finished && !unseen) {
				instance = null;
				body.textContent = '';
			}
			// Focus rendu au déclencheur (ou au bouton du menu mobile si le lien y est masqué).
			const back = trigger && trigger.isConnected && trigger.getClientRects().length ? trigger : document.querySelector('[data-o-drawer-toggle]');
			if (back) back.focus();
		});
		document.body.appendChild(dialog);
	}

	function loading() {
		const box = document.createElement('div');
		box.className = 'o-rdv-dialog__loading';
		box.setAttribute('role', 'status');
		box.innerHTML =
			'<span class="screen-reader-text">Chargement de la prise de rendez-vous…</span>' +
			'<span class="o-rdv-skel o-rdv-skel--bar" aria-hidden="true"></span>' +
			'<span class="o-rdv-skel o-rdv-skel--title" aria-hidden="true"></span>' +
			'<span class="o-rdv-dialog__loading-grid" aria-hidden="true">' +
			'<span class="o-rdv-skel o-rdv-skel--card"></span>'.repeat(6) +
			'</span>';
		return box;
	}

	function failure() {
		const box = document.createElement('div');
		box.className = 'o-rdv-dialog__error';
		box.setAttribute('role', 'alert');
		const p = document.createElement('p');
		p.textContent = 'La prise de rendez-vous n’a pas pu être chargée. Vérifiez votre connexion, ou ouvrez la page Contact.';
		const actions = document.createElement('p');
		actions.className = 'o-rdv-dialog__error-actions';
		const link = document.createElement('a');
		link.className = 'o-btn o-btn--arrow';
		link.href = target.href;
		link.textContent = 'Ouvrir la page Contact';
		actions.appendChild(link);
		if (cfg.phone && cfg.tel) {
			const call = document.createElement('a');
			call.className = 'o-btn o-btn--outline';
			call.href = cfg.tel;
			call.textContent = `Appeler le ${cfg.phone}`;
			actions.appendChild(call);
		}
		box.append(p, actions);
		return box;
	}

	// Lien du menu mobile : menu refermé (son bouton ne déplace pas le focus) avant d'afficher l'assistant.
	function closeDrawer(el) {
		const drawer = el.closest('[data-o-drawer]');
		const toggle = document.querySelector('[data-o-drawer-toggle]');
		if (drawer && !drawer.hidden && toggle) toggle.click();
	}

	async function open(el, prefill) {
		trigger = el;
		if (!dialog) build();
		closeDrawer(el);
		document.documentElement.classList.add('o-rdv-locked');
		if (!dialog.open) dialog.showModal();

		if (instance && unseen) {
			unseen = false;
			const done = body.querySelector('.o-rdv-done__title');
			if (done) done.focus();
			return;
		}
		if (instance && !finished) {
			instance.reveal(prefill);
			return;
		}
		if (busy) return;
		busy = true;
		instance = null;
		finished = false;
		body.replaceChildren(loading());
		dialog.querySelector('.o-rdv-dialog__title').focus();
		try {
			const [html] = await Promise.all([prefetched || fetchForm(), loadScript()]);
			prefetched = null;
			body.innerHTML = html; // rendu serveur, valeurs échappées (includes/booking-form.php)
			const root = body.querySelector('[data-o-rdv-wizard]');
			instance = root && window.OracioBooking.mount(root, {
				prefill,
				focus: dialog.open,
				close: () => dialog.close(),
				onSending: (on) => (on ? closeBtn.setAttribute('aria-disabled', 'true') : closeBtn.removeAttribute('aria-disabled')),
				onDone: () => {
					finished = true;
					unseen = !dialog.open;
				},
			});
			if (!instance) throw new Error('mount');
		} catch (e) {
			prefetched = null;
			instance = null;
			body.replaceChildren(failure());
		}
		busy = false;
	}

	/* ---------- Déclencheurs ---------- */
	document.addEventListener('click', (event) => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const el = triggerFrom(event.target);
		if (!el) return;
		const prefill = prefillOf(el);
		// Page qui affiche déjà l'assistant : défilement jusqu'à lui (sinon, ancre classique).
		const inline = document.querySelector('[data-o-rdv-wizard][data-o-rdv-mode="inline"]');
		if (inline) {
			if (inline.oracioBooking) {
				event.preventDefault();
				closeDrawer(el);
				inline.oracioBooking.reveal(prefill);
			}
			return;
		}
		event.preventDefault();
		open(el, prefill);
	});
	const warm = (event) => {
		if (triggerFrom(event.target) && !document.querySelector('[data-o-rdv-wizard][data-o-rdv-mode="inline"]')) prefetch();
	};
	document.addEventListener('pointerover', warm, { passive: true });
	document.addEventListener('focusin', warm);
})();
