/**
 * Oracio — assistant « Prendre rendez-vous » (parcours en cinq étapes, sans dépendance).
 *
 * Transforme le formulaire rendu par le serveur (includes/booking-form.php : quatre fieldsets [data-o-rdv-step],
 * formulaire complet sans JavaScript) en assistant :
 *   1 Votre besoin · 2 Format · 3 Date et heure · 4 Vos coordonnées · 5 Récapitulatif (ajouté ici).
 * - Calendrier mensuel alimenté par GET /oracio/v1/booking/availability (contrat §1) : jours disponibles nets,
 *   indisponibles grisés avec la raison (survol, focus, libellé complet), créneaux groupés Matin / Après-midi,
 *   premier jour disponible présélectionné ; grille de boutons au clavier (flèches, Origine/Fin, Page préc./suiv.).
 *   Si l'API ne répond pas : retour au champ date et aux créneaux du rendu serveur (le serveur revérifie tout).
 * - Récapitulatif persistant (colonne à droite sur grand écran, barre repliable en bas sur petit écran).
 * - Envoi : POST /oracio/v1/forms/booking. 200 → écran de succès (récapitulatif du serveur, prochaines étapes
 *   honnêtes) ; 409 → retour à l'étape 3, créneau retiré, message ; 422 → retour à la première étape en erreur ;
 *   autre erreur → message du serveur, jamais de faux succès.
 * - Seuls les choix non personnels (objet, profil, déjà client, modalité, date, créneau, étape) sont mémorisés
 *   (sessionStorage) ; jamais le nom, l'e-mail, le téléphone, la société ni les précisions.
 * Point d'entrée : window.OracioBooking.mount(conteneur [data-o-rdv-wizard], options) — montage automatique des
 * assistants présents dans la page ; le panneau (booking-launcher.js) monte celui qu'il charge.
 * Petit écran et panneau : le pied (statut, résumé, Retour / Continuer) reste collé en bas ; sa hauteur est réservée
 * sous chaque élément qui peut recevoir le focus (scroll-margin-bottom, booking.css) pour qu'il ne masque jamais
 * l'élément qui a le focus (WCAG 2.4.11), et le message d'erreur global est alors affiché en tête de l'étape plutôt
 * que dans le pied. Pendant l'envoi, la racine
 * porte l'attribut data-o-rdv-sending et l'option onSending(vrai | faux) est appelée (le panneau ne se ferme pas).
 */
