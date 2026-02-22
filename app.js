// --- Global State ---
const BOT_TOKEN = "8557613495:AAGFQbDDcuJ6bJDndBUG75xKDHUGh19IYzU";
const GROUP_ID = "-1003876310720";

// --- Supabase Config ---
const SUPABASE_URL = "https://jbsjjhzcshjudeezywtr.supabase.co";
const SUPABASE_KEY = "sb_publishable_WtOqT5OLD30iUnOVfPRK4w_zdqK09PT";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let map, miniMap, userMarker, userLatLng;
let prayerTimesData = null; // Will be set after NANGOLKOT_DEFAULT_TIMES is defined
let notificationSent = {};
let timerInterval = null;

// Default Static Times for Nangolkot (Fallback)
const NANGOLKOT_DEFAULT_TIMES = {
    "Fajr": "04:56", "Sunrise": "06:12", "Dhuhr": "12:10", "Asr": "15:30",
    "Sunset": "18:05", "Maghrib": "18:05", "Isha": "19:20", "Imsak": "04:46",
    "Sehri": "04:46", "Iftar": "18:05"
};

const NANGOLKOT = [23.4670, 90.9040];

// --- Global State ---
let locations = [];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    try { updateDate(); } catch (e) { console.error("Error in updateDate:", e); }
    try { initMaps(); } catch (e) { console.error("Error in initMaps:", e); }
    try { initTabs(); } catch (e) { console.error("Error in initTabs:", e); }
    try { initGlobalNotice(); } catch (e) { console.error("Error in initGlobalNotice:", e); }
    try { renderStats(); } catch (e) { console.error("Error in renderStats:", e); }

    // Initial data load from Supabase
    fetchLocationsFromSupabase();

    // Onboarding & Permissions Logic
    const hasSeenWelcome = sessionStorage.getItem('has_seen_welcome');
    if (hasSeenWelcome) {
        // Returning user: Request permissions immediately
        try { requestLocationAndTimes(); } catch (e) { console.error("Error in requestLocationAndTimes:", e); }
        try { requestNotificationPermission(); } catch (e) { console.error("Error in requestNotificationPermission:", e); }
    } else {
        // First-time user: Show welcome modal first
        setTimeout(showWelcomeModal, 2000);
    }

    setInterval(checkForTimeAlerts, 60000);
    setInterval(renderPrayerTimes, 60000);

    // UI Events
    const addBtn = document.getElementById('add-btn');
    if (addBtn) addBtn.onclick = () => openModal();

    const closeBtns = document.querySelectorAll('.close-modal');
    closeBtns.forEach(btn => {
        btn.onclick = () => {
            closeModal();
            closeReportModal();
            closeReviewModal();
        };
    });

    const subForm = document.getElementById('submission-form');
    if (subForm) subForm.onsubmit = handleSubmission;

    const repForm = document.getElementById('report-form');
    if (repForm) repForm.onsubmit = handleReport;

    const locateBtn = document.getElementById('locate-me');
    if (locateBtn) locateBtn.onclick = locateUser;
});

// trackVisitor is defined below (cookie-based, 1 user = 1 SMS only)

function showWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.style.display = 'flex';
}

function closeWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.style.display = 'none';
    sessionStorage.setItem('has_seen_welcome', 'true');

    // Request permissions right after they close the welcome modal
    try { requestLocationAndTimes(); } catch (e) { console.error("Error in requestLocationAndTimes:", e); }
    try { requestNotificationPermission(); } catch (e) { console.error("Error in requestNotificationPermission:", e); }
}

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
    // 1. SET DEFAULTS IMMEDIATELY (Nangolkot)
    // This solves the "Loading..." issue - user sees something right away
    prayerTimesData = NANGOLKOT_DEFAULT_TIMES;
    if (map) map.setView(NANGOLKOT, 13);

    renderPrayerTimes();
    initTimer();

    // 2. Try to get better data from API for Nangolkot
    fetchPrayerTimes(NANGOLKOT[0], NANGOLKOT[1]);

    // 3. Request Real Location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                // Save that user allowed location
                sessionStorage.setItem('location_allowed', 'true');

                if (userMarker && map) map.removeLayer(userMarker);
                if (map) {
                    userMarker = L.circle([latitude, longitude], { radius: 50, color: 'gold' }).addTo(map);
                    map.setView([latitude, longitude], 14);
                }

                await fetchPrayerTimes(latitude, longitude);
                trackVisitor({ lat: latitude, lng: longitude });
            },
            (error) => {
                console.warn("Location denied");
                // If it's first time or they previously said yes, maybe show a hint
                if (sessionStorage.getItem('location_allowed') === 'true') {
                    showToast("লোকেশন পারমিশন দিলে আপনার এলাকার সঠিক সময় দেখতে পাবেন", "info");
                }
                trackVisitor(null);
            }
        );
    } else {
        trackVisitor(null);
    }
}

function requestNotificationPermission() {
    if (!("Notification" in window)) return;

    // If not granted or denied, keep checking/asking on interactions
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    } else if (Notification.permission === 'denied') {
        // Just a subtle hint if they denied it
        console.log("Notification permission was previously denied.");
    }
}

async function fetchPrayerTimes(lat, lng) {
    try {
        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        // Method 1 (University of Islamic Sciences, Karachi) is standard for Bangladesh
        const response = await fetch(`https://api.aladhan.com/v1/timings/${date}?latitude=${lat}&longitude=${lng}&method=1`);
        const data = await response.json();

        if (data.code === 200) {
            prayerTimesData = data.data.timings;
            // Map Sehri/Iftar specifically if not present
            if (!prayerTimesData.Sehri) prayerTimesData.Sehri = prayerTimesData.Imsak;
            if (!prayerTimesData.Iftar) prayerTimesData.Iftar = prayerTimesData.Maghrib;

            renderPrayerTimes();
            initTimer();
            checkForTimeAlerts();
        }
    } catch (error) {
        console.error("API Error:", error);
        // Fallback already set in requestLocationAndTimes, but ensure it's rendered
        if (!prayerTimesData) prayerTimesData = NANGOLKOT_DEFAULT_TIMES;
        renderPrayerTimes();
        initTimer();
        showToast("সরাসরি তথ্য পাওয়া যায়নি, ডিফল্ট সময় ব্যবহার করা হচ্ছে।", "info");
    }
}


