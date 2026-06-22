/* ── State ── */
const state = {
  currentQuery: '', cards: [], selectedCard: null, dolarRate: null,
  view: 'search',
  sets: [], setsLoaded: false,
  currentSet: null, setPage: 1, setHasMore: false,
};

/* ── DOM refs ── */
const $searchInput   = document.getElementById('search-input');
const $searchBtn     = document.getElementById('search-btn');
const $stateEmpty    = document.getElementById('state-empty');
const $stateLoading  = document.getElementById('state-loading');
const $stateError    = document.getElementById('state-error');
const $stateResults  = document.getElementById('state-results');
const $resultsCount  = document.getElementById('results-count');
const $resultsQuery  = document.getElementById('results-query');
const $cardsGrid     = document.getElementById('cards-grid');
const $pricePanel    = document.getElementById('price-panel');
const $closePanelBtn = document.getElementById('close-panel-btn');
const $selectedImg   = document.getElementById('selected-card-img');
const $selectedName  = document.getElementById('selected-card-name');
const $selectedMeta  = document.getElementById('selected-card-meta');
const $marketSummary = document.getElementById('market-summary');
const $pricesLoading = document.getElementById('prices-loading');
const $pricesContent = document.getElementById('prices-content');
const $tcgmatchRes   = document.getElementById('tcgmatch-results');
const $tcgplayerRes  = document.getElementById('tcgplayer-results');
const $tcgmatchLink  = document.getElementById('tcgmatch-link');
const $tcgplayerLink = document.getElementById('tcgplayer-link');
const $dolarBadge    = document.getElementById('dolar-badge');
const $dolarValue    = document.getElementById('dolar-value');

/* Vistas */
const $views         = document.querySelectorAll('.view');
const $tabBtns        = document.querySelectorAll('.vt-btn');
const $viewSearch    = document.getElementById('view-search');
const $viewSets      = document.getElementById('view-sets');
const $viewPreventas = document.getElementById('view-preventas');
/* Ediciones */
const $setsBrowse    = document.getElementById('sets-browse');
const $setsLoading   = document.getElementById('sets-loading');
const $setsGrid      = document.getElementById('sets-grid');
const $setsCount     = document.getElementById('sets-count');
const $setCardsWrap  = document.getElementById('set-cards-wrap');
const $setCardsTitle = document.getElementById('set-cards-title');
const $setCardsCount = document.getElementById('set-cards-count');
const $setCardsGrid  = document.getElementById('set-cards-grid');
const $setsBackBtn   = document.getElementById('sets-back-btn');
const $setLoadmore   = document.getElementById('set-cards-loadmore');
const $loadmoreBtn   = document.getElementById('loadmore-btn');
const $upcomingSection = document.getElementById('upcoming-section');
const $upcomingGrid  = document.getElementById('upcoming-grid');
const $upcomingCount = document.getElementById('upcoming-count');
/* Preventas */
const $preventasInput   = document.getElementById('preventas-input');
const $preventasBtn     = document.getElementById('preventas-btn');
const $preventasCount   = document.getElementById('preventas-count');
const $preventasStores  = document.getElementById('preventas-stores');
const $preventasIntro    = document.getElementById('preventas-intro');
const $preventasLoading = document.getElementById('preventas-loading');
const $preventasResults = document.getElementById('preventas-results');

/* ── View switching ── */
$tabBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

function switchView(view) {
  state.view = view;
  $tabBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $viewSearch.classList.toggle('hidden', view !== 'search');
  $viewSets.classList.toggle('hidden', view !== 'sets');
  $viewPreventas.classList.toggle('hidden', view !== 'preventas');
  hidePanel();
  if (view === 'sets') {
    // El tab siempre muestra la lista de ediciones, no el último set abierto
    $setCardsWrap.classList.add('hidden');
    $setsBrowse.classList.remove('hidden');
    state.currentSet = null;
    if (!state.setsLoaded) loadSets();
  }
}

/* ── Search ── */
$searchBtn.addEventListener('click', doSearch);
$searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const query = $searchInput.value.trim();
  if (!query || query.length < 2) { shake($searchInput); return; }
  if (state.view !== 'search') switchView('search');
  if (query === state.currentQuery && state.cards.length > 0) return;
  state.currentQuery = query;
  state.selectedCard = null;
  showState('loading');
  hidePanel();
  try {
    const data = await apiFetch(`/api/cards?name=${encodeURIComponent(query)}`);
    state.cards = data.cards || [];
    renderCards(state.cards, query);
    showState('results');
  } catch (err) {
    showError('No se pudo buscar', err.message || 'Verifica la conexión o la API key.');
  }
}

