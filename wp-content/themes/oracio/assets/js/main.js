/**
 * Oracio — interactions de l'interface : en-tête, panneaux de navigation, menu mobile,
 * sommaire des articles. Aucune dépendance.
 */
(() => {
	const header = document.querySelector('[data-o-header]');

	/* En-tête : filet inférieur une fois la page défilée */
	if (header) {
		const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
	}

	/* Panneaux de navigation (motif « disclosure ») */
	const toggles = [...document.querySelectorAll('.o-nav__toggle')];
	const closePanels = (except) => {
		toggles.forEach((btn) => {
			if (btn === except) return;
			btn.setAttribute('aria-expanded', 'false');
			const panel = document.getElementById(btn.getAttribute('aria-controls'));
			if (panel) panel.hidden = true;
		});
	};
	toggles.forEach((btn) => {
		const panel = document.getElementById(btn.getAttribute('aria-controls'));
		if (!panel) return;
		btn.addEventListener('click', () => {
			const open = btn.getAttribute('aria-expanded') === 'true';
			closePanels(btn);
			btn.setAttribute('aria-expanded', String(!open));
			panel.hidden = open;
		});
		btn.parentElement.addEventListener('keydown', (event) => {
			if (event.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
				closePanels();
				btn.focus();
			}
		});
		btn.parentElement.addEventListener('focusout', (event) => {
			if (!btn.parentElement.contains(event.relatedTarget) && event.relatedTarget) {
				btn.setAttribute('aria-expanded', 'false');
				panel.hidden = true;
			}
		});
	});
	document.addEventListener('click', (event) => {
		if (!event.target.closest('.o-nav__item.has-panel')) closePanels();
	});

	/* Menu mobile */
	const drawer = document.querySelector('[data-o-drawer]');
	const drawerToggle = document.querySelector('[data-o-drawer-toggle]');
	if (drawer && drawerToggle) {
		const label = drawerToggle.querySelector('.o-header__menu-label');
		const setOpen = (open) => {
			drawer.hidden = !open;
			drawerToggle.setAttribute('aria-expanded', String(open));
			if (label) label.textContent = open ? 'Fermer' : 'Menu';
			document.body.classList.toggle('o-locked', open);
			if (open) {
				const first = drawer.querySelector('a, button');
				if (first) first.focus();
			}
		};
		drawerToggle.addEventListener('click', () => setOpen(drawer.hidden));
		drawer.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				setOpen(false);
				drawerToggle.focus();
			}
			if (event.key === 'Tab') {
				// Le focus reste dans le menu ouvert (le bouton de fermeture inclus).
				const items = [drawerToggle, ...drawer.querySelectorAll('a, button')];
				const first = items[0];
				const last = items[items.length - 1];
				if (event.shiftKey && document.activeElement === drawer.querySelector('a, button')) {
					event.preventDefault();
					first.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
			}
		});
		drawerToggle.addEventListener('keydown', (event) => {
			if (event.key === 'Tab' && !event.shiftKey && !drawer.hidden) {
				event.preventDefault();
				const first = drawer.querySelector('a, button');
				if (first) first.focus();
			}
		});
		window.matchMedia('(min-width: 1140px)').addEventListener('change', (mq) => {
			if (mq.matches) setOpen(false);
		});
	}

	/* Avis : défilement par boutons (le défilement tactile reste disponible) */
	document.querySelectorAll('.o-reviews').forEach((wrap) => {
		const list = wrap.querySelector('.o-reviews__list');
		const prev = wrap.querySelector('[data-o-reviews-prev]');
		const next = wrap.querySelector('[data-o-reviews-next]');
		if (!list || !prev || !next) return;
		const update = () => {
			prev.disabled = list.scrollLeft <= 4;
			next.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 4;
		};
		const step = (dir) => list.scrollBy({ left: dir * list.clientWidth * 0.9, behavior: 'smooth' });
		prev.addEventListener('click', () => step(-1));
		next.addEventListener('click', () => step(1));
		list.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		update();
	});

	/* Tableaux plus larges que l'écran : défilement accessible au clavier */
	const markScrollable = () => {
		document.querySelectorAll('.wp-block-table').forEach((fig) => {
			const scrollable = fig.scrollWidth > fig.clientWidth + 1;
			if (scrollable) {
				fig.setAttribute('tabindex', '0');
				fig.setAttribute('role', 'region');
				fig.setAttribute('aria-label', 'Tableau (défilement horizontal)');
			} else {
				fig.removeAttribute('tabindex');
				fig.removeAttribute('role');
				fig.removeAttribute('aria-label');
			}
		});
	};
	markScrollable();
	window.addEventListener('resize', markScrollable);

	/* Avis longs : « Lire l'avis complet » */
	// Avis coupés à 5 lignes : bouton « Lire l'avis complet » sur ceux dont le texte dépasse réellement.
	document.querySelectorAll('.o-review').forEach((review) => {
		const text = review.querySelector('.o-review__text');
		if (!text || text.scrollHeight <= text.clientHeight + 2) return;
		review.classList.add('o-review--long');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'o-review__toggle';
		button.setAttribute('aria-expanded', 'false');
		button.textContent = 'Lire l’avis complet';
		button.addEventListener('click', () => {
			const open = review.classList.toggle('is-open');
			button.setAttribute('aria-expanded', String(open));
			button.textContent = open ? 'Réduire' : 'Lire l’avis complet';
		});
		text.after(button);
	});

	/* Sommaire : replié sur mobile, ouvert sur grand écran */
	const toc = document.querySelector('[data-o-toc]');
	if (toc && window.matchMedia('(max-width: 1023px)').matches) toc.open = false;

	/* Sommaire : met en évidence le dernier intertitre passé au-dessus de 30 % de la fenêtre,
	   et garde ce lien visible dans la liste défilante du sommaire fixe (grand écran). */
	if (toc) {
		const ids = [...new Set([...toc.querySelectorAll('a[href^="#"]')].map((a) => decodeURIComponent(a.hash.slice(1))))];
		const headings = ids.map((id) => document.getElementById(id)).filter(Boolean);
		const scroller = toc.querySelector('.o-toc__scroll');
		let current = null;
		let ticking = false;
		const update = () => {
			ticking = false;
			const limit = window.innerHeight * 0.3;
			let active = headings[0] || null;
			for (const h of headings) {
				if (h.getBoundingClientRect().top <= limit) active = h;
				else break;
			}
			if (!active || active === current) return;
			current = active;
			toc.querySelectorAll('a[href^="#"]').forEach((a) => {
				const on = decodeURIComponent(a.hash.slice(1)) === active.id;
				a.classList.toggle('is-current', on);
				if (on) a.setAttribute('aria-current', 'location');
				else a.removeAttribute('aria-current');
			});
			const link = scroller && scroller.querySelector('a.is-current');
			if (link && scroller.scrollHeight > scroller.clientHeight) {
				const box = scroller.getBoundingClientRect();
				const r = link.getBoundingClientRect();
				if (r.top < box.top) scroller.scrollTop -= box.top - r.top + 8;
				else if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom + 8;
			}
		};
		update();
		window.addEventListener(
			'scroll',
			() => {
				if (!ticking) {
					ticking = true;
					requestAnimationFrame(update);
				}
			},
			{ passive: true }
		);
	}

	/* Bandeau défilant : la liste est dupliquée (copie masquée aux lecteurs d'écran) pour une boucle continue */
	const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	document.querySelectorAll('.o-marquee').forEach((marquee) => {
		const list = marquee.querySelector('.o-marquee__list');
		if (!list || !motionOk) return;
		const track = document.createElement('div');
		track.className = 'o-marquee__track';
		list.replaceWith(track);
		const copy = list.cloneNode(true);
		copy.setAttribute('aria-hidden', 'true');
		track.append(list, copy);
		marquee.classList.add('is-running');
	});

	/* Mouvement façon Framer (voir src/motion.css) : séquence d'ouverture, titres mot par mot,
	   blocs et images au défilement, parallaxe légère. Rien de tout cela si les animations sont réduites. */
	if (!motionOk) {
		document.querySelectorAll('.o-hero, .o-page-hero, .o-page-header').forEach((el) => el.classList.add('is-ready'));
		return;
	}

	// Titre découpé en mots (chaque mot monte depuis une ligne masquée). Le texte reste identique et lisible.
	const splitWords = (el, delay = 0) => {
		if (!el || el.classList.contains('o-words')) return;
		let index = 0;
		const walk = (node) => {
			[...node.childNodes].forEach((child) => {
				if (child.nodeType === Node.TEXT_NODE) {
					const parts = child.textContent.split(/([ \t\n\r\f]+)/);
					if (!child.textContent.trim()) return;
					const frag = document.createDocumentFragment();
					parts.forEach((part) => {
						if (!part) return;
						if (/^[ \t\n\r\f]+$/.test(part)) {
							frag.append(document.createTextNode(part));
							return;
						}
						const word = document.createElement('span');
						const inner = document.createElement('span');
						word.className = 'o-w';
						inner.textContent = part;
						inner.style.setProperty('--o-wi', String(index++));
						word.append(inner);
						frag.append(word);
					});
					child.replaceWith(frag);
				} else if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR' && !child.classList.contains('screen-reader-text')) {
					walk(child);
				}
			});
		};
		walk(el);
		el.classList.add('o-words');
		el.style.setProperty('--o-wd', `${delay}ms`);
	};

	// Ouverture : hero de l'accueil et en-têtes des pages intérieures.
	const openers = [...document.querySelectorAll('.o-hero, .o-page-hero, .o-page-header')];
	openers.forEach((opener) => {
		const h1 = opener.querySelector('h1');
		splitWords(h1, opener.classList.contains('o-hero') ? 120 : 150);
		const items = opener.matches('.o-hero')
			? opener.querySelectorAll('.o-hero__copy > :not(h1)')
			: opener.querySelectorAll(':scope > :not(h1), .o-container > :not(.o-page-header__body), .o-page-header__body > :not(h1)');
		[...items].forEach((el, i) => el.style.setProperty('--o-i', String(i)));
	});
	requestAnimationFrame(() => {
		openers.forEach((opener) => opener.classList.add('is-ready'));
		requestAnimationFrame(() => openers.forEach((opener) => opener.querySelector('h1.o-words')?.classList.add('is-in')));
	});

	// Au défilement (pages composées de sections : .o-blocks).
	const targets = [];
	const mark = (el, type = '', i = 0, delay = 0) => {
		if (!el || el.hasAttribute('data-reveal') || el.hasAttribute('data-reveal-img')) return;
		if (type === 'img') el.setAttribute('data-reveal-img', '');
		else el.setAttribute('data-reveal', type);
		if (i) el.style.setProperty('--o-i', String(i));
		if (delay) el.style.setProperty('--o-d', `${delay}ms`);
		targets.push(el);
	};
	const scope = '.o-blocks';
	document
		.querySelectorAll(`${scope} :is(.o-section-head > h2, .o-cta > h2, .o-statement > h2, .o-more__card > h2, .o-split > .wp-block-column > h2, .o-lede > h2)`)
		.forEach((h) => {
			splitWords(h);
			targets.push(h);
		});
	document.querySelectorAll(`${scope} :is(.o-section-head, .o-cta, .o-more__card, .o-statement) > :not(h2)`).forEach((el, i) => mark(el, 'soft', 0, 220 + (i % 3) * 90));
	document
		.querySelectorAll(`${scope} :is(.o-index, .o-bento, .o-sectors, .o-card-grid, .o-news, .o-reasons, .o-stages, .o-steps, .o-aims, .o-promises, .o-levers, .o-briefs, .o-facts, .o-reviews__list)`)
		.forEach((grid) => [...grid.children].forEach((child, i) => mark(child, '', i % 4)));
	document.querySelectorAll(`${scope} :is(.o-bento__photo, .o-card__media, .wp-block-image):not(.o-hero__photo)`).forEach((fig) => mark(fig, 'img'));
	document.querySelectorAll(`${scope} :is(.o-form-card, .o-cta-band, .o-more__card)`).forEach((el) => mark(el));
	// Le reste du contenu des sections, bloc par bloc (sauf ce qui contient déjà une animation).
	document.querySelectorAll(`${scope} > .wp-block-group > *, ${scope} > .wp-block-group > .wp-block-columns > .wp-block-column`).forEach((el) => {
		if (el.matches('.o-words, [data-reveal], [data-reveal-img], .wp-block-columns') || el.querySelector('.o-words, [data-reveal], [data-reveal-img]')) return;
		mark(el);
	});

	let pending = targets.slice();
	const reveal = () => {
		const limit = window.innerHeight * 0.9;
		pending = pending.filter((el) => {
			if (el.getBoundingClientRect().top < limit) {
				el.classList.add('is-in');
				return false;
			}
			return true;
		});
	};

	// Parallaxe légère des grandes photos.
	const parallax = [...document.querySelectorAll('.o-hero__photo, .o-bento__photo, .o-sector__photo, .o-page-hero figure')];
	parallax.forEach((el) => el.setAttribute('data-parallax', ''));
	const drift = () => {
		const vh = window.innerHeight;
		parallax.forEach((el) => {
			const r = el.getBoundingClientRect();
			if (r.bottom < -100 || r.top > vh + 100) return;
			const offset = Math.max(-30, Math.min(30, -(r.top + r.height / 2 - vh / 2) * 0.06));
			el.style.setProperty('--o-py', `${offset.toFixed(1)}px`);
		});
	};

	let ticking = false;
	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			ticking = false;
			if (pending.length) reveal();
			drift();
		});
	};
	reveal();
	drift();
	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', onScroll, { passive: true });
})();
