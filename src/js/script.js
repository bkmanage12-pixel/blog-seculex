document.addEventListener('DOMContentLoaded', () => {
    // Live Auto-Refresh when Admin Syncs / Refreshes site
    window.addEventListener('storage', (event) => {
        if (event.key === 'seculex_site_refreshed') {
            console.log('[SecuLex Sync] Site sync signal received. Reloading page...');
            window.location.reload();
        }
    });

    // Mobile Navigation Toggle
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navMenu = document.querySelector('nav ul');

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            const isOpen = navMenu.classList.contains('active');
            mobileToggle.setAttribute('aria-expanded', String(isOpen));
            
            // Toggle icon between bars and times
            const icon = mobileToggle.querySelector('i');
            if (icon) {
                if (isOpen) {
                    icon.classList.remove('fa-bars');
                    icon.classList.add('fa-times');
                } else {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
        });
    }

    // Intersection Observer for scroll animations
    const faders = document.querySelectorAll('.fade-in');
    
    const appearOptions = {
        threshold: 0.01,
        rootMargin: "0px"
    };

    const appearOnScroll = new IntersectionObserver(function(
        entries, 
        appearOnScroll
    ) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('visible');
                appearOnScroll.unobserve(entry.target);
            }
        });
    }, appearOptions);

    faders.forEach(fader => {
        appearOnScroll.observe(fader);
    });

    // ── Categories Dropdown: click-toggle for touch/mobile ──
    document.querySelectorAll('.has-dropdown').forEach(item => {
        const trigger = item.querySelector('a');
        trigger.addEventListener('click', (e) => {
            // Only intercept on touch / narrow screens
            if (window.innerWidth <= 768) {
                e.preventDefault();
                item.classList.toggle('open');
            }
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.has-dropdown.open').forEach(item => {
            if (!item.contains(e.target)) {
                item.classList.remove('open');
            }
        });
    });

    // ── Navigation Scroll-Spy (Home, About, Contact) ──
    const aboutSection = document.querySelector('#about');
    const contactSection = document.querySelector('#contact');
    const heroSection = document.querySelector('.hero');
    
    const navHome = document.querySelector('#nav-home');
    const navAbout = document.querySelector('#nav-about');
    const navContact = document.querySelector('#nav-contact');

    if (aboutSection && contactSection && heroSection && navHome && navAbout && navContact) {
        const spyOptions = {
            root: null,
            threshold: 0.1,
            rootMargin: "-25% 0px -35% 0px"
        };

        const spyObserver = new IntersectionObserver((entries) => {
            // Only toggle on the homepage where scrolling actually takes place
            if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') return;

            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    navHome.classList.remove('active');
                    navAbout.classList.remove('active');
                    navContact.classList.remove('active');

                    if (entry.target.id === 'about') {
                        navAbout.classList.add('active');
                    } else if (entry.target.id === 'contact') {
                        navContact.classList.add('active');
                    } else if (entry.target.classList.contains('hero')) {
                        navHome.classList.add('active');
                    }
                }
            });
        }, spyOptions);

        spyObserver.observe(heroSection);
        spyObserver.observe(aboutSection);
        spyObserver.observe(contactSection);

        // Fallback for reaching bottom of page to ensure Contact is highlighted
        window.addEventListener('scroll', () => {
            if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') return;
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50) {
                navHome.classList.remove('active');
                navAbout.classList.remove('active');
                navContact.classList.add('active');
            }
        });
    }
});

// ── Paywall — DPO Pay Integration ────────────────────────────────────────────