function checkForTimeAlerts() {
    if (!prayerTimesData) return;

    const now = new Date();
    const currentH = String(now.getHours()).padStart(2, '0');
    const currentM = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${currentH}:${currentM}`;

    const alerts = {
        "Imsak": "সেহরির সময় শেষ হয়েছে। রোজা শুরু।",
        "Fajr": "ফজরের সময় হয়েছে। নামাযের প্রস্তুতি নিন।",
        "Dhuhr": "যোহরের সময় হয়েছে।",
        "Asr": "আসরের সময় হয়েছে।",
        "Maghrib": "আলহামদুলিল্লাহ, ইফতারের সময় হয়েছে! রোজা ভাঙুন।",
        "Isha": "এশার সময় হয়েছে। তারাবিহ নামাযের প্রস্তুতি নিন।"
    };

    Object.keys(alerts).forEach(key => {
        if (prayerTimesData[key] === currentTime && !notificationSent[key + currentTime]) {
            sendNotification(alerts[key]);
            notificationSent[key + currentTime] = true;
            // Also refresh stats/UI
            renderPrayerTimes();
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

    // Clear existing interval if any
    if (timerInterval) clearInterval(timerInterval);

    const prayerMap = {
        "Imsak": "সেহরি শেষ",
        "Fajr": "ফজর",
        "Dhuhr": "যোহর",
        "Asr": "আসর",
        "Maghrib": "ইফতার",
        "Isha": "এশা"
    };

    function updateCountdown() {
        if (!prayerTimesData) return;
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();

        // Target Iftar (Maghrib) if it hasn't passed, otherwise target next prayer
        let targetP = "ইফতার";
        let targetTimeStr = prayerTimesData["Maghrib"] || prayerTimesData["Iftar"];

        const [h, m] = targetTimeStr.split(':');
        let tMins = parseInt(h) * 60 + parseInt(m);

        let targetDate = new Date();
        targetDate.setHours(parseInt(h), parseInt(m), 0, 0);

        // If Iftar has passed, find next prayer (Isha or tomorrow's Sehri)
        if (nowMins >= tMins) {
            const keys = ["Isha", "Sehri", "Fajr", "Dhuhr", "Asr", "Maghrib"];
            for (let key of keys) {
                if (!prayerTimesData[key]) continue;
                const [ph, pm] = prayerTimesData[key].split(':');
                const pMins = parseInt(ph) * 60 + parseInt(pm);

                let pTime = new Date();
                if (key === "Sehri" && ph < 12) pTime.setDate(pTime.getDate() + 1); // Tomorrow's Sehri
                pTime.setHours(parseInt(ph), parseInt(pm), 0, 0);

                if (pTime > now) {
                    targetP = prayerMap[key] || key;
                    targetDate = pTime;
                    break;
                }
            }
        }

        const labelEl = document.getElementById('next-prayer-label');
        const timerEl = document.getElementById('iftar-timer');

        // Check if it's Eid (Assume Ramadan 2026 ends around March 20)
        const currentMonth = now.getMonth() + 1;
        const currentDay = now.getDate();
        if ((currentMonth === 3 && currentDay >= 21) || currentMonth > 3) {
            if (labelEl) labelEl.innerText = " ঈদ মোবারক!";
            if (timerEl) timerEl.innerHTML = '<div class="time-block" style="width:100%"><span style="font-size:1.8rem; font-family:var(--font-bn)">পবিত্র ঈদুল ফিতর ২০২৬</span></div>';
            return;
        }

        let diff = targetDate - now;
        const h_diff = Math.floor(diff / (1000 * 60 * 60));
        const m_diff = Math.floor((diff / (1000 * 60)) % 60);
        const s_diff = Math.floor((diff / 1000) % 60);

        if (labelEl) labelEl.innerText = `${targetP} হতে বাকি:`;
        if (timerEl) {
            timerEl.innerHTML = `
                <div class="time-block"><span id="hours">${String(h_diff).padStart(2, '0')}</span><small>ঘণ্টা</small></div>
                <div class="time-divider">:</div>
                <div class="time-block"><span id="mins">${String(m_diff).padStart(2, '0')}</span><small>মিনিট</small></div>
                <div class="time-divider">:</div>
                <div class="time-block"><span id="secs">${String(s_diff).padStart(2, '0')}</span><small>সেকেন্ড</small></div>
            `;
        }
    }
    timerInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
}

// --- Food Type Translation ---
function translate(type) {
    const map = {
        'biryani': 'বিরিয়ানি',
        'kacchi': 'কাচ্চি',
        'khichuri': 'খিচুড়ি',
        'muri': 'বুট মুড়ি',
        'others': 'অন্যান্য',
        'full': 'পুরো রমজান মাস',
        'last10': 'শেষ ১০ দিন',
        'fridays': 'শুধু শুক্রবার',
        'custom': 'নির্দিষ্ট কিছু দিন'
    };
    return map[type] || type;
}

// --- Map Logic ---

function initMaps() {
    const mainMapEl = document.getElementById('main-map');
    if (mainMapEl) {
        map = L.map('main-map', { zoomControl: false }).setView(NANGOLKOT, 14);

        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        });

        const satellite = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye',
                maxZoom: 19
            }
        ).addTo(map);

        satellite.on('tileerror', () => osm.addTo(map));

        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, opacity: 0.7 }
        ).addTo(map);

        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    }

    const miniMapEl = document.getElementById('mini-map');
    if (miniMapEl) {
        miniMap = L.map('mini-map', { zoomControl: true }).setView(NANGOLKOT, 15);
        // Satellite tiles for mini-map
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri'
        }).addTo(miniMap);
        // Labels overlay
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19, opacity: 0.8
        }).addTo(miniMap);

        let miniMarker;
        miniMap.on('click', (e) => {
            const { lat, lng } = e.latlng;
            if (miniMarker) miniMap.removeLayer(miniMarker);
            const selectedIcon = L.divIcon({
                className: '',
                html: `<div style="background:#fbbf24; border:3px solid white; border-radius:50%; width:20px; height:20px; box-shadow:0 0 0 4px rgba(251,191,36,0.4); animation: pulse 1s infinite;"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            miniMarker = L.marker([lat, lng], { icon: selectedIcon }).addTo(miniMap);
            document.getElementById('form-lat').value = lat;
            document.getElementById('form-lng').value = lng;
            const msg = document.getElementById('loc-confirm-msg');
            if (msg) msg.style.display = 'block';
        });
    }
}

