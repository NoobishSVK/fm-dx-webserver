const fetch = require('node-fetch');
const { serverConfig } = require('./server_config')

let cachedData = {};

let lastFetchTime = 0;
const fetchInterval = 3000;

const esSwitchCache = {"lastCheck":0, "esSwitch":false};
const esFetchInterval = 300000;

// Fetch data from maps
function fetchTx(freq, piCode, rdsPs) {
    const now = Date.now();
    freq = parseFloat(freq);

    if(isNaN(freq)) {
        return;
    }
    // Check if it's been at least 3 seconds since the last fetch and if the QTH is correct
    if (now - lastFetchTime < fetchInterval || serverConfig.identification.lat.length < 2 || freq < 87) {
        return Promise.resolve();
    }

    lastFetchTime = now;

    // Check if data for the given frequency is already cached
    if (cachedData[freq]) {
        return processData(cachedData[freq], piCode, rdsPs);
    }

    const url = "https://maps.fmdx.pl/api?freq=" + freq;

    return fetch(url)
        .then(response => response.json())
        .then(data => {
            // Cache the fetched data for the specific frequency
            cachedData[freq] = data;
            return processData(data, piCode, rdsPs);
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
}

function processData(data, piCode, rdsPs) {
    let matchingStation = null;
    let matchingCity = null;
    let maxScore = -Infinity; // Initialize maxScore with a very low value
    let txAzimuth;
    let maxDistance;
    let esMode = checkEs();

    for (const cityId in data.locations) {
        const city = data.locations[cityId];
        if (city.stations) {
            for (const station of city.stations) {
                if (station.pi === piCode.toUpperCase() && !station.extra && station.ps && station.ps.toLowerCase().includes(rdsPs.replace(/ /g, '_').replace(/^_*(.*?)_*$/, '$1').toLowerCase())) {
                    const distance = haversine(serverConfig.identification.lat, serverConfig.identification.lon, city.lat, city.lon);
                    let weightDistance = distance.distanceKm
                    if (esMode && (distance.distanceKm > 500)) {
                        weightDistance = Math.abs(distance.distanceKm-1500);
                    }
                    const score =  (10*Math.log10(station.erp*1000)) / weightDistance; // Calculate score
                    if (score > maxScore) {
                        maxScore = score;
                        txAzimuth = distance.azimuth;
                        matchingStation = station;
                        matchingCity = city;
                        maxDistance = distance.distanceKm;
                    }
                }
            }
        }
    }

    if (matchingStation) {
        return {
            station: matchingStation.station.replace("R.", "Radio "),
            pol: matchingStation.pol.toUpperCase(),
            erp: matchingStation.erp,
            city: matchingCity.name,
            itu: matchingCity.itu,
            distance: maxDistance.toFixed(0),
            azimuth: txAzimuth.toFixed(0),
            foundStation: true
        };
    } else {
        return;
    }
}

function checkEs() {
    const now = Date.now();
    const url = "https://fmdx.org/includes/tools/get_muf.php";
    let esSwitch = false;

    if (now - esSwitchCache.lastCheck < esFetchInterval) {
        esSwitch = esSwitchCache.esSwitch;
    } else {
        esSwitchCache.lastCheck = now;
        fetch(url)
        .then(response => response.json())
        .then(data => {
            if (serverConfig.identification.lon < -32) {
                if (data.north_america.max_frequency != "No data") {
                    esSwitch = true;
                }
            } else {
                if (data.europe.max_frequency != "No data") {
                    esSwitch = true;
                }
            }
            esSwitchCache.esSwitch = esSwitch;
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
    }

    return esSwitch;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in kilometers
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Distance in kilometers
    const distance = R * c;

    // Azimuth calculation
    const y = Math.sin(dLon) * Math.cos(deg2rad(lat2));
    const x = Math.cos(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) -
              Math.sin(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.cos(dLon);
    const azimuth = Math.atan2(y, x);

    // Convert azimuth from radians to degrees
    const azimuthDegrees = (azimuth * 180 / Math.PI + 360) % 360;

    return {
        distanceKm: distance,
        azimuth: azimuthDegrees
    };
}


function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

module.exports = {
    fetchTx
};