(() => {
	'use strict';
	if (window.OracioBooking) return;

	/* ---------- Dates (chaînes AAAA-MM-JJ, jours du calendrier de Bruxelles) ---------- */
	const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
	const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
	const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
	const DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
	const WEEK = [1, 2, 3, 4, 5, 6, 0]; // semaine du lundi au dimanche
	const ISO = /^\d{4}-\d{2}-\d{2}$/;

	const pad = (n) => String(n).padStart(2, '0');
	const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const fromIso = (s) => {
		const [y, m, d] = s.split('-').map(Number);
		return new Date(y, m - 1, d, 12); // midi : à l'abri des changements d'heure
	};
	const addDays = (s, n) => {
		const d = fromIso(s);
		d.setDate(d.getDate() + n);
		return toIso(d);
	};
	const monthOf = (s) => `${s.slice(0, 7)}-01`;
	const addMonths = (s, n) => {
		const d = fromIso(monthOf(s));
		d.setMonth(d.getMonth() + n);
		return toIso(d);
	};
	const monthLength = (s) => {
		const d = fromIso(monthOf(s));
		return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	};
	const lastOf = (s) => `${s.slice(0, 7)}-${pad(monthLength(s))}`;
	const weekday = (s) => (fromIso(s).getDay() + 6) % 7; // 0 = lundi
	const ordinal = (n) => (n === 1 ? '1er' : String(n));
	const longDate = (s) => {
		const d = fromIso(s);
		return `${DAYS[d.getDay()]} ${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	};
	const dayMonth = (s) => {
		const d = fromIso(s);
		return `${DAYS[d.getDay()]} ${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`;
	};
	const shortDate = (s) => {
		const d = fromIso(s);
		return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
	};
	const monthLabel = (s) => {
		const d = fromIso(s);
		return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
	};
	const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
	// Première lettre en minuscule, sauf sigle (« Cabinet fermé » → « cabinet fermé »).
	const lower = (s) => (s && !/^[A-ZÀ-Ý]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
	const isTime = (t) => /^\d{2}:\d{2}$/.test(t);
	const endTime = (t, minutes) => {
		if (!isTime(t)) return '';
		const total = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + minutes;
		return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
	};
	const slotLabels = { matin: 'Matin', 'apres-midi': 'Après-midi' };
	const timeText = (t, minutes) => (isTime(t) ? `${t} – ${endTime(t, minutes)}` : slotLabels[t] || t);

	const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	/* ---------- Petites aides DOM ---------- */
	function h(tag, attrs = {}, children = []) {
		const el = document.createElement(tag);
		Object.entries(attrs).forEach(([k, v]) => {
			if (v === null || v === undefined || v === false) return;
			if (k === 'class') el.className = v;
			else if (k === 'text') el.textContent = v;
			else if (k === 'html') el.innerHTML = v; // réservé aux icônes fixes de ce fichier
			else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
			else el.setAttribute(k, v === true ? '' : v);
		});
		(Array.isArray(children) ? children : [children]).forEach((c) => c !== null && c !== undefined && c !== false && el.append(c));
		return el;
	}
	const ICONS = {
		prev: 'M14.5 6 8.5 12l6 6',
		next: 'm9.5 6 6 6-6 6',
		check: 'm5 12.5 4.5 4.5L19 7.5',
		chevron: 'm6 9 6 6 6-6',
		edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
		objet: 'M5 4.5h14v15H5zM8.5 9h7M8.5 12.5h7M8.5 16h4',
		format: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21ZM12 7.75a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z',
		date: 'M3.5 5h17v15h-17zM3.5 9.5h17M8 3v4M16 3v4',
		duree: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2',
		phone: 'M5.5 3.5h3l1.5 4-2 1.25a10 10 0 0 0 5.25 5.25L14.5 12l4 1.5v3a2 2 0 0 1-2 2A13 13 0 0 1 3.5 5.5a2 2 0 0 1 2-2Z',
		mail: 'M3 5h18v14H3zM3.5 6.5l8.5 6.5 8.5-6.5',
		info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5M12 7.75v.01',
	};
	const icon = (name) =>
		`<svg class="o-rdv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`;

	const STEP_TITLES = ['Votre besoin', 'Format', 'Date et heure', 'Coordonnées', 'Récapitulatif'];
	const STEP_FIELDS = {
		1: ['objet', 'profil', 'deja_client'],
		2: ['modalite'],
		3: ['date_souhaitee', 'creneau'],
		4: ['nom', 'email', 'telephone', 'societe', 'message', 'consentement'],
	};
	const KEEP = ['objet', 'profil', 'deja_client', 'modalite'];
	const STATUS_TEXT = {
		open: 'disponible',
		full: 'complet',
		closed: 'fermé',
		holiday: 'férié',
		closure: 'fermeture exceptionnelle',
		out_of_range: 'hors période de réservation',
	};

	/* =====================================================================
	 * Assistant
	 * ================================================================== */
	function createWizard(root, form, cfg, opts) {
		const uid = cfg.uid || form.id;
		const F = cfg.fields || {};
		const M = cfg.messages || {};
		const cabinet = cfg.cabinet || {};
		const steps = Array.from(form.querySelectorAll('[data-o-rdv-step]'));
		if (steps.length !== 4) throw new Error('Étapes du formulaire introuvables');

		const state = {
			step: 1,
			maxStep: 1,
			editing: false,
			month: '',
			focusDate: '',
			date: '',
			slot: '',
			slotStale: false,
			fallback: false,
			sending: false,
			done: false,
			meta: {
				min: ISO.test(cfg.min || '') ? cfg.min : '',
				max: ISO.test(cfg.max || '') ? cfg.max : '',
				duration: Number(cfg.duration) || 30,
				autoConfirm: !!cfg.autoConfirm,
				timezone: cfg.timezone || 'Europe/Brussels',
			},
			days: new Map(), // `${modalité}|AAAA-MM-JJ` → { status, reason, slots }
			loads: new Map(), // `${modalité}|AAAA-MM` → Promise
			ready: new Set(), // `${modalité}|AAAA-MM` chargés
			dateStep: Promise.resolve(),
			touched: new Set(),
		};
		const today = ISO.test(cfg.today || '') ? cfg.today : toIso(new Date());

		/* ---------- Accès aux champs ---------- */
		const wrapOf = (name) => form.querySelector(`[data-field="${name}"]`);
		const inputsOf = (name) => Array.from(form.querySelectorAll(`[name="${name}"]`));
		const isGroup = (name) => {
			const w = wrapOf(name);
			return !!w && w.getAttribute('role') === 'radiogroup';
		};
		function valueOf(name) {
			if (name === 'date_souhaitee') return form.elements.date_souhaitee ? form.elements.date_souhaitee.value.trim() : '';
			const inputs = inputsOf(name);
			if (!inputs.length) return '';
			if (inputs[0].type === 'radio') return (inputs.find((i) => i.checked) || {}).value || '';
			if (inputs[0].type === 'checkbox') return inputs[0].checked ? inputs[0].value : '';
			return inputs[0].value;
		}
		function setRadio(name, value) {
			const input = inputsOf(name).find((i) => i.type === 'radio' && i.value === value);
			if (input) input.checked = true;
			return !!input;
		}
		const labelOf = (input) => {
			if (!input) return '';
			const label = form.querySelector(`label[for="${input.id}"]`);
			const title = label && (label.querySelector('.o-choice__title') || label.querySelector('span'));
			return ((title || label || {}).textContent || input.value).trim();
		};
		const checkedInput = (name) => inputsOf(name).find((i) => i.checked) || null;
		const metaOf = (input) => {
			const label = input && form.querySelector(`label[for="${input.id}"]`);
			const meta = label && label.querySelector('.o-choice__meta');
			return meta ? meta.textContent.trim() : '';
		};

		/* ---------- Contrôles (le serveur revérifie tout) ---------- */
		const checks = {
			objet: (v) => (v ? '' : F.objet),
			modalite: (v) => (v ? '' : F.modalite),
			date_souhaitee: (v) => {
				if (!v) return F.date_required;
				if (state.fallback || !ISO.test(v)) return '';
				const info = dayInfo(v);
				return info && info.status !== 'open' && info.status !== 'loading' ? reasonSentence(v, info) : '';
			},
			creneau: (v) => (v ? '' : F.creneau),
			nom: (v) => (v.trim() && v.trim().length <= 120 ? '' : F.nom),
			email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) && v.trim().length <= 254 ? '' : F.email),
			telephone: (v) => {
				const t = v.trim();
				const digits = t.replace(/\D/g, '').length;
				return /^[\d\s+/().-]+$/.test(t) && digits >= 8 && digits <= 15 ? '' : F.telephone;
			},
			societe: (v) => (v.trim().length <= 120 ? '' : F.societe || 'Le nom de la société ne peut pas dépasser 120 caractères.'),
			message: (v) => {
				if (v.length > 2000) return F.message_long_booking;
				return (v.match(/https?:\/\//gi) || []).length > 3 ? F.message_links : '';
			},
			consentement: (v) => (v ? '' : F.consentement),
		};
		const check = (name) => (checks[name] ? checks[name](valueOf(name)) || '' : '');

		function setError(name, message) {
			const wrap = wrapOf(name);
			if (!wrap) return;
			wrap.classList.toggle('has-error', !!message);
			let target = isGroup(name) ? wrap : wrap.querySelector('input, select, textarea');
			if (name === 'date_souhaitee' && !state.fallback && grid) target = grid;
			if (target) {
				if (message) target.setAttribute('aria-invalid', 'true');
				else target.removeAttribute('aria-invalid');
			}
			const error = wrap.querySelector('.o-field__error');
			if (error) {
				error.textContent = message || '';
				error.hidden = !message;
			}
		}
		const hasError = (name) => {
			const wrap = wrapOf(name);
			return !!wrap && wrap.classList.contains('has-error');
		};
		function focusField(name) {
			if (name === 'date_souhaitee' && !state.fallback && grid) {
				const btn = grid.querySelector('.o-cal__day[tabindex="0"]');
				if (btn) return btn.focus();
			}
			const inputs = inputsOf(name);
			const target = inputs.find((i) => i.checked) || inputs.find((i) => !i.disabled) || null;
			if (target) target.focus();
		}

		/** Contrôle d'une étape ; affiche les erreurs ; renvoie le premier champ en erreur ou ''. */
		function validateStep(n, show = true) {
			let first = '';
			(STEP_FIELDS[n] || []).forEach((name) => {
				if (!wrapOf(name) && name !== 'date_souhaitee') return;
				const message = check(name);
				if (show) {
					setError(name, message);
					state.touched.add(name);
				}
				if (message && !first) first = name;
			});
			return first;
		}

		/* ---------- Statut global (zone lue par les lecteurs d'écran) ---------- */
		const status = form.querySelector('.o-form__status');
		function setStatus(kind, message, extras = [], focus = false) {
			if (!status) return;
			status.className = `o-form__status${kind ? ` is-${kind}` : ''}`;
			root.classList.toggle('has-status-error', kind === 'error' && !!message);
			status.textContent = '';
			if (message) status.appendChild(h('span', { text: message }));
			extras.filter(Boolean).forEach((text) => {
				status.append(' ', h('span', { class: 'o-form__status-extra', text }));
			});
			if (message && focus) status.focus();
		}

		/* ---------- Mise en place de l'interface ---------- */
		root.classList.add('is-enhanced');
		const layout = h('div', { class: 'o-rdv__layout' });
		form.parentNode.insertBefore(layout, form);

		// Barre d'étapes (vraie séquence : pastilles numérotées ; l'intitulé de l'étape en cours est dit par sa légende).
		const progressList = h('ol', { class: 'o-rdv-progress__list' });
		const progress = h('nav', { class: 'o-rdv-progress', 'aria-label': 'Étapes de la prise de rendez-vous' }, [progressList]);
		layout.append(progress, form);

		// Intitulés d'étape : le numéro est porté par la barre d'étapes.
		const legends = steps.map((step) => step.querySelector('.o-rdv-step__legend'));
		const leads = [
			'Dites-nous ce qui vous amène.',
			'Choisissez la façon de nous rencontrer.',
			'Choisissez un jour, puis une heure de début (heure de Bruxelles).',
			state.meta.autoConfirm ? 'Pour vous envoyer la confirmation du rendez-vous.' : 'Pour vous confirmer le rendez-vous.',
		];
		steps.forEach((step, i) => legends[i].after(h('p', { class: 'o-rdv-step__lead', text: leads[i] })));

		// Étape 5 : récapitulatif.
		const recap = h('div', { class: 'o-rdv-recap' });
		const recapNote = h('p', { class: 'o-rdv-recap__note' });
		const step5 = h('fieldset', { class: 'o-form__section o-rdv-step o-rdv-step--recap', 'data-o-rdv-step': '5', id: `${uid}-etape-5`, hidden: true }, [
			h('legend', { class: 'o-form__legend o-rdv-step__legend', tabindex: '-1' }, [h('span', { class: 'o-form__step', 'aria-hidden': 'true', text: '5' }), h('span', { class: 'o-rdv-step__title', text: 'Récapitulatif' })]),
			h('p', { class: 'o-rdv-step__lead', text: 'Vérifiez votre demande avant de l’envoyer. Chaque bloc peut être modifié.' }),
			recap,
			recapNote,
		]);
		steps[3].after(step5);
		steps.push(step5);
		legends.push(step5.querySelector('legend'));

		// Pied de l'assistant : statut, résumé replié (petit écran), boutons Retour / Continuer.
		const submit = form.querySelector('.o-form__submit');
		const back = h('button', { type: 'button', class: 'o-btn o-btn--outline o-rdv-nav__back', onclick: () => previous() }, ['Retour']);
		submit.classList.add('o-btn--arrow', 'o-rdv-nav__next');
		const dockLine = h('span', { class: 'o-rdv-dock__line' });
		// Détail déplié : zone qui peut défiler (hauteur bornée) ; focalisable et nommée, pour qu'on puisse la faire défiler
		// au clavier (flèches, Page suivante) et que la note « Il s'agit d'une demande… », placée en tête, soit lue.
		const dockDetails = h('div', { class: 'o-rdv-dock__details', id: `${uid}-resume-details`, hidden: true, tabindex: '0', role: 'region', 'aria-label': detailsLabel() });
		const dockToggle = h('button', { type: 'button', class: 'o-rdv-dock__toggle', 'aria-expanded': 'false', 'aria-controls': `${uid}-resume-details` }, [
			h('span', { class: 'o-rdv-dock__eyebrow', text: eyebrowText() }),
			dockLine,
			h('span', { class: 'o-rdv-dock__chevron', html: icon('chevron') }),
		]);
		dockToggle.addEventListener('click', () => {
			const open = dockToggle.getAttribute('aria-expanded') !== 'true';
			dockToggle.setAttribute('aria-expanded', String(open));
			dockDetails.hidden = !open;
		});
		const dockSummary = h('div', { class: 'o-rdv-dock__summary', hidden: true }, [dockDetails, dockToggle]);
		const nav = h('div', { class: 'o-rdv-nav' }, [back, submit]);
		const dock = h('div', { class: 'o-rdv-dock' }, [status, dockSummary, nav]);
		const actions = form.querySelector('.o-form__actions');
		form.append(dock);
		if (actions && !actions.children.length) actions.remove();

		/* ---------- Pied collant : le focus n'est jamais masqué (WCAG 2.4.11) ---------- */
		const scroller = () => root.closest('.o-rdv-dialog__body');
		const docked = () => getComputedStyle(dock).position === 'sticky';
		const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		/**
		 * Version compacte de l'étape 3 (semaines passées masquées, heures montrées à l'arrivée) : conteneur étroit, ou
		 * fenêtre basse (téléphone en paysage, zoom important) où la place manque en hauteur.
		 */
		const isCompact = () => root.getBoundingClientRect().width <= 30 * rem() || window.innerHeight <= 30 * rem();
		/** Message global : en tête de l'étape quand le pied est collant (dans le pied, il le ferait grandir et masquerait le formulaire). */
		function placeStatus(sticky) {
			if (!status) return;
			const step = steps[state.step - 1];
			const lead = step && step.querySelector('.o-rdv-step__lead');
			if (sticky && lead) {
				if (status.previousElementSibling !== lead) lead.after(status);
			} else if (status.parentNode !== dock) dock.prepend(status);
		}
		function syncDock() {
			const sticky = docked() && !state.done;
			const height = sticky ? Math.ceil(dock.getBoundingClientRect().height) : 0;
			// Défilement au clavier : la hauteur du pied est réservée sous les éléments des étapes (scroll-margin-bottom,
			// classe is-docked), pas sur la page ni le panneau : un scroll-padding s'appliquerait aussi aux boutons du
			// pied, et chaque Tab sur Retour / Continuer ferait défiler la page pour rien.
			root.style.setProperty('--o-rdv-dock-h', `${height}px`);
			root.classList.toggle('is-docked', sticky);
			const compact = isCompact();
			if (compact !== state.compact) {
				state.compact = compact;
				// Semaines passées affichées ou non : la grille est redessinée, le focus reste sur le jour qui l'avait.
				const focused = tbody.contains(document.activeElement) ? document.activeElement.dataset.date : '';
				if (state.month) renderGrid();
				if (focused) focusDay(focused);
			}
			placeStatus(sticky);
		}
		// Une mesure par image : syncDock peut déplacer le message global (et changer ces tailles), ce qui, fait dans le
		// rappel même, relancerait l'observateur (erreur « ResizeObserver loop »).
		let syncing = 0;
		if ('ResizeObserver' in window) {
			const watch = new ResizeObserver(() => {
				if (!syncing) syncing = requestAnimationFrame(() => ((syncing = 0), syncDock()));
			});
			watch.observe(dock);
			watch.observe(root);
		}
		// Hauteur de la fenêtre seule (rotation, zoom) : pied collant ou non (booking.css, fenêtre basse), version compacte.
		window.addEventListener('resize', () => {
			if (!syncing) syncing = requestAnimationFrame(() => ((syncing = 0), syncDock()));
		});
		/**
		 * Exécute fn une fois le défilement en cours terminé (défilement doux de la page, ou du navigateur vers le champ
		 * qui reçoit le focus) : mesurer pendant l'animation donnerait de fausses positions.
		 */
		function afterScroll(fn) {
			const box = scroller() || window;
			const pos = () => (box === window ? window.scrollY : box.scrollTop);
			const start = pos();
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					// Défilement doux demandé par l'assistant lui-même (smoothTo) : il peut n'avoir pas encore commencé ; on
					// attend sa fin, sinon un nouveau défilement l'interromprait à mi-course.
					if (pos() === start && !smoothPending) return fn();
					let timer = 0;
					const run = (event) => {
						// « scrollend » d'un défilement antérieur (clic, focus), arrivé alors que le défilement doux demandé
						// depuis n'est pas fini (ou pas commencé) : on attend la fin de celui-ci. smoothPending n'est remis à
						// faux que par expectScroll, à la fin de ce défilement.
						if (event && smoothPending) return;
						clearTimeout(timer);
						box.removeEventListener('scrollend', run);
						fn();
					};
					box.addEventListener('scrollend', run);
					timer = setTimeout(run, smoothPending ? 1500 : 1000); // navigateurs sans « scrollend »
				})
			);
		}
		/** Haut utile de la page : sous l'en-tête fixe du site (scroll-padding-top de base.css). */
		const pageTop = () => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
		let smoothPending = false;
		let smoothStop = () => {};
		/**
		 * Défilement doux de la page demandé par l'assistant, vers la position target : afterScroll attend qu'il soit fini.
		 * Il l'est au premier « scrollend » à cette position ; un « scrollend » reçu avant vient d'un défilement antérieur
		 * (clic, focus) et ne doit pas faire croire aux mesures que la page est déjà à sa place.
		 */
		function expectScroll(target) {
			smoothStop();
			const max = document.documentElement.scrollHeight - window.innerHeight;
			const to = Math.max(0, Math.min(max, target));
			smoothPending = !reduced() && Math.abs(window.scrollY - to) > 2;
			if (!smoothPending) return;
			let timer = 0;
			const onEnd = () => Math.abs(window.scrollY - to) <= 2 && smoothStop();
			smoothStop = () => {
				clearTimeout(timer);
				window.removeEventListener('scrollend', onEnd);
				smoothPending = false;
				smoothStop = () => {};
			};
			window.addEventListener('scrollend', onEnd);
			timer = setTimeout(smoothStop, 1500); // navigateurs sans « scrollend », ou défilement interrompu
		}
		/**
		 * Décalage vertical en cours des ancêtres (translate / transform), par exemple l'apparition au défilement du
		 * thème (bloc pas encore apparu : translate 0 44px). Il disparaît pendant le défilement : la cible n'en tient pas
		 * compte.
		 */
		function pendingShift(el) {
			let y = 0;
			for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
				const cs = getComputedStyle(p);
				const t = cs.translate && cs.translate !== 'none' ? cs.translate.split(' ')[1] || '' : '';
				if (t.endsWith('px')) y += parseFloat(t) || 0;
				if (cs.transform && cs.transform !== 'none' && 'DOMMatrixReadOnly' in window) y += new DOMMatrixReadOnly(cs.transform).m42;
			}
			return y;
		}
		/**
		 * Fait défiler la page jusqu'au haut de l'assistant, sous l'en-tête fixe (scroll-padding-top), défilement doux sauf
		 * mouvement réduit. Position calculée sans le décalage d'apparition : scrollIntoView le comptait et, depuis le haut
		 * de la page Contact, l'assistant finissait 44 px trop haut, sa barre d'étapes sous l'en-tête.
		 */
		function smoothTo() {
			const margin = parseFloat(getComputedStyle(root).scrollMarginTop) || 0;
			const target = Math.max(0, Math.round(window.scrollY + root.getBoundingClientRect().top - pendingShift(root) - pageTop() - margin));
			expectScroll(target);
			window.scrollTo({ top: target, behavior: reduced() ? 'auto' : 'smooth' });
		}
		// Filet de sécurité : un champ qui reçoit le focus sous le pied collant est remonté au-dessus.
		form.addEventListener('focusin', (event) => {
			const target = event.target;
			if (dock.contains(target)) return;
			afterScroll(() => {
				if (document.activeElement !== target) return;
				// Champ (avec son libellé placé au-dessus) passé sous l'en-tête fixe du site, ou au-dessus du haut du panneau :
				// au Maj+Tab, le navigateur s'arrête au bord du champ et laisse son libellé hors de la vue.
				let top = (target.closest('label') || target).getBoundingClientRect().top;
				const lab = !target.closest('label') && target.labels && target.labels[0];
				if (lab) {
					const lt = lab.getBoundingClientRect().top;
					if (lt < top && top - lt < 120) top = lt;
				}
				// Même haut utile que showChosenWeek (haut du panneau, ou bas de l'en-tête + 1rem).
				const edge = scroller() ? scroller().getBoundingClientRect().top : pageTop();
				if (top < edge - 1) return (scroller() || window).scrollBy({ top: top - edge, behavior: 'auto' });
				if (!docked()) return;
				const bottom = (target.closest('label') || target).getBoundingClientRect().bottom;
				const limit = dock.getBoundingClientRect().top - 8;
				// « auto » : défilement doux de la page, sauf mouvement réduit (base.css).
				if (bottom > limit) (scroller() || window).scrollBy({ top: bottom - limit + 16, behavior: 'auto' });
			});
		});

		// Récapitulatif persistant (grand écran).
		const summaryList = h('dl', { class: 'o-rdv-summary__list' });
		const summaryNote = h('p', { class: 'o-rdv-summary__note' });
		const help = h('p', { class: 'o-rdv-summary__help' });
		if (cabinet.phone && cabinet.tel) help.append('Une question ? ', h('a', { href: cabinet.tel, text: cabinet.phone }));
		const aside = h('aside', { class: 'o-rdv-summary', 'aria-labelledby': `${uid}-resume-titre` }, [
			h('div', { class: 'o-rdv-summary__card' }, [h('p', { class: 'o-rdv-summary__eyebrow', id: `${uid}-resume-titre`, text: eyebrowText() }), summaryList, summaryNote, help]),
		]);
		layout.append(aside);

		/* ---------- Étape 3 : calendrier et créneaux ---------- */
		const dateWrap = wrapOf('date_souhaitee');
		const dateInput = form.elements.date_souhaitee;
		const slotWrap = wrapOf('creneau');
		const slotBox = slotWrap.querySelector('.o-slots');
		const slotLegend = slotWrap.querySelector('legend');
		const slotHint = slotWrap.querySelector('.o-field__hint');
		const original = { slots: slotBox.innerHTML, slotClass: slotBox.className, legend: slotLegend.innerHTML, hint: slotHint ? slotHint.textContent : '' };
		slotWrap.closest('.o-form__row').classList.add('o-rdv-when');

		const monthTitle = h('p', { class: 'o-cal__month', id: `${uid}-cal-mois`, 'aria-live': 'polite' });
		const prevBtn = h('button', { type: 'button', class: 'o-cal__nav', 'aria-label': 'Mois précédent', html: icon('prev') });
		const nextBtn = h('button', { type: 'button', class: 'o-cal__nav', 'aria-label': 'Mois suivant', html: icon('next') });
		const head = h('tr', {}, WEEK.map((d) => h('th', { scope: 'col', abbr: DAYS[d] }, [h('span', { 'aria-hidden': 'true', text: DAYS_SHORT[d].replace('.', '') }), h('span', { class: 'screen-reader-text', text: DAYS[d] })])));
		const tbody = h('tbody');
		const grid = h('table', { class: 'o-cal__grid', role: 'grid', 'aria-labelledby': `${uid}-cal-mois`, 'aria-describedby': `${uid}-date_souhaitee-error ${uid}-cal-aide` }, [h('thead', {}, head), tbody]);
		const calMsg = h('div', { class: 'o-cal__msg', role: 'status', 'aria-live': 'polite' });
		const calHelp = h('p', { class: 'o-cal__help', id: `${uid}-cal-aide` }, [
			h('span', { class: 'o-cal__key o-cal__key--open', 'aria-hidden': 'true' }),
			'Disponible',
			h('span', { class: 'o-cal__key', 'aria-hidden': 'true' }),
			'Indisponible',
			h('span', { class: 'screen-reader-text', text: '. Flèches pour changer de jour, Page précédente et Page suivante pour changer de mois.' }),
		]);
		const cal = h('div', { class: 'o-cal' }, [h('div', { class: 'o-cal__head' }, [prevBtn, monthTitle, nextBtn]), grid, calHelp, calMsg]);
		dateWrap.classList.add('is-calendar');
		dateWrap.insertBefore(cal, dateWrap.querySelector('.o-field__error'));
		// Le libellé du champ date (« Date souhaitée ») et le mois affiché nomment la grille.
		const dateLabel = dateWrap.querySelector('.o-field__label');
		if (dateLabel) {
			dateLabel.id = `${uid}-date-libelle`;
			grid.setAttribute('aria-labelledby', `${uid}-date-libelle ${uid}-cal-mois`);
		}

		const modalite = () => valueOf('modalite');
		const dayKey = (iso) => `${modalite()}|${iso}`;
		const monthReady = (iso) => state.ready.has(`${modalite()}|${iso.slice(0, 7)}`);
		function dayInfo(iso) {
			if (!monthReady(iso)) return { status: 'loading' };
			return state.days.get(dayKey(iso)) || { status: 'out_of_range', reason: null };
		}
		function statusText(iso, info) {
			const reason = typeof info.reason === 'string' ? info.reason.trim() : '';
			switch (info.status) {
				case 'open':
					return 'disponible';
				case 'holiday':
					return reason ? (/férié/i.test(reason) ? reason : `férié (${reason})`) : 'férié';
				case 'out_of_range':
					if (iso < today) return 'date passée';
					return lower(reason) || (state.meta.min && iso < state.meta.min ? 'délai trop court' : 'au-delà de la période de réservation');
				default:
					return lower(reason) || STATUS_TEXT[info.status] || 'indisponible';
			}
		}
		const reasonSentence = (iso, info) => `${cap(longDate(iso))} n’est pas disponible : ${statusText(iso, info)}. Choisissez un autre jour.`;

		/** Disponibilités d'un mois (contrat §1) ; une requête par mois et par modalité, mise en cache. */
		function loadMonth(month) {
			const mod = modalite();
			const key = `${mod}|${month.slice(0, 7)}`;
			if (!state.loads.has(key)) {
				const url = new URL(cfg.availabilityUrl, location.href);
				url.searchParams.set('from', monthOf(month));
				url.searchParams.set('to', lastOf(month));
				if (mod) url.searchParams.set('modalite', mod);
				// Après un créneau pris (409), relecture de l'état réel : la réponse est mise en cache 30 s par le navigateur.
				const promise = fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: state.fresh ? 'no-cache' : 'default' })
					.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
					.then((data) => {
						if (!data || !Array.isArray(data.days)) throw new Error('Réponse inattendue');
						if (ISO.test(data.min || '')) state.meta.min = data.min;
						if (ISO.test(data.max || '')) state.meta.max = data.max;
						if (Number(data.duration) > 0) state.meta.duration = Number(data.duration);
						if (typeof data.autoConfirm === 'boolean' && data.autoConfirm !== state.meta.autoConfirm) {
							state.meta.autoConfirm = data.autoConfirm;
							updateTexts();
						}
						if (data.timezone) state.meta.timezone = String(data.timezone);
						data.days.forEach((d) => {
							if (!d || !ISO.test(d.date || '')) return;
							const slots = Array.isArray(d.slots) ? d.slots.filter((s) => s && typeof s.time === 'string').map((s) => ({ time: s.time, available: s.available !== false })) : [];
							state.days.set(`${mod}|${d.date}`, { status: STATUS_TEXT[d.status] ? d.status : 'closed', reason: d.reason || null, slots });
						});
						state.ready.add(key);
						return true;
					});
				state.loads.set(key, promise);
				promise.catch(() => state.loads.delete(key));
			}
			return state.loads.get(key);
		}
		function forgetAvailability() {
			state.fresh = true;
			state.loads.clear();
			state.ready.clear();
			state.days.clear();
		}

		const minMonth = () => monthOf(state.meta.min || today);
		const maxMonth = () => monthOf(state.meta.max || addMonths(today, 2));

		function renderGrid() {
			const m = state.month;
			// Région vivante : réécrite seulement si le mois change (sinon chaque flèche serait annoncée deux fois).
			const title = cap(monthLabel(m));
			if (monthTitle.textContent !== title) monthTitle.textContent = title;
			prevBtn.setAttribute('aria-disabled', String(m <= minMonth()));
			nextBtn.setAttribute('aria-disabled', String(m >= maxMonth()));
			const loading = !monthReady(m);
			grid.setAttribute('aria-busy', String(loading));
			cal.classList.toggle('is-loading', loading);
			const offset = weekday(m);
			const count = monthLength(m);
			const rows = [];
			let row = h('tr');
			for (let i = 0; i < offset; i++) row.append(h('td'));
			let focusable = '';
			const candidates = [];
			// Petit écran : les semaines entièrement avant le premier jour possible ne sont pas affichées (place gagnée
			// pour les jours et les heures disponibles).
			const hidePast = state.compact && ISO.test(state.meta.min || '');
			let rowFuture = !hidePast;
			for (let d = 1; d <= count; d++) {
				const iso = `${m.slice(0, 7)}-${pad(d)}`;
				const info = dayInfo(iso);
				const open = info.status === 'open';
				const selected = iso === state.date;
				// Nom complet (« jeudi 1er octobre 2026, date passée ») en aria-label : commence par le jour puis le texte
				// visible (critère 2.5.3) ; « 1er » lu « premier » (et non « 1 e r »).
				const date = fromIso(iso);
				const name = [longDate(iso), iso === today ? 'aujourd’hui' : '', info.status === 'loading' ? 'chargement' : statusText(iso, info), selected ? 'jour choisi' : ''].filter(Boolean).join(', ');
				if (!hidePast || iso >= state.meta.min) rowFuture = true;
				const btn = h(
					'button',
					{
						type: 'button',
						class: `o-cal__day is-${info.status}${iso === today ? ' is-today' : ''}${selected ? ' is-selected' : ''}`,
						'data-date': iso,
						tabindex: '-1',
						'aria-pressed': String(selected),
						'aria-disabled': open ? null : 'true',
						'aria-current': iso === today ? 'date' : null,
						'aria-label': name,
						'data-tip': open || info.status === 'loading' ? null : cap(statusText(iso, info)),
					},
					// Le 1er du mois s'écrit « 1er » (usage français) : le texte visible figure tel quel dans le nom (2.5.3).
					[h('span', { 'aria-hidden': 'true' }, d === 1 ? ['1', h('span', { class: 'o-cal__ord', text: 'er' })] : String(d))]
				);
				row.append(h('td', {}, btn));
				if (selected) focusable = iso;
				if (open) candidates.push(iso);
				if ((offset + d) % 7 === 0) {
					if (rowFuture) rows.push(row);
					row = h('tr');
					rowFuture = !hidePast;
				}
			}
			if (row.children.length) {
				while (row.children.length < 7) row.append(h('td'));
				rows.push(row);
			}
			tbody.replaceChildren(...rows);
			// Tabindex itinérant : jour suivi, jour choisi, premier jour disponible, aujourd'hui, 1er du mois.
			const inMonth = (iso) => iso && iso.slice(0, 7) === m.slice(0, 7);
			const roving = [state.focusDate, focusable, candidates[0], today, m].find(inMonth);
			const target = tbody.querySelector(`[data-date="${roving}"]`) || tbody.querySelector('.o-cal__day');
			if (target) target.tabIndex = 0;
		}

		/** Affiche un mois (chargement compris) ; renvoie false si le chargement a échoué. */
		async function showMonth(month) {
			const m = monthOf(month < minMonth() ? minMonth() : month > maxMonth() ? maxMonth() : month);
			state.month = m;
			calMsg.textContent = '';
			renderGrid();
			try {
				await loadMonth(m);
			} catch (e) {
				useFallback();
				return false;
			}
			if (state.month !== m) return true; // un autre mois a été demandé entre-temps
			renderGrid();
			const open = [...state.days.keys()].some((k) => k.startsWith(`${modalite()}|${m.slice(0, 7)}`) && state.days.get(k).status === 'open');
			if (!open) noAvailability(m);
			// Mois suivant chargé d'avance.
			if (m < maxMonth()) loadMonth(addMonths(m, 1)).catch(() => {});
			return true;
		}

		function noAvailability(m) {
			const next = addMonths(m, 1);
			calMsg.textContent = '';
			if (m < maxMonth()) {
				calMsg.append(`Plus aucune disponibilité en ${monthLabel(m)}. `);
				calMsg.append(h('button', { type: 'button', class: 'o-linkbutton', text: `Voir ${monthLabel(next)}`, onclick: () => showMonth(next).then(() => focusDay()) }));
			} else {
				calMsg.append(contactSentence('Aucun créneau n’est disponible en ligne sur cette période.'));
			}
		}
		function contactSentence(intro) {
			const p = h('span', { text: `${intro} ` });
			if (cabinet.phone && cabinet.tel) {
				p.append('Appelez-nous au ', h('a', { href: cabinet.tel, text: cabinet.phone }));
				if (cabinet.email) p.append(' ou écrivez à ', h('a', { href: `mailto:${cabinet.email}`, text: cabinet.email }));
				p.append(' pour convenir d’un rendez-vous.');
			}
			return p;
		}

		function focusDay(iso, preventScroll = false) {
			const btn = (iso && tbody.querySelector(`[data-date="${iso}"]`)) || tbody.querySelector('.o-cal__day[tabindex="0"]');
			if (btn) btn.focus({ preventScroll });
		}
		async function moveTo(iso) {
			// Petit écran : pas de déplacement vers une semaine masquée (entièrement avant le premier jour possible).
			const min = state.meta.min || '';
			const lo = state.compact && ISO.test(min) ? [minMonth(), addDays(min, -weekday(min))].sort()[1] : minMonth();
			const hi = lastOf(maxMonth());
			const target = iso < lo ? lo : iso > hi ? hi : iso;
			state.focusDate = target;
			if (target.slice(0, 7) !== state.month.slice(0, 7)) await showMonth(monthOf(target));
			else renderGrid();
			focusDay(target);
		}

		/** Premier jour disponible à partir d'un mois (au plus jusqu'à la fin de la période). */
		async function firstOpenDay(fromMonth) {
			for (let m = fromMonth, i = 0; m <= maxMonth() && i < 14; m = addMonths(m, 1), i++) {
				await loadMonth(m);
				for (let d = 1; d <= monthLength(m); d++) {
					const iso = `${m.slice(0, 7)}-${pad(d)}`;
					const info = state.days.get(dayKey(iso));
					if (info && info.status === 'open' && info.slots.some((s) => s.available)) return iso;
				}
			}
			return '';
		}

		function selectDay(iso, announce = true) {
			const info = dayInfo(iso);
			if (!info || info.status !== 'open') return false;
			state.date = iso;
			state.focusDate = iso;
			dateInput.value = iso;
			setError('date_souhaitee', '');
			renderGrid();
			const free = renderSlots(iso);
			calMsg.textContent = announce ? `${cap(longDate(iso))} : ${free ? `${free} heure${free > 1 ? 's' : ''} disponible${free > 1 ? 's' : ''}` : 'plus aucune heure disponible'}.` : '';
			refresh();
			return true;
		}

		function renderSlots(iso) {
			const info = state.days.get(dayKey(iso));
			slotBox.className = 'o-rdv-slots';
			slotLegend.textContent = `Heures disponibles le ${dayMonth(iso)}`;
			if (slotHint) slotHint.textContent = `Heure de début, heure de Bruxelles. Durée : ${state.meta.duration} minutes.`;
			const free = info ? info.slots.filter((s) => s.available) : [];
			if (state.slot && !free.some((s) => s.time === state.slot)) {
				if (info && state.slotWanted === state.slot) setError('creneau', `L’heure ${state.slot} n’est plus disponible ce jour-là : choisissez-en une autre.`);
				state.slot = '';
			}
			state.slotWanted = '';
			const groups = [
				['matin', 'Matin', free.filter((s) => isTime(s.time) && s.time < '12:00')],
				['apres-midi', 'Après-midi', free.filter((s) => isTime(s.time) && s.time >= '12:00')],
				['autres', 'Créneaux', free.filter((s) => !isTime(s.time))],
			].filter((g) => g[2].length);
			slotBox.replaceChildren(
				...groups.map(([key, title, list]) =>
					h('div', { class: 'o-rdv-slots__group', role: 'group', 'aria-labelledby': `${uid}-creneaux-${key}` }, [
						h('p', { class: 'o-rdv-slots__title', id: `${uid}-creneaux-${key}`, text: title }),
						h(
							'div',
							{ class: 'o-slots' },
							list.map((s) => {
								const id = `${uid}-creneau-${s.time.replace(':', 'h')}`;
								return h('label', { class: 'o-slot', for: id }, [
									h('input', { type: 'radio', id, name: 'creneau', value: s.time, required: true, checked: s.time === state.slot }),
									h('span', { text: slotLabels[s.time] || s.time }),
								]);
							})
						),
					])
				)
			);
			if (!free.length) slotBox.append(h('p', { class: 'o-rdv-slots__empty', text: 'Plus aucune heure disponible ce jour-là : choisissez un autre jour.' }));
			return free.length;
		}

		function slotsPlaceholder(text) {
			slotBox.className = 'o-rdv-slots';
			slotLegend.textContent = 'Heures disponibles';
			slotBox.replaceChildren(h('p', { class: 'o-rdv-slots__empty', text }));
		}
		function slotsLoading() {
			slotBox.className = 'o-rdv-slots is-loading';
			slotBox.replaceChildren(h('div', { class: 'o-slots', 'aria-hidden': 'true' }, Array.from({ length: 8 }, () => h('span', { class: 'o-rdv-skel o-rdv-skel--slot' }))));
		}

		/** API indisponible : champ date et créneaux du rendu serveur (le serveur revérifie au moment de l'envoi). */
		function useFallback() {
			if (state.fallback) return;
			state.fallback = true;
			dateWrap.classList.remove('is-calendar');
			cal.hidden = true;
			slotBox.className = original.slotClass;
			slotBox.innerHTML = original.slots;
			slotLegend.innerHTML = original.legend;
			if (slotHint) slotHint.textContent = original.hint;
			if (state.date) dateInput.value = state.date;
			if (state.slot) setRadio('creneau', state.slot);
			const notice = h('p', { class: 'o-rdv-fallback', role: 'status' }, [
				'Le calendrier des disponibilités n’a pas pu être chargé. Indiquez la date et l’heure souhaitées : nous vérifions la disponibilité à l’envoi. ',
				h('button', { type: 'button', class: 'o-linkbutton', text: 'Réessayer le calendrier', onclick: () => retryCalendar(notice) }),
			]);
			dateWrap.closest('.o-form__row').before(notice);
		}
		function retryCalendar(notice) {
			state.fallback = false;
			notice.remove();
			dateWrap.classList.add('is-calendar');
			cal.hidden = false;
			state.date = dateInput.value.trim() || state.date;
			state.slot = valueOf('creneau') || state.slot;
			enterDateStep();
		}

		/**
		 * Petit écran (ou fenêtre basse), arrivée à l'étape 3 : si les premières heures sont sous le pied collant (ou sous
		 * le bas de la zone visible), la page (ou le panneau) défile juste assez pour les montrer, sans jamais faire
		 * passer la semaine du jour choisi au-dessus du haut de la zone visible ; rien ne bouge quand elles sont déjà
		 * visibles. Si l'intitulé de l'étape, qui a le focus, sort alors de la zone visible, le focus passe au jour
		 * choisi (visible, son nom complet annonce la date) : jamais de focus hors de la vue.
		 */
		function showChosenWeek() {
			if (!state.compact) return;
			afterScroll(() => {
				// Le visiteur a déjà avancé (focus déplacé dans l'assistant) : on ne déplace plus la page sous ses yeux.
				const active = document.activeElement;
				if (state.step !== 3 || (active !== legends[2] && root.contains(active))) return;
				const day = tbody.querySelector('.o-cal__day.is-selected');
				const slot = slotBox.querySelector('.o-slot');
				if (!day || !slot) return;
				const box = scroller();
				// Haut de la zone visible : sous l'en-tête collant du site (scroll-padding-top de base.css), ou haut du panneau.
				const top = box ? box.getBoundingClientRect().top : pageTop();
				const bottom = docked() ? dock.getBoundingClientRect().top : box ? box.getBoundingClientRect().bottom : window.innerHeight;
				const need = slot.getBoundingClientRect().bottom - (bottom - 16);
				const room = day.closest('tr').getBoundingClientRect().top - top;
				if (!(need > 0 && room > 0)) return;
				const by = Math.min(need, room);
				// Page : défilement doux (base.css) suivi comme celui de smoothTo, pour mesurer la légende à sa fin seulement.
				if (!box) expectScroll(window.scrollY + by);
				(box || window).scrollBy({ top: by, behavior: 'auto' });
				afterScroll(() => {
					if (document.activeElement !== legends[2] || state.step !== 3) return;
					if (legends[2].getBoundingClientRect().top < top) focusDay(state.date, true);
				});
			});
		}

		/** Entrée dans l'étape 3 : mois du jour choisi (ou premier jour disponible), créneaux, vérifications. */
		async function enterDateStep(arrive = false) {
			if (state.fallback) return;
			const wanted = state.date;
			slotsLoading();
			const ok = await showMonth(wanted ? monthOf(wanted) : minMonth());
			if (!ok || state.fallback) return;
			if (wanted) {
				const info = dayInfo(wanted);
				if (info && info.status === 'open') {
					state.slotWanted = state.slot;
					selectDay(wanted, false);
					state.slotStale = false;
					if (arrive) showChosenWeek();
					return;
				}
				if (info) setError('date_souhaitee', `${cap(longDate(wanted))} n’est plus disponible : ${statusText(wanted, info)}. Choisissez un autre jour.`);
				state.date = '';
				dateInput.value = '';
			}
			state.slotStale = false;
			let first = '';
			try {
				first = await firstOpenDay(state.month);
			} catch (e) {
				useFallback();
				return;
			}
			if (first) {
				if (first.slice(0, 7) !== state.month.slice(0, 7)) await showMonth(monthOf(first));
				selectDay(first, false);
				if (arrive) showChosenWeek();
			} else {
				slotsPlaceholder('Aucune heure disponible pour le moment.');
				calMsg.replaceChildren(contactSentence('Aucun créneau n’est disponible en ligne pour le moment.'));
				refresh();
			}
		}

		prevBtn.addEventListener('click', () => {
			if (prevBtn.getAttribute('aria-disabled') !== 'true') showMonth(addMonths(state.month, -1));
		});
		nextBtn.addEventListener('click', () => {
			if (nextBtn.getAttribute('aria-disabled') !== 'true') showMonth(addMonths(state.month, 1));
		});
		tbody.addEventListener('click', (event) => {
			const btn = event.target.closest('.o-cal__day');
			if (!btn) return;
			const iso = btn.dataset.date;
			state.focusDate = iso;
			const info = dayInfo(iso);
			if (!info || info.status === 'loading') return;
			if (info.status !== 'open') {
				calMsg.textContent = `${cap(longDate(iso))} : ${statusText(iso, info)}.`;
				renderGrid();
				focusDay(iso);
				return;
			}
			selectDay(iso);
			focusDay(iso);
			// Petit écran : les heures sont sous le calendrier.
			const top = slotWrap.getBoundingClientRect().top;
			if (top > window.innerHeight - 160) slotWrap.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
		});
		tbody.addEventListener('keydown', (event) => {
			const btn = event.target.closest('.o-cal__day');
			if (!btn) return;
			const iso = btn.dataset.date;
			let to = '';
			switch (event.key) {
				case 'ArrowLeft':
					to = addDays(iso, -1);
					break;
				case 'ArrowRight':
					to = addDays(iso, 1);
					break;
				case 'ArrowUp':
					to = addDays(iso, -7);
					break;
				case 'ArrowDown':
					to = addDays(iso, 7);
					break;
				case 'Home':
					to = addDays(iso, -weekday(iso));
					break;
				case 'End':
					to = addDays(iso, 6 - weekday(iso));
					break;
				case 'PageUp':
				case 'PageDown': {
					const month = addMonths(iso, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
					to = `${month.slice(0, 7)}-${pad(Math.min(Number(iso.slice(8)), monthLength(month)))}`;
					break;
				}
				default:
					return;
			}
			event.preventDefault();
			moveTo(to);
		});

		/* ---------- Récapitulatif persistant et récapitulatif final ---------- */
		function choices() {
			const objet = checkedInput('objet');
			const mode = checkedInput('modalite');
			const profil = checkedInput('profil');
			const deja = checkedInput('deja_client');
			return {
				objet: labelOf(objet),
				mode: labelOf(mode),
				modeMeta: metaOf(mode),
				profil: profil ? profil.value : '',
				deja: deja ? labelOf(deja) : '',
				date: state.fallback ? valueOf('date_souhaitee') : state.date,
				slot: state.fallback ? valueOf('creneau') : state.slot,
			};
		}
		function summaryRows() {
			const c = choices();
			const date = ISO.test(c.date || '') ? c.date : '';
			return [
				['objet', 'Objet', c.objet, ''],
				['format', 'Format', c.mode, c.modeMeta],
				['date', 'Date et heure', date ? cap(longDate(date)) : '', c.slot ? `${timeText(c.slot, state.meta.duration)} (heure de Bruxelles)` : ''],
				['duree', 'Durée', `${state.meta.duration} minutes`, ''],
			];
		}
		function renderSummary() {
			const rows = summaryRows();
			const build = () =>
				rows.map(([key, label, value, sub]) =>
					h('div', { class: `o-rdv-summary__row${value ? '' : ' is-empty'}`, 'data-row': key }, [
						h('dt', {}, [h('span', { class: 'o-rdv-summary__icon', html: icon(key) }), label]),
						h('dd', {}, [h('span', { text: value || 'À choisir' }), sub ? h('span', { class: 'o-rdv-summary__sub', text: sub }) : null]),
					])
				);
			// Seules les lignes modifiées sont remplacées. Pas de région vivante : le choix est déjà annoncé par le contrôle
			// qui a le focus et par le message du calendrier.
			const fresh = build();
			fresh.forEach((row, i) => {
				const old = summaryList.children[i];
				if (!old) summaryList.append(row);
				else if (old.textContent !== row.textContent) old.replaceWith(row);
			});
			dockDetails.replaceChildren(h('p', { class: 'o-rdv-summary__note', text: noteText() }), h('dl', { class: 'o-rdv-summary__list' }, build()));
			const c = choices();
			// Date et heure d'abord : l'information la plus utile quand la ligne est tronquée.
			const line = [ISO.test(c.date || '') ? shortDate(c.date) : '', c.slot && isTime(c.slot) ? c.slot : '', c.objet].filter(Boolean).join(' · ');
			dockLine.textContent = line;
			dockSummary.hidden = !line;
			summaryNote.textContent = noteText();
		}
		// Demande (par défaut) ou réservation (confirmation automatique) : le titre du résumé le dit.
		function eyebrowText() {
			return state.meta.autoConfirm ? 'Votre rendez-vous' : 'Votre demande';
		}
		function detailsLabel() {
			return state.meta.autoConfirm ? 'Détail de votre rendez-vous' : 'Détail de votre demande';
		}
		const noteText = () =>
			state.meta.autoConfirm
				? 'Réservation en ligne : le créneau vous est réservé dès l’envoi, et la confirmation vous est envoyée par e-mail.'
				: 'Il s’agit d’une demande : notre équipe vous confirme le rendez-vous par e-mail ou par téléphone.';

		function renderRecap() {
			const c = choices();
			const get = (name) => valueOf(name).trim();
			const message = get('message');
			const blocks = [
				[1, 'Votre besoin', [['Objet', c.objet], ['Profil', c.profil], ['Déjà client', c.deja]]],
				[2, 'Format', [['Modalité', c.mode], [/\d/.test(c.modeMeta) ? 'Adresse' : 'Précision', c.modeMeta], ['Durée', `${state.meta.duration} minutes`]]],
				[3, 'Date et heure', [['Date', ISO.test(c.date || '') ? cap(longDate(c.date)) : c.date], ['Heure', c.slot ? `${timeText(c.slot, state.meta.duration)} (heure de Bruxelles)` : '']]],
				[
					4,
					'Vos coordonnées',
					[
						['Nom', get('nom')],
						['E-mail', get('email')],
						['Téléphone', get('telephone')],
						['Société', get('societe')],
						['Précisions', message.length > 180 ? `${message.slice(0, 180)}…` : message],
						['Newsletter', valueOf('newsletter') ? 'oui, inscription demandée' : ''],
					],
				],
			];
			recap.replaceChildren(
				...blocks.map(([n, title, rows]) =>
					h('section', { class: 'o-rdv-recap__block', 'aria-labelledby': `${uid}-recap-${n}` }, [
						h('div', { class: 'o-rdv-recap__head' }, [
							h('h3', { class: 'o-rdv-recap__title', id: `${uid}-recap-${n}`, text: title }),
							h('button', { type: 'button', class: 'o-rdv-recap__edit', onclick: () => edit(n) }, [h('span', { html: icon('edit') }), 'Modifier', h('span', { class: 'screen-reader-text', text: ` : ${title.toLowerCase()}` })]),
						]),
						h(
							'dl',
							{ class: 'o-rdv-recap__list' },
							rows.filter((r) => r[1]).map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })]))
						),
					])
				)
			);
			recapNote.replaceChildren(h('span', { html: icon('info') }), h('span', { text: noteText() }));
		}

		function updateTexts() {
			submitLabel();
			root.querySelectorAll('.o-rdv-dock__eyebrow, .o-rdv-summary__eyebrow').forEach((el) => (el.textContent = eyebrowText()));
			dockDetails.setAttribute('aria-label', detailsLabel());
			renderSummary();
			if (state.step === 5) renderRecap();
		}

		/* ---------- Barre d'étapes, boutons ---------- */
		function renderProgress() {
			progressList.replaceChildren(
				...STEP_TITLES.map((title, i) => {
					const n = i + 1;
					const done = n < state.step || (n <= state.maxStep && n !== state.step && !firstInvalidBefore(n + 1));
					const current = n === state.step;
					const num = h('span', { class: 'o-rdv-progress__num', 'aria-hidden': 'true', html: done && !current ? icon('check') : String(n) });
					const text = [num, h('span', { class: 'o-rdv-progress__label', text: title })];
					const sr = h('span', { class: 'screen-reader-text', text: current ? ' (étape en cours)' : done ? ' (terminée)' : ' (à venir)' });
					const reachable = !current && n <= state.maxStep;
					const inner = reachable
						? h('button', { type: 'button', class: 'o-rdv-progress__link', onclick: () => jump(n) }, [...text, sr])
						: h('span', { class: 'o-rdv-progress__link' }, [...text, sr]);
					return h('li', { class: `o-rdv-progress__item${current ? ' is-current' : ''}${done ? ' is-done' : ''}`, 'aria-current': current ? 'step' : null }, inner);
				})
			);
		}
		function submitLabel() {
			const last = state.step === 5;
			submit.textContent = last ? (state.meta.autoConfirm ? 'Confirmer le rendez-vous' : 'Envoyer ma demande') : state.editing ? 'Enregistrer et revenir au récapitulatif' : 'Continuer';
		}
		function renderNav() {
			back.hidden = state.step === 1;
			submitLabel();
		}

		/** Première étape (avant n) dont un champ obligatoire est manquant ou invalide, ou 0. */
		function firstInvalidBefore(n) {
			for (let s = 1; s < n && s <= 4; s++) if (validateStep(s, false)) return s;
			return 0;
		}

		function scrollToTop() {
			const scroller = root.closest('.o-rdv-dialog__body');
			if (scroller) {
				scroller.scrollTo({ top: 0, behavior: 'auto' });
				return;
			}
			// Haut de l'assistant caché sous l'en-tête fixe, ou trop bas dans l'écran : on y revient.
			const top = root.getBoundingClientRect().top;
			if (top < pageTop() - 1 || top > window.innerHeight * 0.6) smoothTo();
		}

		function go(n, focus = true) {
			state.step = Math.max(1, Math.min(5, n));
			state.maxStep = Math.max(state.maxStep, state.step);
			steps.forEach((el, i) => (el.hidden = i + 1 !== state.step));
			root.dataset.step = String(state.step);
			setStatus('', '');
			placeStatus(docked());
			if (state.step === 3) state.dateStep = enterDateStep(focus);
			if (state.step === 4) getToken().catch(() => {});
			if (state.step === 5) renderRecap();
			renderNav();
			renderProgress();
			renderSummary();
			save();
			if (focus) {
				scrollToTop();
				legends[state.step - 1].focus({ preventScroll: true });
			}
		}

		function next() {
			if (state.sending) return;
			const invalid = validateStep(state.step);
			if (invalid) {
				setStatus('error', state.step === 3 && invalid === 'creneau' && valueOf('date_souhaitee') ? F.creneau : M.invalid);
				focusField(invalid);
				return;
			}
			if (state.editing) {
				const first = firstInvalidBefore(5);
				if (!first && !(state.step === 2 && state.slotStale)) {
					state.editing = false;
					go(5);
					return;
				}
			}
			go(state.step + 1);
		}
		// Pendant l'envoi, aucune navigation : la demande part avec les choix du récapitulatif (les boutons restent
		// focalisables, aria-disabled, pour que le focus ne soit pas perdu).
		function previous() {
			if (state.sending) return;
			if (state.step > 1) go(state.step - 1);
		}
		function jump(n) {
			if (state.sending) return;
			const first = firstInvalidBefore(n);
			go(first || n);
		}
		function edit(n) {
			if (state.sending) return;
			state.editing = true;
			go(n);
		}

		/* ---------- Mémorisation (choix non personnels uniquement) ---------- */
		const storageKey = cfg.storageKey || 'oracio-rdv';
		function save() {
			if (state.done) return;
			const data = { v: 1, step: Math.min(state.step, 4), date: state.date || (state.fallback ? valueOf('date_souhaitee') : ''), creneau: state.slot || (state.fallback ? valueOf('creneau') : '') };
			KEEP.forEach((k) => (data[k] = valueOf(k)));
			try {
				sessionStorage.setItem(storageKey, JSON.stringify(data));
			} catch (e) {
				/* stockage indisponible (navigation privée, réglages) : sans conséquence */
			}
		}
		function restore() {
			try {
				const data = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
				return data && data.v === 1 ? data : null;
			} catch (e) {
				return null;
			}
		}
		function forget() {
			try {
				sessionStorage.removeItem(storageKey);
			} catch (e) {
				/* rien à faire */
			}
		}

		/** Valeurs initiales explicites (lien, URL) : listes blanches, comme côté serveur. */
		function normalize(prefill) {
			const out = {};
			if (!prefill || typeof prefill !== 'object') return out;
			['objet', 'modalite'].forEach((k) => {
				const v = typeof prefill[k] === 'string' ? prefill[k].trim() : '';
				if (v && inputsOf(k).some((i) => i.value === v)) out[k] = v;
			});
			const p = typeof prefill.profil === 'string' ? prefill.profil.trim() : '';
			const profiles = cfg.profiles || {};
			const label = profiles[p.toLowerCase()] || p;
			if (label && inputsOf('profil').some((i) => i.value === label)) out.profil = label;
			return out;
		}
		function applyPrefill(values) {
			Object.entries(values).forEach(([k, v]) => {
				if (k === 'modalite' && v !== valueOf('modalite')) state.slotStale = true;
				setRadio(k, v);
				setError(k, '');
			});
		}

		/* ---------- Jeton anti-robot (demandé dès les premières interactions) ---------- */
		let tokenPromise = null;
		let tokenAt = 0;
		function getToken() {
			if (!tokenPromise || Date.now() - tokenAt > 90 * 60 * 1000) {
				tokenAt = Date.now();
				tokenPromise = fetch(cfg.tokenUrl, { credentials: 'same-origin', cache: 'no-store' })
					.then((r) => r.json())
					.then((d) => (d && d.token ? d.token : Promise.reject(new Error('jeton'))));
				tokenPromise.catch(() => (tokenPromise = null));
			}
			return tokenPromise;
		}

		/* ---------- Envoi ---------- */
		async function send() {
			if (state.sending) return;
			const first = firstInvalidBefore(5);
			if (first) {
				go(first);
				validateStep(first);
				setStatus('error', M.invalid);
				focusField(validateStep(first, false));
				return;
			}
			state.sending = true;
			root.setAttribute('data-o-rdv-sending', '');
			if (opts.onSending) opts.onSending(true);
			// aria-disabled plutôt que disabled : un bouton désactivé perdrait le focus (renvoyé sur la page) pendant tout
			// l'envoi ; ici le focus reste sur « Envoyer », et l'envoi est annoncé par la zone de statut.
			submit.setAttribute('aria-busy', 'true');
			submit.setAttribute('aria-disabled', 'true');
			back.setAttribute('aria-disabled', 'true');
			submit.textContent = 'Envoi en cours…';
			setStatus('', 'Envoi en cours…');
			try {
				form.elements.jeton.value = await getToken();
				// Délai minimal anti-robot : le jeton doit avoir au moins 3 secondes.
				const wait = 3100 - (Date.now() - tokenAt);
				if (wait > 0) await sleep(wait);
				const response = await fetch(cfg.endpoint, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams(new FormData(form)),
				});
				const data = await response.json().catch(() => ({}));
				if (response.ok && data.ok) {
					success(data);
					return;
				}
				// Jeton refusé ou consommé : un nouveau sera demandé au prochain envoi.
				if (response.status !== 422) tokenPromise = null;
				if (response.status === 409) {
					await conflict(data);
					return;
				}
				const errors = data.errors && typeof data.errors === 'object' ? data.errors : {};
				const names = Object.keys(errors);
				if (names.length) {
					names.forEach((name) => setError(name, String(errors[name])));
					const stepOf = (name) => Number(Object.keys(STEP_FIELDS).find((s) => STEP_FIELDS[s].includes(name))) || 5;
					const target = names.map(stepOf).sort((a, b) => a - b)[0];
					if (target < 5) {
						go(target);
						names.forEach((name) => setError(name, String(errors[name])));
						setStatus('error', data.message || M.invalid);
						const firstName = STEP_FIELDS[target].find((n) => errors[n]);
						if (firstName) focusField(firstName);
						return;
					}
				}
				setStatus('error', data.message || M.error, [], true);
			} catch (e) {
				tokenPromise = null;
				setStatus('error', `${M.error || 'Une erreur est survenue.'} Vérifiez votre connexion.`, [], true);
			} finally {
				state.sending = false;
				root.removeAttribute('data-o-rdv-sending');
				if (opts.onSending) opts.onSending(false);
				submit.removeAttribute('aria-busy');
				submit.removeAttribute('aria-disabled');
				back.removeAttribute('aria-disabled');
				if (!state.done) submitLabel();
			}
		}

		/** Créneau pris entre-temps (409) : retour à l'étape 3, disponibilités rechargées, message. */
		async function conflict(data) {
			const message = (data.errors && data.errors.creneau) || data.message || 'Ce créneau vient d’être pris : choisissez-en un autre.';
			forgetAvailability();
			state.slot = '';
			state.slotWanted = '';
			inputsOf('creneau').forEach((i) => (i.checked = false));
			go(3, false);
			scrollToTop();
			setStatus('error', message);
			// enterDateStep (lancé par go) recharge le mois et les heures du jour choisi.
			await state.dateStep.catch(() => {});
			setStatus('error', message);
			setError('creneau', message);
			const firstSlot = slotBox.querySelector('input[name="creneau"]');
			if (firstSlot) firstSlot.focus();
			else legends[2].focus();
			save();
		}

		function success(data) {
			state.done = true;
			forget();
			const s = data.summary && typeof data.summary === 'object' ? data.summary : {};
			const c = choices();
			const confirmed = data.status === 'confirme';
			const duration = Number(s.duree) || state.meta.duration;
			const date = ISO.test(s.date || '') ? s.date : c.date;
			const slot = s.creneau || c.slot;
			const rows = [
				['Objet', s.objet || c.objet],
				['Format', s.modalite || c.mode],
				['Adresse', s.adresse || (s.modalite ? '' : /\d/.test(c.modeMeta) ? c.modeMeta : '')],
				['Date', s.dateLabel ? cap(s.dateLabel) : ISO.test(date || '') ? cap(longDate(date)) : ''],
				['Heure', slot ? `${timeText(slot, duration)} (heure de Bruxelles)` : ''],
				['Durée', `${duration} minutes`],
			].filter((r) => r[1]);
			const nextSteps = confirmed
				? ['Votre rendez-vous est réservé : vous n’avez rien d’autre à faire.', 'Un empêchement ? Prévenez-nous dès que possible pour libérer le créneau.']
				: [
						'Notre équipe examine votre demande et vous confirme le rendez-vous par e-mail ou par téléphone.',
						'Tant que vous n’avez pas reçu cette confirmation, le rendez-vous n’est pas réservé.',
						'Besoin de modifier ou d’annuler votre demande ? Contactez-nous.',
					];
			const contact = h('p', { class: 'o-rdv-done__contact' });
			if (cabinet.phone && cabinet.tel) contact.append(h('span', { html: icon('phone') }), h('a', { href: cabinet.tel, text: cabinet.phone }));
			if (cabinet.email) contact.append(h('span', { html: icon('mail') }), h('a', { href: `mailto:${cabinet.email}`, text: cabinet.email }));
			const title = h('h3', { class: 'o-rdv-done__title', tabindex: '-1', text: confirmed ? 'Votre rendez-vous est réservé' : 'Votre demande est envoyée' });
			const buttons = h('div', { class: 'o-rdv-done__actions' });
			if (opts.close) buttons.append(h('button', { type: 'button', class: 'o-btn', text: 'Fermer', onclick: () => opts.close() }));
			else buttons.append(h('button', { type: 'button', class: 'o-btn o-btn--outline', text: 'Faire une autre demande', onclick: () => location.reload() }));
			const panel = h('div', { class: 'o-rdv-done' }, [
				h('div', {
					class: 'o-rdv-done__mark',
					'aria-hidden': 'true',
					html: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none"><circle class="o-rdv-done__ring" cx="32" cy="32" r="29" stroke="currentColor" stroke-width="3"/><path class="o-rdv-done__tick" d="m20 33 8 8 16-17" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
				}),
				title,
				h('p', { class: 'o-rdv-done__lead', text: data.message || '' }),
				data.ack ? h('p', { class: 'o-rdv-done__extra', text: data.ack }) : null,
				data.newsletter ? h('p', { class: 'o-rdv-done__extra', text: data.newsletter }) : null,
				h('dl', { class: 'o-rdv-done__summary' }, rows.map(([k, v]) => h('div', {}, [h('dt', { text: k }), h('dd', { text: v })]))),
				h('h4', { class: 'o-rdv-done__next-title', text: 'Et maintenant ?' }),
				h('ol', { class: 'o-rdv-done__steps' }, nextSteps.map((t) => h('li', { text: t }))),
				contact,
				buttons,
			]);
			layout.hidden = true;
			root.classList.add('is-done');
			root.append(panel);
			syncDock();
			// Données saisies retirées de la page (le formulaire n'est plus utilisé).
			form.reset();
			const scroller = root.closest('.o-rdv-dialog__body');
			if (scroller) scroller.scrollTo({ top: 0 });
			else scrollToTop();
			title.focus({ preventScroll: !!scroller });
			if (opts.onDone) opts.onDone();
			root.dispatchEvent(new CustomEvent('oracio:booking-sent', { bubbles: true, detail: { status: confirmed ? 'confirme' : 'a_confirmer' } }));
		}

		/* ---------- Événements du formulaire ---------- */
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			if (state.step < 5) next();
			else send();
		});
		// Entrée sur une carte, une pastille ou une case : étape suivante (les champs texte le font déjà).
		form.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return;
			if (event.target.matches('input[type="radio"], input[type="checkbox"]')) {
				event.preventDefault();
				if (state.step < 5) next();
			}
		});
		form.addEventListener('change', (event) => {
			const name = event.target.name;
			if (!name) return;
			if (name === 'creneau') state.slot = valueOf('creneau');
			if (name === 'date_souhaitee' && state.fallback) state.date = dateInput.value.trim();
			if (name === 'modalite') {
				state.slotStale = true;
				// Disponibilités de la nouvelle modalité chargées d'avance.
				if (!state.fallback) loadMonth(state.date ? monthOf(state.date) : minMonth()).catch(() => {});
			}
			if (hasError(name) && !check(name) && !(pressing && STEP_FIELDS[4].includes(name))) setError(name, '');
			refresh();
		});
		// Coordonnées : contrôle à la sortie du champ (après une saisie), puis au fil de la frappe.
		form.addEventListener('input', (event) => {
			const name = event.target.name;
			if (!STEP_FIELDS[4].includes(name)) return;
			event.target.dataset.oEdited = '1';
			if (state.touched.has(name) || hasError(name)) setError(name, check(name));
		});
		// Appui en cours sur Retour / Continuer : pas de contrôle à la sortie du champ. Un message qui apparaît ou
		// disparaît à ce moment déplacerait le bouton sous le pointeur et le clic serait perdu ; le bouton contrôle tout.
		// La sortie du champ a lieu à l'appui (pointerdown) : le relâchement suffit à lever la garde.
		let pressing = false;
		dock.addEventListener('pointerdown', () => (pressing = true));
		['pointerup', 'pointercancel'].forEach((type) => document.addEventListener(type, () => (pressing = false), true));
		form.addEventListener('focusout', (event) => {
			const name = event.target.name;
			if (pressing || !STEP_FIELDS[4].includes(name) || event.target.dataset.oEdited !== '1') return;
			state.touched.add(name);
			setError(name, check(name));
		});
		// Jeton demandé dès la première interaction.
		root.addEventListener('focusin', () => getToken().catch(() => {}), { once: true });
		root.addEventListener('pointerdown', () => getToken().catch(() => {}), { once: true });

		function refresh() {
			renderSummary();
			save();
		}

		/* ---------- Démarrage ---------- */
		const stored = restore();
		const explicit = { ...normalize(cfg.prefill), ...normalize(opts.prefill) };
		if (stored) {
			KEEP.forEach((k) => {
				if (!(k in explicit) && stored[k]) setRadio(k, stored[k]);
			});
			if (ISO.test(stored.date || '')) state.date = stored.date;
			if (typeof stored.creneau === 'string') state.slot = stored.creneau;
		}
		applyPrefill(explicit);
		if (!state.date && ISO.test(dateInput.value || '')) state.date = dateInput.value;
		if (!state.slot) state.slot = valueOf('creneau');
		inputsOf('creneau').forEach((i) => (i.checked = false));
		dateInput.value = state.date;
		// Reprise à l'étape mémorisée si les étapes précédentes sont complètes.
		let start = 1;
		if (stored && stored.step > 1) {
			// Au plus l'étape 3 : la date et l'heure mémorisées sont revérifiées avec les disponibilités du moment.
			start = Math.min(Number(stored.step) || 1, 3);
			const missing = firstInvalidBefore(start);
			if (missing) start = missing;
		}
		state.maxStep = start;
		state.compact = isCompact();
		go(start, !!opts.focus);
		syncDock();

		return {
			root,
			/** Affiche l'assistant (page Contact ou panneau rouvert) avec d'éventuelles valeurs initiales. */
			reveal(prefill) {
				if (state.done) {
					const done = root.querySelector('.o-rdv-done__title');
					if (!root.closest('dialog')) smoothTo();
					if (done) done.focus({ preventScroll: true });
					return;
				}
				// Envoi en cours : les choix ne changent plus (la demande est partie avec ceux du récapitulatif).
				const values = state.sending ? {} : normalize(prefill);
				applyPrefill(values);
				refresh();
				if (state.step === 3 && values.modalite) enterDateStep();
				if (!root.closest('dialog')) {
					smoothTo();
				}
				legends[state.step - 1].focus({ preventScroll: true });
			},
		};
	}

	/* =====================================================================
	 * Montage
	 * ================================================================== */
	function mount(root, opts = {}) {
		if (!root) return null;
		if (root.oracioBooking) return root.oracioBooking;
		let cfg = null;
		try {
			cfg = JSON.parse((root.querySelector('[data-o-rdv-config]') || {}).textContent || 'null');
		} catch (e) {
			cfg = null;
		}
		const form = root.querySelector('form[data-o-form="booking"]');
		if (!cfg || !form || !form.querySelector('.o-form__submit')) return null;
		try {
			root.oracioBooking = createWizard(root, form, cfg, opts);
		} catch (e) {
			// Échec de la mise en place : le formulaire classique reste utilisable (envoi admin-post).
			root.classList.remove('is-enhanced');
			return null;
		}
		return root.oracioBooking;
	}

	window.OracioBooking = { mount };
	document.querySelectorAll('[data-o-rdv-wizard]').forEach((root) => mount(root, { focus: false }));
})();
