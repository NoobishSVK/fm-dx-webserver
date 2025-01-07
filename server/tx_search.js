const fetch = require('node-fetch');
const { serverConfig } = require('./server_config');
const consoleCmd = require('./console');

let cachedData = {};
let lastFetchTime = 0;
const fetchInterval = 1000;
const esSwitchCache = {"lastCheck":0, "esSwitch":false};
const esFetchInterval = 300000;
const usStatesGeoJsonUrl = "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
let usStatesGeoJson = null;  // To cache the GeoJSON data for US states
let Latitude = serverConfig.identification.lat;
let Longitude = serverConfig.identification.lon;

// Create WebSocket URL
const webserverPort = serverConfig.webserver.webserverPort || 8080; // Fallback to port 8080
const externalWsUrl = `ws://127.0.0.1:${webserverPort}/data_plugins`;
const WebSocket = require('ws'); 

// 5-second delay before activation
setTimeout(() => {
    const websocket = new WebSocket(externalWsUrl);

    // Event listener to receive data
    websocket.on('message', (data) => {
        try {
            // Parse the received data
            const parsedData = JSON.parse(data);

            // Check if the dataset is of type GPS
            if (parsedData.type === "GPS" && parsedData.value) {
                const gpsData = parsedData.value;
                const { status, time, lat, lon, alt, mode } = gpsData;

                if (status === "active") {
                    Latitude = parseFloat(lat);
                    Longitude = parseFloat(lon);
                }
            }
        } catch (error) {
            logError("Error processing WebSocket data:", error);
        }
    });

}, 5000);


// Load the US states GeoJSON data
async function loadUsStatesGeoJson() {
    if (!usStatesGeoJson) {
        const response = await fetch(usStatesGeoJsonUrl);
        usStatesGeoJson = await response.json();
    }
}

// Function to get bounding box of a state
function getStateBoundingBox(coordinates) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

    // Check if it's a MultiPolygon or a Polygon
    for (const polygon of coordinates) {
        // If it's a Polygon, it won't have an extra level of arrays
        const linearRings = Array.isArray(polygon[0][0]) ? polygon : [polygon];

        for (const ring of linearRings) {
            for (const [lon, lat] of ring) {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
            }
        }
    }

    return { minLat, maxLat, minLon, maxLon };
}

// Function to check if a city (lat, lon) falls within the bounding box of a state
function isCityInState(lat, lon, boundingBox) {
    return lat >= boundingBox.minLat && lat <= boundingBox.maxLat &&
           lon >= boundingBox.minLon && lon <= boundingBox.maxLon;
}

// Function to check if a city (lat, lon) is inside any US state and return the state name
function getStateForCoordinates(lat, lon) {
    if (!usStatesGeoJson) return null;

    for (const feature of usStatesGeoJson.features) {
        const boundingBox = getStateBoundingBox(feature.geometry.coordinates);
        if (isCityInState(lat, lon, boundingBox)) {
            return feature.properties.name;  // Return the state's name if city is inside bounding box
        }
    }
    return null;
}

// Fetch data from maps
async function fetchTx(freq, piCode, rdsPs) {
    const now = Date.now();
    freq = parseFloat(freq);

    if (isNaN(freq)) {
        return;
    }

    if (now - lastFetchTime < fetchInterval || Latitude.length < 2 || freq < 87) {
        return Promise.resolve();
    }

    lastFetchTime = now;

    if (cachedData[freq]) {
        return processData(cachedData[freq], piCode, rdsPs);
    }

    const url = "https://maps.fmdx.org/api/?freq=" + freq;

    return fetch(url, {
        redirect: 'manual'
    })
        .then(response => response.json())
        .then(async (data) => {
            cachedData[freq] = data;
            await loadUsStatesGeoJson();
            return processData(data, piCode, rdsPs);
        })
        .catch(error => {
            console.error("Error fetching data:", error);
        });
}

async function processData(data, piCode, rdsPs) {
    let matchingStation = null;
    let matchingCity = null;
    let maxScore = -Infinity;
    let txAzimuth;
    let maxDistance;
    let esMode = checkEs();
    let detectedByPireg = false;

    function evaluateStation(station, city, distance) {
        let weightDistance = distance.distanceKm;
        if (esMode && distance.distanceKm > 500) {
            weightDistance = Math.abs(distance.distanceKm - 1500);
        }
        let erp = station.erp && station.erp > 0 ? station.erp : 1;
        const score = (10 * Math.log10(erp * 1000)) / weightDistance;
        if (score > maxScore) {
            maxScore = score;
            txAzimuth = distance.azimuth;
            matchingStation = station;
            matchingCity = city;
            maxDistance = distance.distanceKm;
        }
    }

    // First attempt: Try to match station using the piCode
    for (const cityId in data.locations) {
        const city = data.locations[cityId];
        if (city.stations) {
            for (const station of city.stations) {
                if (station.pi === piCode.toUpperCase() && !station.extra && station.ps && station.ps.toLowerCase().includes(rdsPs.replace(/ /g, '_').replace(/^_*(.*?)_*$/, '$1').toLowerCase())) {
                    const distance = haversine(Latitude, Longitude, city.lat, city.lon);
                    evaluateStation(station, city, distance);
                    detectedByPireg = false;
                }
            }
        }
    }

    // Fallback to pireg if no match is found
    if (!matchingStation) {
        for (const cityId in data.locations) {
            const city = data.locations[cityId];
            if (city.stations) {
                for (const station of city.stations) {
                    if (station.pireg && station.pireg.toUpperCase() === piCode.toUpperCase() && !station.extra && station.ps && station.ps.toLowerCase().includes(rdsPs.replace(/ /g, '_').replace(/^_*(.*?)_*$/, '$1').toLowerCase())) {
                        const distance = haversine(Latitude, Longitude, city.lat, city.lon);
                        evaluateStation(station, city, distance);
                        detectedByPireg = true;
                    }
                }
            }
        }
    }

    // Determine the state if the city is in the USA
    if (matchingStation && matchingCity.itu === 'USA') {
        const state = getStateForCoordinates(matchingCity.lat, matchingCity.lon);
        if (state) {
            matchingCity.state = state;  // Add state to matchingCity
        }
    }

    if (matchingStation) {
        return {
            station: matchingStation.station.replace("R.", "Radio "),
            pol: matchingStation.pol.toUpperCase(),
            erp: matchingStation.erp && matchingStation.erp > 0 ? matchingStation.erp : '?',
            city: matchingCity.name,
            itu: matchingCity.state ? matchingCity.state + ', ' + matchingCity.itu : matchingCity.itu,
            distance: maxDistance.toFixed(0),
            azimuth: txAzimuth.toFixed(0),
            id: matchingStation.id,
            pi: matchingStation.pi,
            foundStation: true,
            reg: detectedByPireg
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
    } else if (Latitude > 20) {
        esSwitchCache.lastCheck = now;
        fetch(url)
        .then(response => response.json())
        .then(data => {
            if (Longitude < -32) {
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
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    const y = Math.sin(dLon) * Math.cos(deg2rad(lat2));
    const x = Math.cos(deg2rad(lat1)) * Math.sin(deg2rad(lat2)) -
              Math.sin(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.cos(dLon);
    const azimuth = Math.atan2(y, x);
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