/* ── Render cards ── */
function renderCards(cards, query) {
  $resultsQuery.textContent = `"${query}"`;
  $resultsCount.textContent = `${cards.length} resultado${cards.length !== 1 ? 's' : ''}`;
  $cardsGrid.innerHTML = '';

  if (!cards.length) {
    $cardsGrid.innerHTML = `<div style="grid-column:1/-1;padding:60px 0;text-align:center;color:var(--t4)">Sin resultados para "${esc(query)}"</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  cards.forEach((card, i) => {
    const el = buildCardEl(card);
    el.style.animationDelay = `${i * 25}ms`;
    el.classList.add('card-enter');
    frag.appendChild(el);
  });
  $cardsGrid.appendChild(frag);
}

function buildCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card-item';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');

  const imgSrc = card.images?.small || card.images?.large || '';
  const typeClass = (card.types?.[0] || '').toLowerCase();

  el.innerHTML = `
    <div class="ci-img-wrap">
      ${imgSrc
        ? `<img class="ci-img" src="${esc(imgSrc)}" alt="${esc(card.name)}" loading="lazy" />`
        : `<svg class="ci-img-placeholder" viewBox="0 0 100 140"><rect width="100" height="140" rx="6" fill="#1e1e25"/><circle cx="50" cy="62" r="22" stroke="#3f3f46" stroke-width="2" fill="none"/><line x1="0" y1="62" x2="100" y2="62" stroke="#3f3f46" stroke-width="2"/><circle cx="50" cy="62" r="7" fill="#17171c" stroke="#3f3f46" stroke-width="2"/></svg>`
      }
    </div>
    <div class="ci-info">
      <div class="ci-name">${esc(card.name)}</div>
      <div class="ci-meta">${esc(card.set || '')}${card.number ? ` · #${card.number}` : ''}</div>
      <div class="ci-badges">
        ${(card.types || []).map(t => `<span class="ci-badge type-${t.toLowerCase()}">${t}</span>`).join('')}
        ${card.rarity ? `<span class="ci-badge rarity">${esc(card.rarity)}</span>` : ''}
      </div>
    </div>`;

  el.addEventListener('click', () => selectCard(card, el));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectCard(card, el); });
  return el;
}

/* ── Ediciones (sets) ── */
async function loadSets() {
  $setsLoading.classList.remove('hidden');
  $setsGrid.innerHTML = '';
  loadUpcoming(); // próximas ediciones en paralelo (no bloquea)
  try {
    const data = await apiFetch('/api/sets');
    state.sets = data.sets || [];
    state.setsLoaded = true;
    renderSets(state.sets);
  } catch (err) {
    $setsLoading.classList.add('hidden');
    $setsGrid.innerHTML = `<div class="lc-empty"><div class="lce-icon">⚠</div><div class="lce-text">${esc(err.message || 'No se pudieron cargar las ediciones')}</div></div>`;
  }
}

async function loadUpcoming() {
  try {
    const data = await apiFetch('/api/upcoming');
    const upcoming = data.upcoming || [];
    if (!upcoming.length) return;
    $upcomingCount.textContent = `${upcoming.length} ${upcoming.length !== 1 ? 'ediciones' : 'edición'}`;
    $upcomingGrid.innerHTML = '';
    const frag = document.createDocumentFragment();
    upcoming.forEach((set, i) => {
      const el = document.createElement('div');
      el.className = 'set-item set-upcoming card-enter';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.style.animationDelay = `${i * 20}ms`;
      el.innerHTML = `
        <div class="set-logo-wrap">
          <span class="set-soon-badge">Próximamente</span>
          ${set.logo ? `<img class="set-logo" src="${esc(set.logo)}" alt="${esc(set.name)}" loading="lazy" />` : ''}
        </div>
        <div class="set-info">
          <div class="set-name">${esc(set.name)}</div>
          <div class="set-meta">${esc(formatSetDate(set.releaseDate))} · Ver preventas →</div>
        </div>`;
      // Click → buscar preventas de esta edición
      const go = () => openPreventasFor(set.name);
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') go(); });
      frag.appendChild(el);
    });
    $upcomingGrid.appendChild(frag);
    $upcomingSection.classList.remove('hidden');
  } catch (_) {
    /* silencioso — la sección simplemente no aparece */
  }
}

function renderSets(sets) {
  $setsLoading.classList.add('hidden');
  $setsCount.textContent = `${sets.length} ${sets.length !== 1 ? 'ediciones' : 'edición'}`;

  const frag = document.createDocumentFragment();
  sets.forEach((set, i) => {
    const el = document.createElement('div');
    el.className = 'set-item card-enter';
    el.style.animationDelay = `${i * 20}ms`;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `
      <div class="set-logo-wrap">
        ${set.logo ? `<img class="set-logo" src="${esc(set.logo)}" alt="${esc(set.name)}" loading="lazy" />` : ''}
      </div>
      <div class="set-info">
        <div class="set-name">${esc(set.name)}</div>
        <div class="set-meta">${esc(formatSetDate(set.releaseDate))}${set.total ? ` · ${set.total} cartas` : ''}</div>
      </div>`;
    el.addEventListener('click', () => openSet(set));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openSet(set); });
    frag.appendChild(el);
  });
  $setsGrid.appendChild(frag);
}

async function openSet(set) {
  state.currentSet = set;
  state.setPage = 1;
  hidePanel();
  $setsBrowse.classList.add('hidden');
  $setCardsWrap.classList.remove('hidden');
  $setCardsTitle.textContent = set.name;
  $setCardsCount.textContent = '';
  $setCardsGrid.innerHTML = `<div class="centered-state" style="grid-column:1/-1"><div class="loader-ring"></div><p>Cargando cartas…</p></div>`;
  $setLoadmore.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const data = await apiFetch(`/api/sets/${encodeURIComponent(set.id)}/cards?page=1`);
    $setCardsGrid.innerHTML = '';
    state.setHasMore = data.hasMore;
    $setCardsCount.textContent = `${data.totalCount} cartas`;
    appendSetCards(data.cards);
    $setLoadmore.classList.toggle('hidden', !data.hasMore);
  } catch (err) {
    $setCardsGrid.innerHTML = `<div class="lc-empty" style="grid-column:1/-1"><div class="lce-icon">⚠</div><div class="lce-text">${esc(err.message || 'No se pudieron cargar las cartas')}</div></div>`;
  }
}

function appendSetCards(cards) {
  const frag = document.createDocumentFragment();
  cards.forEach((card, i) => {
    const el = buildCardEl(card);
    el.style.animationDelay = `${i * 18}ms`;
    el.classList.add('card-enter');
    frag.appendChild(el);
  });
  $setCardsGrid.appendChild(frag);
}

async function loadMoreSetCards() {
  if (!state.currentSet || !state.setHasMore) return;
  const nextPage = state.setPage + 1;
  $loadmoreBtn.disabled = true;
  $loadmoreBtn.textContent = 'Cargando…';
  try {
    const data = await apiFetch(`/api/sets/${encodeURIComponent(state.currentSet.id)}/cards?page=${nextPage}`);
    state.setPage = nextPage;
    state.setHasMore = data.hasMore;
    appendSetCards(data.cards);
    $setLoadmore.classList.toggle('hidden', !data.hasMore);
  } catch (_) {
    /* mantener botón para reintentar */
  } finally {
    $loadmoreBtn.disabled = false;
    $loadmoreBtn.textContent = 'Cargar más cartas';
  }
}

function backToSets() {
  hidePanel();
  $setCardsWrap.classList.add('hidden');
  $setsBrowse.classList.remove('hidden');
  state.currentSet = null;
}

/* ── Preventas ── */
$preventasBtn.addEventListener('click', () => doPreventas($preventasInput.value));
$preventasInput.addEventListener('keydown', e => { if (e.key === 'Enter') doPreventas($preventasInput.value); });

// Entrar a Preventas desde una edición próxima
function openPreventasFor(name) {
  switchView('preventas');
  $preventasInput.value = name;
  doPreventas(name);
}

async function doPreventas(term) {
  const q = (term || '').trim();
  if (!q || q.length < 2) { shake($preventasInput); return; }

  $preventasIntro.classList.add('hidden');
  $preventasResults.classList.add('hidden');
  $preventasStores.innerHTML = '';
  $preventasCount.textContent = '';
  $preventasLoading.classList.remove('hidden');

  try {
    const data = await apiFetch(`/api/preventas?q=${encodeURIComponent(q)}`);
    renderPreventas(data);
  } catch (err) {
    $preventasLoading.classList.add('hidden');
    $preventasResults.classList.remove('hidden');
    $preventasResults.innerHTML = `<div class="lc-empty"><div class="lce-icon">⚠</div><div class="lce-text">${esc(err.message || 'Error al buscar preventas')}</div></div>`;
  }
}

function renderPreventas(data) {
  $preventasLoading.classList.add('hidden');
  $preventasResults.classList.remove('hidden');

  const products = data.products || [];
  $preventasCount.textContent = `${products.length} resultado${products.length !== 1 ? 's' : ''} · "${data.term}"`;

  // Chips de resumen por tienda
  $preventasStores.innerHTML = (data.stores || []).map(s => {
    const cls = s.error ? 'pv-chip err' : (s.products.length ? 'pv-chip ok' : 'pv-chip');
    const txt = s.error ? 'sin conexión' : `${s.products.length}`;
    return `<span class="${cls}"><span class="pv-chip-name">${esc(s.store)}</span><span class="pv-chip-n">${txt}</span></span>`;
  }).join('');

  if (!products.length) {
    $preventasResults.innerHTML = `
      <div class="lc-empty">
        <div class="lce-icon">—</div>
        <div class="lce-text">Sin preventas para "${esc(data.term)}" en las tiendas consultadas</div>
      </div>`;
    return;
  }

  $preventasResults.innerHTML = products.map(p => `
    <a class="pv-row" href="${esc(p.url)}" target="_blank" rel="noopener">
      <div class="pv-thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" />` : ''}</div>
      <div class="pv-info">
        <div class="pv-title">${esc(p.title)}</div>
        <div class="pv-meta">
          <span class="pv-store">${esc(p.store)}</span>
          <span class="pv-status ${p.available ? 'on' : 'soon'}">${p.available ? 'Disponible' : 'Preventa'}</span>
        </div>
      </div>
      <div class="pv-price">${fmtCLP(p.price)}</div>
    </a>`).join('');
}

