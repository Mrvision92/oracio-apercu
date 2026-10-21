/**
 * Aperçu statique du site Oracio (GitHub Pages) : simule l'API WordPress dans le navigateur
 * pour que les formulaires, le parcours de rendez-vous et le bandeau cookies fonctionnent
 * comme sur le site final. RIEN n'est envoyé : aucune demande ne quitte le navigateur.
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

	const availability = (url) => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const min = new Date(today);
		do min.setDate(min.getDate() + 1);
		while ([0, 6].includes(min.getDay()) || holidays(min.getFullYear())[iso(min)]);
		const max = new Date(today);
		max.setDate(max.getDate() + 60);
		const from = parse(url.searchParams.get('from') || iso(today));
		const to = parse(url.searchParams.get('to') || iso(max));
		const days = [];
		for (const d = new Date(from); d <= to && days.length < 62; d.setDate(d.getDate() + 1)) {
			const key = iso(d);
			const holiday = holidays(d.getFullYear())[key];
			let status = 'open';
			let reason = null;
			if (d < min || d > max) status = 'out_of_range';
			else if ([0, 6].includes(d.getDay())) status = 'closed';
			else if (holiday) {
				status = 'holiday';
				reason = holiday;
			}
			days.push({ date: key, status, reason, slots: status === 'open' ? slots.map((time) => ({ time, available: true })) : [] });
		}
		return { timezone: 'Europe/Brussels', duration: 30, slotMinutes: 30, min: iso(min), max: iso(max), autoConfirm: false, days };
	};

	const labelOf = (name, value) => {
		const input = [...document.querySelectorAll(`[name="${name}"]`)].find((el) => el.value === value);
		if (!input) return value;
		if (input.tagName === 'OPTION' || input.tagName === 'SELECT') return input.selectedOptions?.[0]?.textContent.trim() || value;
		const label = input.closest('label') || document.querySelector(`label[for="${input.id}"]`);
		return label ? label.textContent.trim().split('\n')[0].trim() : value;
	};

	window.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === 'string' ? input : input.url, location.href);
		if (!url.pathname.includes('/wp-json/')) return realFetch(input, init);
		const route = url.pathname.split('/wp-json/')[1].replace(/\/$/, '');
		if (route.startsWith('oracio/v1/form-token')) return json({ token: 'apercu' });
		if (route.startsWith('oracio/v1/booking/form')) return realFetch(`${prefix}/wp-json/oracio/v1/booking/form.json`);
		if (route.startsWith('oracio/v1/booking/availability')) return json(availability(url));
		if (route.startsWith('oracio/v1/consent')) return json({ ok: true });
		if (route.startsWith('oracio/v1/forms/')) {
			const params = new URLSearchParams(typeof init.body === 'string' || init.body instanceof URLSearchParams ? init.body : '');
			await new Promise((resolve) => setTimeout(resolve, 600));
			const date = params.get('date_souhaitee') || '';
			const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parse(date) : null;
			return json({
				ok: true,
				status: 'a_confirmer',
				message: 'Aperçu de démonstration : aucune demande n’a été envoyée. Sur le site en ligne, le cabinet reçoit votre demande par e-mail.',
				summary: {
					objet: labelOf('objet', params.get('objet') || ''),
					modalite: labelOf('modalite', params.get('modalite') || ''),
					adresse: null,
					date,
					dateLabel: day ? day.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : date,
					creneau: params.get('creneau') || '',
					duree: 30,
				},
			});
		}
		return json({});
	};
})();