function openPaywall() {
    const modal = document.getElementById('paywall-modal');
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePaywall() {
    const modal = document.getElementById('paywall-modal');
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
}

function tocPaywallNotify(event) {
    event?.preventDefault();
    const hint = document.getElementById('paywall-hint');
    if (hint) {
        hint.textContent = 'This section is available after purchase. Complete payment to access the full article.';
    }
    openPaywall();
    document.getElementById('btn-pay-dpo')?.focus();
}

function _paywallMessage(name, fallback) {
    const block = document.getElementById('attachment-block');
    if (!block) return fallback;
    return block.dataset[name] || fallback;
}

/**
 * Initiate DPO Pay payment for an article PDF download.
 * Calls /.netlify/functions/create-payment with article context,
 * then redirects to the DPO gateway URL returned by the backend.
 */
async function startDpoPaywallPayment() {
    const block = document.getElementById('attachment-block');
    const payButton = document.getElementById('btn-pay-dpo');
    const hint = document.getElementById('paywall-hint');

    if (!block || !payButton) return;

    payButton.disabled = true;
    payButton.classList.add('loading');

    const icon = payButton.querySelector('i');
    let originalIconClass = '';
    if (icon) {
        originalIconClass = icon.className;
        icon.className = 'fas fa-spinner fa-spin';
    }

    if (hint) {
        hint.textContent = _paywallMessage('checkoutLoadingMessage', 'Preparing secure DPO payment checkout...');
        hint.style.color = 'var(--accent-gold)';
    }

    try {
        const response = await fetch('/.netlify/functions/create-payment', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                serviceId: 'article-download',
                currency: block.dataset.paywallCurrency || 'RWF',
                // Guest placeholder — no extra form shown for article downloads
                name: 'Guest',
                email: 'download@seculex.org',
                phone: '+250000000000',
                notes: `Article PDF: ${block.dataset.articleTitle || document.title}`,
                articleUrl: window.location.href,
                articleTitle: block.dataset.articleTitle || document.title
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success || !data.paymentUrl) {
            throw new Error(data.error || _paywallMessage('checkoutErrorMessage', 'Could not initiate payment. Please try again.'));
        }

        // Store stateToken in sessionStorage so captureReturnedDpoOrder can use it on return
        sessionStorage.setItem('dpo_state_token', data.stateToken);
        sessionStorage.setItem('dpo_ref', data.transactionReference);

        // Redirect to DPO Pay gateway
        window.location.href = data.paymentUrl;

    } catch (error) {
        payButton.disabled = false;
        payButton.classList.remove('loading');
        if (icon && originalIconClass) icon.className = originalIconClass;
        if (hint) {
            hint.textContent = error.message;
            hint.style.color = '#f87171';
        }
    }
}

function _triggerSecureDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function _convertButtonToLink(url) {
    const btn = document.getElementById('download-trigger-btn');
    if (!btn || !url) return;
    const link = document.createElement('a');
    link.href = url;
    link.className = 'btn-access-action unlocked-btn';
    link.download = '';
    link.target = '_blank';
    const label = _paywallMessage('downloadAgainLabel', 'Download Again');
    link.innerHTML = `<i class="fas fa-download"></i> ${label} <i class="fas fa-check-circle" style="margin-left:0.4rem;color:#4ade80;"></i>`;
    btn.replaceWith(link);
}

/**
 * Called on DOMContentLoaded when DPO redirects back to the article page
 * with ?ref=SLX-...&dpo=return in the URL.
 * Reads the stateToken from sessionStorage, calls verify-payment, and
 * if PAID — triggers the PDF download and converts the button to a link.
 */
async function captureReturnedDpoOrder() {
    const block = document.getElementById('attachment-block');
    if (!block) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('dpo') !== 'return') return;

    const ref = params.get('ref') || sessionStorage.getItem('dpo_ref');
    const stateToken = sessionStorage.getItem('dpo_state_token');

    // Clean URL immediately — prevents double-capture on refresh
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);

    // Clear stored tokens
    sessionStorage.removeItem('dpo_state_token');
    sessionStorage.removeItem('dpo_ref');

    if (!ref) return;

    openPaywall();
    const hint = document.getElementById('paywall-hint');
    if (hint) {
        hint.textContent = _paywallMessage('verificationLoadingMessage', 'Verifying payment with DPO Pay...');
        hint.style.color = 'var(--accent-gold)';
    }

    try {
        const queryParams = stateToken
            ? `ref=${encodeURIComponent(ref)}&state=${encodeURIComponent(stateToken)}`
            : `ref=${encodeURIComponent(ref)}`;

        const response = await fetch(`/.netlify/functions/verify-payment?${queryParams}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || _paywallMessage('verificationErrorMessage', 'Payment verification failed. Contact support if charged.'));
        }

        if (data.status !== 'PAID') {
            throw new Error(`Payment status: ${data.status}. If you completed payment, please contact support at info@seculex.org.`);
        }

        // Payment verified — unlock the document
        const card = document.querySelector('.paywall-card');
        if (card) card.classList.add('unlocked');
        if (hint) {
            hint.textContent = _paywallMessage('verificationSuccessMessage', 'Payment verified. Your download is starting now.');
            hint.style.color = '#4ade80';
        }

        // Construct the secure download URL from the document ID
        const documentId = block.dataset.documentId;
        const downloadUrl = documentId
            ? `/.netlify/functions/download-document?file=${encodeURIComponent(documentId)}`
            : block.dataset.attachment;

        setTimeout(() => {
            closePaywall();
            if (downloadUrl) {
                _triggerSecureDownload(downloadUrl);
                _convertButtonToLink(downloadUrl);
            }
        }, 800);

    } catch (error) {
        if (hint) {
            hint.textContent = error.message;
            hint.style.color = '#f87171';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('paywall-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePaywall();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePaywall();
        });
    }

    // Handle DPO Pay return or cancellation
    const params = new URLSearchParams(window.location.search);
    const dpoAction = params.get('dpo');

    if (dpoAction === 'cancel') {
        openPaywall();
        const hint = document.getElementById('paywall-hint');
        if (hint) {
            hint.textContent = 'Payment was cancelled. You can try again when you are ready.';
            hint.style.color = '#f87171';
        }
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        window.history.replaceState({}, document.title, cleanUrl);
    } else if (dpoAction === 'return') {
        captureReturnedDpoOrder();
    }
});

// ── Display Sizing Controller Module (Estimated screen size in physical inches) ──
(function() {
    function estimateScreenDetails() {
        const dpr = window.devicePixelRatio || 1;
        const cssW = window.screen.width;
        const cssH = window.screen.height;
        const maxCss = Math.max(cssW, cssH);
        const minCss = Math.min(cssW, cssH);

        let estPPI = 96;
        if (maxCss < 960 && minCss < 500) {
            estPPI = dpr >= 3 ? 400 : 326;
        } else if (maxCss <= 1366 && minCss <= 1024 && (navigator.maxTouchPoints > 1 || dpr > 1.5)) {
            estPPI = 264;
        } else if (dpr > 1.5) {
            estPPI = maxCss < 2000 ? 220 : 160;
        } else {
            estPPI = 100;
        }

        const diagPx = Math.sqrt((cssW * dpr) * (cssW * dpr) + (cssH * dpr) * (cssH * dpr));
        const inches = parseFloat((diagPx / estPPI).toFixed(1));

        let cat = 'laptop';
        if (inches < 7.0) cat = 'phone';
        else if (inches < 13.0) cat = 'tablet';
        else if (inches < 18.0) cat = 'laptop';
        else cat = 'desktop';

        return {
            inches: inches,
            category: cat,
            resolution: `${cssW * dpr} x ${cssH * dpr}`,
            dpr: dpr.toFixed(1),
            ppi: estPPI
        };
    }

    function initDisplayWidget() {
        const trigger = document.getElementById('display-widget-trigger');
        const panel = document.getElementById('display-widget-panel');
        const closeBtn = document.getElementById('display-widget-close');
        const autoToggle = document.getElementById('display-widget-auto-toggle');
        const tabsContainer = document.getElementById('display-widget-tabs');
        const tabs = document.querySelectorAll('.widget-tab');
        const inchesVal = document.getElementById('display-widget-inches-val');
        const zoomSlider = document.getElementById('display-widget-zoom-slider');
        const zoomVal = document.getElementById('display-widget-zoom-val');

        const statRes = document.getElementById('stat-resolution');
        const statDpr = document.getElementById('stat-dpr');
        const statPpi = document.getElementById('stat-ppi');

        if (!trigger || !panel) return;

        const isAuto = localStorage.getItem('display-auto-adjust') !== 'false';
        const storedScale = parseFloat(localStorage.getItem('display-text-scale') || '1.0');
        const storedCat = localStorage.getItem('display-screen-cat');
        const storedInches = localStorage.getItem('display-screen-inches');

        autoToggle.checked = isAuto;
        zoomSlider.value = Math.round(storedScale * 100);
        zoomVal.textContent = `${Math.round(storedScale * 100)}%`;

        const realDetails = estimateScreenDetails();
        statRes.textContent = realDetails.resolution;
        statDpr.textContent = realDetails.dpr;
        statPpi.textContent = realDetails.ppi;

        trigger.addEventListener('click', () => {
            panel.classList.toggle('active');
            trigger.classList.toggle('active');
        });

        closeBtn.addEventListener('click', () => {
            panel.classList.remove('active');
            trigger.classList.remove('active');
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                panel.classList.remove('active');
                trigger.classList.remove('active');
            }
        });

        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !trigger.contains(e.target) && panel.classList.contains('active')) {
                panel.classList.remove('active');
                trigger.classList.remove('active');
            }
        });

        function applyDisplaySettings() {
            const autoActive = autoToggle.checked;
            localStorage.setItem('display-auto-adjust', autoActive);

            if (autoActive) {
                tabsContainer.classList.add('disabled');
                tabs.forEach(t => t.classList.remove('active'));

                const details = estimateScreenDetails();
                document.documentElement.setAttribute('data-screen-inches', details.inches);
                document.documentElement.setAttribute('data-screen-inches-cat', details.category);
                
                inchesVal.textContent = `${details.inches}" (${details.category.toUpperCase()})`;
                
                localStorage.setItem('display-screen-cat', details.category);
                localStorage.setItem('display-screen-inches', details.inches);
            } else {
                tabsContainer.classList.remove('disabled');
                
                let activeCat = localStorage.getItem('display-screen-cat') || 'laptop';
                let activeInches = localStorage.getItem('display-screen-inches') || '14.0';

                let foundTab = false;
                tabs.forEach(tab => {
                    if (tab.dataset.cat === activeCat) {
                        tab.classList.add('active');
                        activeInches = tab.dataset.val;
                        foundTab = true;
                    } else {
                        tab.classList.remove('active');
                    }
                });

                if (!foundTab && tabs.length > 0) {
                    tabs[2].classList.add('active');
                    activeCat = 'laptop';
                    activeInches = '14.0';
                }

                document.documentElement.setAttribute('data-screen-inches', activeInches);
                document.documentElement.setAttribute('data-screen-inches-cat', activeCat);
                inchesVal.textContent = `${activeInches}" (${activeCat.toUpperCase()})`;

                localStorage.setItem('display-screen-cat', activeCat);
                localStorage.setItem('display-screen-inches', activeInches);
            }
        }

        autoToggle.addEventListener('change', () => {
            applyDisplaySettings();
        });

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                if (autoToggle.checked) return;

                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const selectedCat = tab.dataset.cat;
                const selectedVal = tab.dataset.val;

                localStorage.setItem('display-screen-cat', selectedCat);
                localStorage.setItem('display-screen-inches', selectedVal);

                applyDisplaySettings();
            });
        });

        zoomSlider.addEventListener('input', (e) => {
            const pct = parseInt(e.target.value);
            zoomVal.textContent = `${pct}%`;
            const scale = (pct / 100).toFixed(2);
            document.documentElement.style.setProperty('--text-scale', scale);
            localStorage.setItem('display-text-scale', scale);
        });

        applyDisplaySettings();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDisplayWidget);
    } else {
        initDisplayWidget();
    }
})();