$setsBackBtn.addEventListener('click', backToSets);
$loadmoreBtn.addEventListener('click', loadMoreSetCards);

function formatSetDate(d) {
  if (!d) return '';
  // pokemontcg.io usa "YYYY/MM/DD"
  const parts = d.split('/');
  if (parts.length !== 3) return d;
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const m = months[parseInt(parts[1], 10) - 1] || '';
  return `${parts[2]} ${m} ${parts[0]}`;
}

/* ── Select card ── */
function selectCard(card, el) {
  document.querySelectorAll('.card-item.selected').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedCard = card;
  renderSelectedCard(card);
  $marketSummary.innerHTML = `<div class="markets-loading"><div class="loader-ring sm"></div><span>Consultando precios…</span></div>`;
  showPanel();
  loadPrices(card);
  setTimeout(() => $pricePanel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function renderSelectedCard(card) {
  const imgSrc = card.images?.large || card.images?.small || '';
  $selectedImg.src = imgSrc;
  $selectedImg.alt = card.name;
  $selectedImg.style.display = imgSrc ? 'block' : 'none';
  $selectedName.textContent = card.name;

  const tags = [
    card.set      && { label: 'Set',       value: card.set },
    card.number   && { label: 'Número',    value: `#${card.number}` },
    card.rarity   && { label: 'Rareza',    value: card.rarity },
    card.hp       && { label: 'HP',        value: card.hp },
    card.supertype && { label: 'Tipo',     value: card.supertype },
    card.artist   && { label: 'Ilustrador',value: card.artist },
  ].filter(Boolean);

  $selectedMeta.innerHTML = tags.map(t =>
    `<div class="pp-tag"><span class="pp-tag-label">${esc(t.label)}</span><span class="pp-tag-value">${esc(t.value)}</span></div>`
  ).join('');
}

/* ── Load prices ── */
async function loadPrices(card) {
  $pricesLoading.classList.remove('hidden');
  $pricesContent.classList.add('hidden');
  $tcgmatchRes.innerHTML = '';
  $tcgplayerRes.innerHTML = '';

  const matchUrl  = `https://www.tcgmatch.cl/cartas/busqueda/tcg=pokemon&q=${encodeURIComponent(card.name + (card.number ? ' ' + String(card.number).padStart(3,'0') : ''))}`;
  const playerUrl = `https://www.tcgplayer.com/search/pokemon/product?q=${encodeURIComponent(card.name + (card.set ? ' ' + card.set : ''))}&view=grid`;
  $tcgmatchLink.href  = matchUrl;
  $tcgplayerLink.href = playerUrl;

  try {
    const params = new URLSearchParams({ name: card.name, number: card.number || '', set: card.set || '' });
    const data = await apiFetch(`/api/prices?${params}`);

    state.dolarRate = data.dolarRate || null;
    updateDolar(data.dolarRate);

    if (data.tcgmatch?.searchUrl)  $tcgmatchLink.href  = data.tcgmatch.searchUrl;
    if (data.tcgplayer?.searchUrl) $tcgplayerLink.href = data.tcgplayer.searchUrl;

    renderMarkets(data.tcgmatch?.exactMatch, data.tcgplayer?.exactMatch, data.dolarRate);
    renderListings($tcgmatchRes,  data.tcgmatch,  'CLP', $tcgmatchLink.href,  null);
    renderListings($tcgplayerRes, data.tcgplayer, 'USD', $tcgplayerLink.href, data.dolarRate);
  } catch (err) {
    $marketSummary.innerHTML = '';
    renderListings($tcgmatchRes,  { error: err.message, results: [] }, 'CLP', matchUrl,  null);
    renderListings($tcgplayerRes, { error: err.message, results: [] }, 'USD', playerUrl, null);
  } finally {
    $pricesLoading.classList.add('hidden');
    $pricesContent.classList.remove('hidden');
  }
}

/* ── Markets summary ── */
function renderMarkets(matchCard, playerCard, dolarRate) {
  const matchMarket  = matchCard?.marketPrice  || matchCard?.price  || null;
  const playerMarket = playerCard?.marketPrice || playerCard?.price || null;

  if (!matchMarket && !playerMarket) { $marketSummary.innerHTML = ''; return; }

  let html = '';

  if (matchMarket) {
    html += `
      <div class="mkt-card blue">
        <div class="mkt-label">Market TCGMatch</div>
        <div class="mkt-price">${fmtCLP(matchMarket)}</div>
        ${matchCard?.price && matchCard.price !== matchMarket
          ? `<div class="mkt-from">Desde ${fmtCLP(matchCard.price)}</div>` : ''}
      </div>`;
  }

  if (playerMarket) {
    const clp = dolarRate ? Math.round(playerMarket * dolarRate) : null;
    html += `
      <div class="mkt-card amber">
        <div class="mkt-label">Market TCGPlayer</div>
        <div class="mkt-price">${fmtUSD(playerMarket)}</div>
        ${clp ? `<div class="mkt-sub">${fmtCLP(clp)} <span class="mkt-rate">@ $${Math.round(dolarRate).toLocaleString('es-CL')}/USD</span></div>` : ''}
        ${playerCard?.listingPrice && playerCard.listingPrice !== playerMarket
          ? `<div class="mkt-from">Desde ${fmtUSD(playerCard.listingPrice)}</div>` : ''}
      </div>`;
  }

  if (dolarRate) {
    html += `
      <div class="mkt-card green">
        <div class="mkt-label">Dólar hoy</div>
        <div class="mkt-price">${fmtCLP(Math.round(dolarRate))}</div>
        <div class="mkt-sub">USD / CLP</div>
      </div>`;
  }

  $marketSummary.innerHTML = html;
}

/* ── Dolar badge ── */
function updateDolar(rate) {
  if (!rate || !$dolarBadge) return;
  $dolarValue.textContent = fmtCLP(Math.round(rate));
  $dolarBadge.classList.remove('hidden');
}

/* ── Listings ── */
function renderListings(container, data, currency, fallbackUrl, dolarRate) {
  if (!data || data.error) {
    container.innerHTML = `<div class="lc-empty"><div class="lce-icon">⚠</div><div class="lce-text">${esc(data?.error || 'Error al obtener precios')}</div></div>`;
    return;
  }

  const results = data.results || [];
  if (!results.length) {
    container.innerHTML = `
      <div class="lc-empty">
        <div class="lce-icon">—</div>
        <div class="lce-text">Sin vendedores activos en este momento</div>
        ${fallbackUrl ? `<a class="lce-link" href="${esc(fallbackUrl)}" target="_blank" rel="noopener">Ver carta en el sitio ↗</a>` : ''}
      </div>`;
    return;
  }

  // TCGMatch: mostrar desglose por idioma si está disponible
  if (currency === 'CLP' && data.exactMatch && (data.exactMatch.ingles || data.exactMatch.espanol)) {
    const em  = data.exactMatch;
    const href = data.searchUrl || fallbackUrl;
    let html = '';

    if (em.ingles) {
      html += `
        <a class="l-row" href="${esc(href)}" target="_blank" rel="noopener">
          <div class="l-info">
            <div class="l-name"><span class="l-lang-badge l-lang-en">Inglés</span></div>
            <div class="l-meta"><span class="l-stock">${em.ingles.stock} vendedor${em.ingles.stock !== 1 ? 'es' : ''}</span></div>
          </div>
          <div class="l-right"><div class="l-price">${fmtCLP(em.ingles.minPrice)}</div></div>
        </a>`;
    }
    if (em.espanol) {
      html += `
        <a class="l-row" href="${esc(href)}" target="_blank" rel="noopener">
          <div class="l-info">
            <div class="l-name"><span class="l-lang-badge l-lang-es">Español</span></div>
            <div class="l-meta"><span class="l-stock">${em.espanol.stock} vendedor${em.espanol.stock !== 1 ? 'es' : ''}</span></div>
          </div>
          <div class="l-right"><div class="l-price">${fmtCLP(em.espanol.minPrice)}</div></div>
        </a>`;
    }

    container.innerHTML = html;
    return;
  }

  const sorted = [...results].sort((a, b) => (a.price || 0) - (b.price || 0));
  const shown  = sorted.slice(0, 8);
  const isUSD  = currency === 'USD';

  container.innerHTML = shown.map(item => {
    const priceStr = isUSD ? fmtUSD(item.price) : fmtCLP(item.price);
    const clpEquiv = isUSD && dolarRate && item.price
      ? `<span class="l-clp">≈ ${fmtCLP(Math.round(item.price * dolarRate))}</span>` : '';
    const marketStr = item.marketPrice && item.marketPrice !== item.price
      ? (isUSD ? fmtUSD(item.marketPrice) : fmtCLP(item.marketPrice)) : '';
    const href = item.url || fallbackUrl;

    return `
      <a class="l-row" href="${esc(href)}" target="_blank" rel="noopener">
        <div class="l-info">
          <div class="l-name">${esc(item.name || '')}</div>
          <div class="l-meta">
            ${item.set    ? `<span class="l-set">${esc(item.set)}</span>` : ''}
            ${item.number ? `<span class="l-num">#${esc(item.number)}</span>` : ''}
            ${item.condition && item.condition !== 'N/A' ? `<span class="l-cond">${esc(item.condition)}</span>` : ''}
            ${item.stock > 1 ? `<span class="l-stock">${item.stock} disp.</span>` : ''}
          </div>
          ${marketStr ? `<div class="l-market">Market <strong>${marketStr}</strong></div>` : ''}
          ${clpEquiv}
        </div>
        <div class="l-right">
          <div class="l-price">${priceStr}</div>
          ${item.inStock === false ? '<div class="l-oos">Sin stock</div>' : ''}
        </div>
      </a>`;
  }).join('');

  if (sorted.length > 8) {
    container.innerHTML += `<p class="lc-note">+${sorted.length - 8} listados más</p>`;
  }
}

/* ── Panel show / hide ── */
function showPanel() { $pricePanel.classList.remove('hidden'); }
function hidePanel() {
  $pricePanel.classList.add('hidden');
  document.querySelectorAll('.card-item.selected').forEach(c => c.classList.remove('selected'));
  state.selectedCard = null;
}
$closePanelBtn.addEventListener('click', hidePanel);

/* ── States ── */
function showState(name) {
  [$stateEmpty, $stateLoading, $stateError, $stateResults].forEach(el => el.classList.add('hidden'));
  ({ empty: $stateEmpty, loading: $stateLoading, error: $stateError, results: $stateResults })[name]?.classList.remove('hidden');
}

function showError(title, msg) {
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-msg').textContent   = msg;
  showState('error');
}

/* ── Utils ── */
async function apiFetch(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmtCLP(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}
function fmtUSD(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function shake(el) {
  el.style.animation = 'shake 0.35s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}
