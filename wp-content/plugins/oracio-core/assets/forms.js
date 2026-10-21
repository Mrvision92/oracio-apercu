/**
 * Oracio — envoi des formulaires sans rechargement (contact, rappel, demande de rendez-vous).
 * La validation définitive est faite par le serveur ; ce script affiche ses réponses telles quelles
 * (succès uniquement si la demande a réellement été enregistrée et transmise).
 * Les messages d'erreur viennent du serveur (window.OracioForms.fields) : mêmes textes des deux côtés.
 * Sans JavaScript, le formulaire est envoyé normalement (admin-post) et le résultat s'affiche au retour.
 */
(() => {
	const cfg = window.OracioForms;
	if (!cfg) return;
	const F = cfg.fields || {};
	const fill = (text, value) => String(text || '').replace('%s', value || '');

	/* ---------- Contrôle de la date souhaitée (jours ouvrés, fenêtre, jours fériés et fermetures) ---------- */
	// Date saisie → « AAAA-MM-JJ », ou '' si elle est invalide. Comme le serveur (oracio_booking_parse_date) :
	// format du champ date, ou JJ/MM/AAAA (JJ.MM.AAAA, JJ-MM-AAAA) dans les navigateurs sans calendrier.
	function isoDate(raw) {
		const value = String(raw || '').trim();
		let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		let y, mo, d;
		if (m) [, y, mo, d] = m.map(Number);
		else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value))) [, d, mo, y] = m.map(Number);
		else return '';
		const date = new Date(y, mo - 1, d);
		if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return '';
		return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function checkDate(raw, input) {
		if (!String(raw || '').trim()) return F.date_required;
		const value = isoDate(raw);
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		const min = input.min || '';
		if (!m) return fill(F.date_invalid, min ? `${min.slice(8, 10)}/${min.slice(5, 7)}/${min.slice(0, 4)}` : '');
		if (min && value < min) return fill(F.date_too_soon, input.dataset.oMinLabel);
		if (input.max && value > input.max) return fill(F.date_too_late, input.dataset.oMaxLabel);
		const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() || 7;
		const open = (input.dataset.oDays || '1,2,3,4,5').split(',').map(Number);
		if (!open.includes(day)) return fill(F.date_weekday, input.dataset.oDaysLabel);
		let blocked = {};
		try {
			blocked = JSON.parse(input.dataset.oBlocked || '{}');
		} catch (e) {
			blocked = {};
		}
		if (Object.prototype.hasOwnProperty.call(blocked, value)) {
			return blocked[value] ? fill(F.date_holiday, blocked[value]) : F.date_closure;
		}
		return '';
	}

	// Contrôles immédiats (le serveur revérifie tout) : renvoient '' si la valeur convient.
	const checks = {
		objet: (v) => (v ? '' : F.objet),
		modalite: (v) => (v ? '' : F.modalite),
		date_souhaitee: checkDate,
		creneau: (v) => (v ? '' : F.creneau),
		nom: (v) => (v.trim() ? '' : F.nom),
		email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : F.email),
		telephone: (v) => (v.replace(/\D/g, '').length >= 8 ? '' : F.telephone),
		message: (v) => (v.trim().length >= 5 ? '' : F.message),
		consentement: (v) => (v ? '' : F.consentement),
	};
	// Champs facultatifs contrôlés quand ils sont remplis (format).
	const formatOnly = ['email', 'telephone', 'date_souhaitee'];

	/* ---------- Accès aux champs (champ simple, case à cocher ou groupe de boutons radio) ---------- */
	function control(form, name) {
		const wrap = form.querySelector(`[data-field="${name}"]`);
		if (!wrap) return null;
		const inputs = Array.from(wrap.querySelectorAll('input, select, textarea'));
		if (!inputs.length) return null;
		const group = wrap.getAttribute('role') === 'radiogroup';
		return { name, wrap, inputs, first: inputs[0], group };
	}
	function valueOf(c) {
		if (c.group) return (c.inputs.find((i) => i.checked) || {}).value || '';
		if (c.first.type === 'checkbox') return c.first.checked ? c.first.value : '';
		return c.first.value;
	}
	const isRequired = (c) => (c.group ? c.wrap.getAttribute('aria-required') === 'true' : c.first.required);
	const focusTarget = (c) => (c.group ? c.inputs.find((i) => i.checked) || c.first : c.first);

	function check(c) {
		const fn = checks[c.name];
		if (!fn) return '';
		const value = valueOf(c);
		if (!isRequired(c) && (!value || !formatOnly.includes(c.name))) return '';
		return fn(value, c.first) || '';
	}

	function setError(form, name, message) {
		const c = control(form, name);
		if (!c) return;
		c.wrap.classList.toggle('has-error', !!message);
		// Groupe de boutons radio : l'état invalide est porté par le groupe (rôle radiogroup).
		const target = c.group ? c.wrap : c.first;
		if (message) target.setAttribute('aria-invalid', 'true');
		else target.removeAttribute('aria-invalid');
		const error = c.wrap.querySelector('.o-field__error');
		if (error) {
			error.textContent = message || '';
			error.hidden = !message;
		}
	}

	function setStatus(form, kind, message, extras = []) {
		const status = form.querySelector('.o-form__status');
		status.className = `o-form__status${kind ? ` is-${kind}` : ''}`;
		status.textContent = '';
		if (message) {
			const span = document.createElement('span');
			span.textContent = message;
			status.appendChild(span);
		}
		extras.filter(Boolean).forEach((text) => {
			status.appendChild(document.createTextNode(' '));
			const span = document.createElement('span');
			span.className = 'o-form__status-extra';
			span.textContent = text;
			status.appendChild(span);
		});
		if (message) status.focus();
	}

	const fieldNames = (form) => Array.from(form.querySelectorAll('[data-field]'), (el) => el.dataset.field);

	function firstInvalid(form) {
		for (const name of fieldNames(form)) {
			const c = control(form, name);
			if (c && c.wrap.classList.contains('has-error')) return focusTarget(c);
		}
		return null;
	}

	document.querySelectorAll('form[data-o-form]').forEach((form) => {
		// Demande de rendez-vous transformée en assistant par assets/booking.js (classe is-enhanced) : ce script s'efface,
		// l'assistant gère contrôles, calendrier et envoi. Si booking.js ne se charge pas, ce script garde le formulaire
		// complet (contrôles immédiats, envoi sans rechargement) ; sans JavaScript, envoi classique (admin-post).
		const wizard = () => !!form.closest('.o-rdv.is-enhanced');
		const type = form.dataset.oForm;
		const button = form.querySelector('button[type="submit"]');
		let tokenPromise = null;
		let tokenAt = 0;
		// Le jeton est demandé dès que la personne commence à remplir le formulaire.
		const getToken = () => {
			if (!tokenPromise) {
				tokenAt = Date.now();
				tokenPromise = fetch(cfg.tokenUrl, { credentials: 'same-origin', cache: 'no-store' })
					.then((r) => r.json())
					.then((d) => d.token)
					.catch((e) => {
						tokenPromise = null;
						throw e;
					});
			}
			return tokenPromise;
		};
		form.addEventListener('focusin', () => wizard() || getToken().catch(() => {}), { once: true });

		// Correction en cours de saisie : l'erreur disparaît dès que la valeur convient.
		const recheck = (event) => {
			if (wizard()) return;
			const wrap = event.target.closest('[data-field]');
			if (!wrap) return;
			const c = control(form, wrap.dataset.field);
			if (!c) return;
			if (wrap.classList.contains('has-error') && !check(c)) setError(form, c.name, '');
			// Date : jour non ouvré signalé immédiatement.
			if (event.type === 'change' && c.name === 'date_souhaitee' && valueOf(c)) setError(form, c.name, check(c));
		};
		form.addEventListener('input', recheck);
		form.addEventListener('change', recheck);

		form.addEventListener('submit', async (event) => {
			if (wizard()) return;
			event.preventDefault();
			if (button.getAttribute('aria-busy') === 'true') return;

			// Contrôles immédiats (le serveur revérifie tout).
			let first = null;
			fieldNames(form).forEach((name) => {
				const c = control(form, name);
				if (!c) return;
				const message = check(c);
				setError(form, name, message);
				if (message && !first) first = focusTarget(c);
			});
			if (first) {
				setStatus(form, 'error', cfg.messages.invalid);
				first.focus();
				return;
			}

			button.setAttribute('aria-busy', 'true');
			button.disabled = true;
			const label = button.textContent;
			button.textContent = 'Envoi en cours…';
			setStatus(form, '', '');

			try {
				form.elements.jeton.value = await getToken();
				// Délai minimal anti-robot : le jeton doit avoir au moins 3 secondes.
				const wait = 3100 - (Date.now() - tokenAt);
				if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

				const body = new URLSearchParams(new FormData(form));
				const response = await fetch(cfg.endpoint + type, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body,
				});
				const data = await response.json().catch(() => ({}));
				fieldNames(form).forEach((name) => setError(form, name, (data.errors || {})[name] || ''));

				if (response.ok && data.ok) {
					form.reset();
					tokenPromise = null;
					setStatus(form, 'success', data.message, [data.ack, data.newsletter]);
					form.dispatchEvent(new CustomEvent('oracio:form-sent', { bubbles: true, detail: { form: type } }));
				} else {
					// Jeton refusé (expiré, trop récent, déjà utilisé) ou consommé (limite d'envois atteinte) :
					// un nouveau jeton sera demandé au prochain envoi.
					if (response.status === 400 || response.status === 429) tokenPromise = null;
					setStatus(form, 'error', data.message || cfg.messages.error);
					const invalid = firstInvalid(form);
					if (invalid) invalid.focus();
				}
			} catch (e) {
				setStatus(form, 'error', cfg.messages.error);
			} finally {
				button.removeAttribute('aria-busy');
				button.disabled = false;
				button.textContent = label;
			}
		});
	});
})();