function goToMapView() {
    const mapTab = document.querySelector('[data-tab="map-view"]');
    if (mapTab) mapTab.click();
    window.scrollTo({ top: document.querySelector('.content-tabs').offsetTop - 100, behavior: 'smooth' });
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

async function fetchLocationsFromSupabase() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('iftar_locations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        if (data) {
            locations = data;
            loadLocations(); // Re-render markers and list
        }
    } catch (err) {
        console.error("Supabase load error:", err);
        loadLocations();
    }
}

function loadLocations() {
    const listContainer = document.getElementById('location-list');
    if (!listContainer) return;

    // Clear existing markers
    if (map) {
        map.eachLayer(layer => {
            if (layer instanceof L.Marker && layer !== userMarker) map.removeLayer(layer);
        });
    }

    listContainer.innerHTML = '';

    const foodFilter = document.getElementById('food-filter').value;
    const distFilter = document.getElementById('distance-filter').value;
    const q = (document.getElementById('search-iftar-input')?.value || '').toLowerCase();
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

        // Apply Search Filter
        if (q && !loc.orgName.toLowerCase().includes(q)) return;

        // Apply Distance Filter
        if (distFilter !== 'all' && userLatLng) {
            const distance = userLatLng.distanceTo([loc.lat, loc.lng]) / 1000; // km
            if (distance > parseInt(distFilter)) return;
        }

        // Add Marker with custom icon
        let marker = null;
        if (map) {
            marker = L.marker([loc.lat, loc.lng], { icon: icons[loc.foodType] || icons.others }).addTo(map);
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
        }

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
    const engagement = JSON.parse(sessionStorage.getItem('engaged_spots') || '{}');
    const myEngagement = engagement[loc.id] || {};
    const now = Date.now();
    const canVoteAgain = !myEngagement.voteTime || (now - myEngagement.voteTime >= 24 * 60 * 60 * 1000);

    // UI highlight should only show if vote is still within the 24h cooldown
    const activeVote = canVoteAgain ? null : myEngagement.voted;

    const div = document.createElement('div');
    div.className = 'location-card';
    div.innerHTML = `
        <div class="card-header">
            <span class="badge badge-${loc.foodType}">${translate(loc.foodType)}</span>
            ${loc.verified ? '<span class="badge badge-verified"><i class="fas fa-check-circle"></i> ভেরিফাইড</span>' : ''}
        </div>
        <h3>${loc.orgName}</h3>
        <p><i class="fas fa-clock gold-text"></i> সময়: ${loc.time} | <i class="fas fa-users gold-text"></i> ${loc.quantity || 'অজানা'} জন</p>
        
        <div class="engagement-bar" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px; background:rgba(255,255,255,0.03); border-radius:10px; border:1px solid var(--glass-border);">
            <div style="display:flex; gap:15px;">
                <span onclick="handleSentiment(${loc.id}, 'like')" style="cursor:pointer; color:${activeVote === 'like' ? 'var(--accent-gold)' : 'var(--text-muted)'}; font-size:0.9rem;">
                    <i class="fas fa-heart"></i> ${loc.likes}
                </span>
                <span onclick="handleSentiment(${loc.id}, 'dislike')" style="cursor:pointer; color:${activeVote === 'dislike' ? '#ef4444' : 'var(--text-muted)'}; font-size:0.9rem;">
                    <i class="fas fa-thumbs-down"></i> ${loc.dislikes}
                </span>
            </div>
            <span onclick="openReviewModal(${loc.id})" style="cursor:pointer; color:var(--text-muted); font-size:0.85rem; border-bottom:1px dashed var(--text-muted);">
                <i class="fas fa-comment-dots"></i> ${loc.reviews.length} রিভিউ
            </span>
        </div>

        <div class="verification-actions">
            <button onclick="verify(${loc.id}, true)" class="btn-action success">
                <i class="fas fa-check"></i> পেয়েছি (${loc.confirmations})
            </button>
            <button onclick="verify(${loc.id}, false)" class="btn-action danger">
                <i class="fas fa-times"></i> পাইনি (${loc.reports})
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
    const modal = document.getElementById('add-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'flex-start';
        modal.style.justifyContent = 'center';
        if (miniMap) setTimeout(() => miniMap.invalidateSize(), 200);
    }
}

function closeModal() {
    const modal = document.getElementById('add-modal');
    if (modal) modal.style.display = 'none';
}

function openReportModal(orgName = '') {
    const modal = document.getElementById('report-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.style.alignItems = 'flex-start';
        modal.style.justifyContent = 'center';
        if (orgName) document.getElementById('report-org-name').value = orgName;
    }
}

function closeReportModal() {
    const modal = document.getElementById('report-modal');
    if (modal) modal.style.display = 'none';
}

function handleReport(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const org = formData.get('report_org');
    const msg_text = formData.get('report_msg');
    const phone = formData.get('report_phone') || 'N/A';

    const telegramMsg = `
🚨 <b>নতুন অভিযোগ!</b>
🏢 স্পট: ${org || 'সাধারণ অভিযোগ'}
📝 বিবরণ: ${msg_text}
📞 কন্টাক্ট: ${phone}
    `;
    sendToTelegram(telegramMsg);

    showToast("আপনার অভিযোগ অ্যাডমিনের কাছে পাঠানো হয়েছে। ধন্যবাদ।", "success");
    closeReportModal();
    e.target.reset();

    // Show Confirmation Overlay
    document.getElementById('cm-icon').textContent = '📧';
    document.getElementById('cm-title').textContent = 'ধন্যবাদ!';
    document.getElementById('cm-msg').textContent = 'আপনার অভিযোগটি সফলভাবে জমা হয়েছে। আমাদের অ্যাডমিন প্যানেল দ্রুত এটি যাচাই করে প্রয়োজনীয় ব্যবস্থা গ্রহণ করবে।';
    document.getElementById('confirm-overlay').style.display = 'flex';
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
        isDaily: formData.get('isDaily') === 'on',
        startDate: formData.get('startDate'),
        endDate: formData.get('endDate')
    };

    // Send to Supabase
    if (supabaseClient) {
        supabaseClient.from('iftar_locations').insert([newLoc]).then(({ error }) => {
            if (error) console.error("Supabase Insert Error:", error);
            else fetchLocationsFromSupabase(); // Refresh local list
        });
    }

    // Send Submission to Telegram
    const msg = `
<b>🥘 New Iftar Submission!</b>
🏢 Org: ${newLoc.orgName}
🍴 Food: ${translate(newLoc.foodType)}
⏰ Time: ${newLoc.time}
📅 Duration: ${newLoc.startDate} to ${newLoc.endDate}
👥 Quantity: ${newLoc.quantity}
📍 Location: ${newLoc.lat}, ${newLoc.lng}
📞 Contact: ${formData.get('phone') || 'N/A'}
    `;
    sendToTelegram(msg);

    showToast("আপনার সাবমিশন সফল হয়েছে। অ্যাডমিন অ্যাপ্রুভ করার পর এটি ম্যাপে দেখা যাবে।", "success");
    closeModal();
    e.target.reset();
    renderStats();

    // Show Confirmation Overlay
    document.getElementById('cm-icon').textContent = '🕌';
    document.getElementById('cm-title').textContent = 'আলহামদুলিল্লাহ!';
    document.getElementById('cm-msg').textContent = 'আপনার দেওয়া ইফতার স্পটটির তথ্য সফলভাবে গ্রহণ করা হয়েছে। অ্যাডমিন এটি যাচাই করে অ্যাপ্রুভ দিলেই ম্যাপে দেখা যাবে।';
    document.getElementById('confirm-overlay').style.display = 'flex';
}

async function verify(id, isPositive) {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    if (isPositive) {
        loc.confirmations++;
        document.getElementById('cm-icon').textContent = '✅';
        document.getElementById('cm-title').textContent = 'আলহামদুলিল্লাহ!';
        document.getElementById('cm-msg').textContent = `আপনি নিশ্চিত করেছেন যে "${loc.orgName}" তে ইফতার পেয়েছেন। আল্লাহ কবুল করুন।`;

        if (supabaseClient) {
            await supabaseClient.from('iftar_locations').update({ confirmations: loc.confirmations }).eq('id', id);
        }
    } else {
        loc.reports++;
        document.getElementById('cm-icon').textContent = '😔';
        document.getElementById('cm-title').textContent = 'দুঃখিত!';
        document.getElementById('cm-msg').textContent = `আমরা দুঃখিত যে আপনি "${loc.orgName}" তে ইফতার পাননি। বিষয়টি যাচাই করার জন্য অ্যাডমিনকে জানানো হয়েছে।`;

        if (supabaseClient) {
            await supabaseClient.from('iftar_locations').update({ reports: loc.reports }).eq('id', id);
        }

        // Notify Admin about the report
        const reportMsg = `
⚠️ <b>স্পট রিপোর্ট!</b> (ইফতার পাওয়া যায়নি)
🏢 স্পট: ${loc.orgName}
📍 লোকেশন: ${loc.lat}, ${loc.lng}
📊 বর্তমান রিপোর্ট সংখ্যা: ${loc.reports}
        `;
        sendToTelegram(reportMsg);
    }

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
    const container = document.getElementById('notice-container');
    // Notice system removed from local storage. Needs Supabase table for global broadcast.
    if (container) container.innerHTML = '';
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

async function trackVisitor(pos) {
    // ===== 1 USER = 1 SMS ONLY (cookie-based permanent) =====
    const COOKIE_KEY = 'iftar_visitor_sent';
    const alreadySent = document.cookie.split(';').some(c => c.trim().startsWith(COOKIE_KEY + '='));
    if (alreadySent) {
        console.log('Visitor already tracked, skipping Telegram.');
        return;
    }
    // Set cookie for 365 days — ১ user ১ বারই SMS যাবে
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${COOKIE_KEY}=1; expires=${expires}; path=/; SameSite=Lax`;
    const lat = pos ? pos.lat : NANGOLKOT[0];
    const lng = pos ? pos.lng : NANGOLKOT[1];

    // Visitor Count (locally tracked per session if absolute no storage requested)
    let vCount = parseInt(sessionStorage.getItem('visitor_count') || '0');
    vCount++;
    sessionStorage.setItem('visitor_count', vCount.toString());

    // Save visitor profile (unlimited history)
    const profile = {
        time: new Date().toLocaleString('bn-BD'),
        lat, lng,
        page: window.location.href,
        ua: navigator.userAgent,
        lang: navigator.language,
        screen: `${screen.width}x${screen.height}`,
        isDefault: !pos
    };
    let logs = JSON.parse(sessionStorage.getItem('visitor_logs') || '[]');
    logs.unshift(profile);
    sessionStorage.setItem('visitor_logs', JSON.stringify(logs)); // session limited

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
#${vCount} ভিজিটর
    `;

    sendToTelegram(msg);
}


// --- Utils ---
function translate(val) {
    const map = {
        'biryani': 'বিরিয়ানি',
        'kacchi': 'কাচ্ছি',
        'khichuri': 'খিচুড়ি',
        'muri': 'বুট মুড়ি',
        'others': 'অন্যান্য',
        'full': 'পুরো রমজান মাস',
        'last10': 'শেষ ১০ দিন',
        'fridays': 'শুধু শুক্রবার',
        'custom': 'নির্দিষ্ট কিছু দিন'
    };
    return map[val] || val;
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) { console.warn('Toast:', msg); return; }
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
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateStr = now.toLocaleDateString('bn-BD', options);

    const dateEl = document.getElementById('today-date-bn');
    if (dateEl) dateEl.innerText = dateStr;

    // Eid Logic for header
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const isEid = (currentMonth === 3 && currentDay >= 21) || currentMonth > 3;

    if (isEid) {
        document.body.classList.add('eid-mode');
        document.querySelector('.brand-name').innerHTML = 'ঈদ <span>মোবারক</span>';
        const noticeEl = document.getElementById('notice-container');
        if (noticeEl && !noticeEl.innerHTML) {
            noticeEl.innerHTML = `
                <div class="glass-card" style="text-align:center; padding:20px; border:2px solid var(--accent-gold);">
                    <h2 style="color:var(--accent-gold); margin-bottom:10px;">تقبل الله منا ومنكم</h2>
                    <p>আপনাকে ও আপনার পরিবারকে পবিত্র ঈদুল ফিতরের শুভেচ্ছা। ঈদ মোবারক!</p>
                </div>
            `;
        }
    }

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
            </div>`;
        return;
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const isEid = (currentMonth === 3 && currentDay >= 21) || currentMonth > 3;

    if (isEid) {
        container.innerHTML = `
            <div class="calendar-header" style="padding:40px 0;">
                <i class="fas fa-moon gold-text" style="font-size:3rem; margin-bottom:15px;"></i>
                <h2 style="color:var(--accent-gold);">ঈদ মোবারক ২০২৬</h2>
                <p>রমজান সম্পন্ন হয়েছে। আল্লাহ সকলের রোজা ও ইবাদত কবুল করুন।</p>
                <div style="margin-top:20px; font-size:1.2rem; color:white;">পবিত্র ঈদুল ফিতর ২০২৬</div>
            </div>
        `;
        return;
    }

    const prayerMap = {
        "Imsak": { label: "সেহরি (শেষ সময়)", icon: "fa-moon", highlight: true },
        "Fajr": { label: "ফজর", icon: "fa-star-and-crescent", highlight: false },
        "Dhuhr": { label: "যোহর", icon: "fa-sun", highlight: false },
        "Asr": { label: "আসর", icon: "fa-cloud-sun", highlight: false },
        "Maghrib": { label: "মাগরিব (ইফতার)", icon: "fa-utensils", highlight: true },
        "Isha": { label: "এশা ও তারাবি", icon: "fa-mosque", highlight: false }
    };

    // Check which prayer is next
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

    const gregDate = new Date().toLocaleDateString('bn-BD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
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
    }).join('')}`;
}

function formatTime(time24) {
    if (!time24) return '--:--';
    const [h, m] = time24.split(':');
    const hours = parseInt(h);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${m} ${suffix}`;
}

