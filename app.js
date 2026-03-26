/**
 * Solar Gap Analysis Application
 * Fetches NASA POWER API data and calculates max consecutive "no-sun" days.
 */

const UI = {
    threshold: document.getElementById('threshold'),
    startMonth: document.getElementById('startMonth'),
    endMonth: document.getElementById('endMonth'),
    locations: document.getElementById('locations'), // New: textarea for multiple locations
    btn: document.getElementById('analyzeBtn'),
    loader: document.getElementById('loader'),
    resultsSection: document.getElementById('resultsSection'),
    resultsBody: document.getElementById('resultsBody'),
    allTimeMax: document.getElementById('allTimeMax'),
    avgMaxGap: document.getElementById('avgMaxGap'),
};

UI.btn.addEventListener('click', async () => {
    try {
        const threshold = parseFloat(UI.threshold.value) / 1000; // Convert Wh to kWh
        const startMonth = parseInt(UI.startMonth.value);
        const endMonth = parseInt(UI.endMonth.value);

        const locationStrings = UI.locations.value.split('\n').filter(s => s.trim().length > 0);
        const allResults = [];

        if (locationStrings.length === 0) {
            throw new Error('Please enter at least one location.');
        }

        setLoading(true, `Starting analysis for ${locationStrings.length} locations...`);

        for (let i = 0; i < locationStrings.length; i++) {
            const locStr = locationStrings[i].trim();
            const parts = locStr.split(/[\s,]+/).filter(p => p.length > 0);
            if (parts.length < 2) continue;

            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);

            if (isNaN(lat) || isNaN(lon)) {
                throw new Error(`Invalid coordinates: "${locStr}"`);
            }

            setLoading(true, `Fetching data for location ${i + 1} of ${locationStrings.length} (${lat}, ${lon})...`);

            const rawData = await fetchSolarData(lat, lon);
            const locationResults = processSolarGaps(rawData, { lat, lon, threshold, startMonth, endMonth });

            if (locationResults.length > 0) {
                // Determine the longest gap across all years for this location
                const worstYear = locationResults.reduce((prev, current) => (prev.maxGap > current.maxGap) ? prev : current);
                allResults.push(worstYear);
            }
        }

        if (allResults.length === 0) {
            throw new Error('No data found for the selected range/locations.');
        }

        renderResults(allResults);

    } catch (error) {
        alert(`Error: ${error.message}`);
        console.error(error);
    } finally {
        setLoading(false);
    }
});


/**
 * Fetches daily solar irradiance data from NASA POWER API
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Object>}
 */
async function fetchSolarData(lat, lon) {
    const start = '19840101';
    const end = '20241231';
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}&format=JSON`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('NASA API request failed');
    return await response.json();
}

/**
 * Processes the raw NASA data to find consecutive low-sun days
 * @param {Object} rawData
 * @param {Object} config
 * @returns {Array} List of yearly results
 */
function processSolarGaps(rawData, config) {
    const timeSeries = rawData.properties.parameter.ALLSKY_SFC_SW_DWN;
    const years = {};
    const results = [];

    // Group data by year
    for (const [dateStr, value] of Object.entries(timeSeries)) {
        const year = dateStr.substring(0, 4);
        const month = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed

        // Filter by month range
        if (isMonthInRange(month, config.startMonth, config.endMonth)) {
            if (!years[year]) years[year] = [];
            years[year].push({
                date: dateStr,
                value: value
            });
        }
    }

    // Calculate max consecutive gaps per year
    for (const [year, dayList] of Object.entries(years)) {
        let maxConsecutive = 0;
        let currentConsecutive = 0;

        dayList.forEach(day => {
            // Check if day is below irradiance threshold
            if (day.value < config.threshold) {
                currentConsecutive++;
                if (currentConsecutive > maxConsecutive) {
                    maxConsecutive = currentConsecutive;
                }
            } else {
                currentConsecutive = 0;
            }
        });

        results.push({
            lat: config.lat,
            lon: config.lon,
            year: year,
            maxGap: maxConsecutive,
            range: `${getMonthName(config.startMonth)} - ${getMonthName(config.endMonth)}`
        });
    }

    return results.sort((a, b) => b.year - a.year);
}

/**
 * Check if a month index is within the user's selected range (handles wrap-around)
 */
function isMonthInRange(m, start, end) {
    if (start <= end) {
        return m >= start && m <= end;
    } else {
        // Wraps around new year (e.g. Oct to April)
        return m >= start || m <= end;
    }
}

/**
 * Renders the results table and summary stats
 */
function renderResults(results) {
    UI.resultsBody.innerHTML = '';
    UI.resultsSection.style.display = 'block';

    let totalMax = 0;
    let sumGap = 0;

    results.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.lat.toFixed(4)}</td>
            <td>${row.lon.toFixed(4)}</td>
            <td style="font-weight: 600; color: ${row.maxGap > 0 ? 'var(--primary)' : 'var(--text-dim)'}">
                ${row.maxGap} ${row.maxGap === 1 ? 'day' : 'days'}
            </td>
            <td>Worst year: ${row.year} <small>(${row.range})</small></td>
        `;
        UI.resultsBody.appendChild(tr);

        if (row.maxGap > totalMax) totalMax = row.maxGap;
        sumGap += row.maxGap;
    });

    UI.allTimeMax.textContent = totalMax;
    UI.avgMaxGap.textContent = (sumGap / results.length).toFixed(1);

    UI.resultsSection.scrollIntoView({ behavior: 'smooth' });
}

function setLoading(isLoading, message = 'Processing...') {
    UI.loader.style.display = isLoading ? 'flex' : 'none';
    UI.btn.disabled = isLoading;
    UI.btn.textContent = isLoading ? 'Processing...' : 'Analyze Historical Gaps';
    if (message) {
        const p = UI.loader.querySelector('p');
        if (p) p.textContent = message;
    }
}

function getMonthName(index) {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[index];
}