// --- Review & Sentiment Handlers ---
function openReviewModal(id) {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    document.getElementById('review-spot-id').value = id;
    document.getElementById('review-location-info').textContent = `লোকেশন: ${loc.orgName}`;
    const reviewModal = document.getElementById('review-modal');
    if (reviewModal) {
        reviewModal.style.display = 'flex';
        reviewModal.style.alignItems = 'flex-start';
        reviewModal.style.justifyContent = 'center';
    }

    // Load existing reviews
    const list = document.getElementById('reviews-list');
    list.innerHTML = loc.reviews.length
        ? loc.reviews.map(r => `
            <div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:12px; border-left:3px solid var(--accent-gold);">
                <p style="font-size:0.9rem; margin-bottom:4px;">"${r.text}"</p>
                <div style="font-size:0.75rem; color:var(--text-muted); text-align:right;">— ${r.time}</div>
            </div>
        `).join('')
        : '<p style="color:var(--text-muted); text-align:center; font-size:0.85rem;">এখনো কোনো রিভিউ নেই। প্রথম রিভিউটি আপনি দিন!</p>';
}

function closeReviewModal() {
    document.getElementById('review-modal').style.display = 'none';
}

async function submitReview(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('review-spot-id').value);
    const text = document.getElementById('review-text').value;
    const loc = locations.find(l => l.id === id);

    if (loc && text.trim()) {
        const review = {
            text: text,
            time: new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' })
        };
        loc.reviews.push(review);

        if (supabaseClient) {
            await supabaseClient.from('iftar_locations').update({ reviews: loc.reviews }).eq('id', id);
        }

        // Save engagement locally to track who reviewed
        const engagement = JSON.parse(sessionStorage.getItem('engaged_spots') || '{}');
        if (!engagement[id]) engagement[id] = {};
        engagement[id].reviewed = true;
        sessionStorage.setItem('engaged_spots', JSON.stringify(engagement));

        showToast("আপনার রিভিউ জমা হয়েছে। ধন্যবাদ!", "success");
        closeReviewModal();
        e.target.reset();
        loadLocations();
    }
}

async function handleSentiment(id, type) {
    const engagement = JSON.parse(sessionStorage.getItem('engaged_spots') || '{}');
    const myEng = engagement[id] || {};
    const now = Date.now();

    // Check if user voted within the last 24 hours
    if (myEng.voteTime && (now - myEng.voteTime < 24 * 60 * 60 * 1000)) {
        const remainingMs = 24 * 60 * 60 * 1000 - (now - myEng.voteTime);
        const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
        showToast(`আপনি ইতিমধ্যে ভোট দিয়েছেন। আবার ভোট দিতে ${remainingHours} ঘণ্টা অপেক্ষা করুন।`, "info");
        return;
    }

    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    if (type === 'like') {
        loc.likes++;
        if (supabaseClient) await supabaseClient.from('iftar_locations').update({ likes: loc.likes }).eq('id', id);
    } else {
        loc.dislikes++;
        if (supabaseClient) await supabaseClient.from('iftar_locations').update({ dislikes: loc.dislikes }).eq('id', id);
    }

    myEng.voted = type;
    myEng.voteTime = now;
    engagement[id] = myEng;
    sessionStorage.setItem('engaged_spots', JSON.stringify(engagement));

    showToast(type === 'like' ? "ধন্যবাদ! আপনি এটি পছন্দ করেছেন।" : "মতামতের জন্য ধন্যবাদ।", "success");
    loadLocations();
}

// --- Global Notice System ---
function initGlobalNotice() {
    const container = document.getElementById('global-notification-bar');
    // Global notice removed from sessionStorage.
    if (container) container.style.display = 'none';
}
