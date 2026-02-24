const fetch = require('node-fetch');
const { serverConfig } = require('./server_config');
const consoleCmd = require('./console');

let localDb = {};
let nextLocalDbUpdate = 0;
const localDbUpdateInterval = 7 * 24 * 60 * 60 * 1000; // 7-day database update interval
let awaitingTxInfo = true;

let lastFetchTime = 0;
let piFreqIndex = {}; // Indexing for speedier PI+Freq combinations
const fetchInterval = 1000;
const esSwitchCache = {"lastCheck": null, "esSwitch": false};
const esFetchInterval = 300000;
var currentPiCode = '';
var currentRdsPs = '';
const usStatesGeoJsonUrl = "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
let usStatesGeoJson = null;  // To cache the GeoJSON data for US states
let Latitude = serverConfig.identification.lat;
let Longitude = serverConfig.identification.lon;

// Create WebSocket URL for GPS lat/lon update.
const webserverPort = serverConfig.webserver.webserverPort || 8080; // Fallback to port 8080
const externalWsUrl = `ws://127.0.0.1:${webserverPort}/data_plugins`;
const WebSocket = require('ws'); 

// Get weighting values based on algorithm setting.
// Defaults = algorithm 1
let weightedErp = 10;
let weightedDist = 400;
const algorithms = [
    [10, 400],
    [30, 500],
    [5, 400]
];
const algoSetting = parseInt(serverConfig.webserver.txIdAlgorithm);

if (typeof algorithms[algoSetting] !== 'undefined') {
    weightedErp = algorithms[algoSetting][0];
    weightedDist = algorithms[algoSetting][1];
}

// Build the TX database.
setTimeout(buildTxDatabase, 3000);

if (serverConfig.identification.gpsMode) {
    // 5-second delay before activation of GPS lat/lon websocket
    setTimeout(() => {
        const websocket = new WebSocket(externalWsUrl);
        consoleCmd.logInfo('Set up GPS websocket for lat/lon');
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
                consoleCmd.logError("Error processing WebSocket data:", error);
            }
        });

    }, 5000);
}

// Function to build local TX database from FMDX Maps endpoint.
async function buildTxDatabase() {
    if (Latitude.length > 0 && Longitude.length > 0) {
        awaitingTxInfo = true;
        while (awaitingTxInfo) {
            try {
                consoleCmd.logInfo('Fetching transmitter database...');
                const response = await fetch(`https://maps.fmdx.org/api?qth=${serverConfig.identification.lat},${serverConfig.identification.lon}`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                localDb = await response.json();
                buildPiFreqIndex();
                consoleCmd.logInfo('Transmitter database successfully loaded.');
                nextLocalDbUpdate = Date.now() + localDbUpdateInterval;
                awaitingTxInfo = false;
            } catch (error) {
                consoleCmd.logError("Failed to fetch transmitter database:", error);
                await new Promise(res => setTimeout(res, 30000));
                consoleCmd.logInfo('Retrying transmitter database download...');
            }
        }
    } else {
        consoleCmd.logInfo('Server latitude and longitude must be set before transmitter database can be built');
    }
}

// Function to build index map of PI+Freq combinations
function buildPiFreqIndex() {
    piFreqIndex = {}; // reset
    for (const locData of Object.values(localDb.locations || {})) {
        for (const station of locData.stations || []) {
            if (!station.freq) continue;
            const freq = station.freq;
            const pi = station.pi?.toUpperCase();
            const pireg = station.pireg?.toUpperCase();
            if (pi) {
                const key = `${freq}|${pi}`;
                if (!piFreqIndex[key]) piFreqIndex[key] = [];
                piFreqIndex[key].push({ ...locData, station });
            }
            if (pireg) {
                const regKey = `${freq}|${pireg}`;
                if (!piFreqIndex[regKey]) piFreqIndex[regKey] = [];
                piFreqIndex[regKey].push({ ...locData, station });
            }
        }
    }
}

// Load the US states GeoJSON data
async function loadUsStatesGeoJson() {
    if (!usStatesGeoJson) {
        try {
            const response = await fetch(usStatesGeoJsonUrl);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            usStatesGeoJson = await response.json();
        } catch (error) {
            console.error("Failed to load US States GeoJSON:", error);
            usStatesGeoJson = null; // Ensure it's null so it can retry later
        }
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

/**
 * Compares the standardized rdsPs string with the station's PS value.
 * The rdsPs string is standardized by replacing spaces with underscores and converting to lowercase.
 * The station's PS value is split into tokens (e.g., "__mdr___ _kultur_" -> ["__mdr___", "_kultur_"]).
 * The function iterates through all tokens and checks if any token yields at least three valid (non "_" ) matches.
 * Only positions where rdsPs is not an underscore are compared.
 * If at least three valid matches are found for any token, the function returns true.
 */
function validPsCompare(rdsPs, stationPs) {
    if (typeof stationPs !== 'string' || typeof rdsPs !== 'string') {
        consoleCmd.logDebug(`Invalid TX values. stationPs: ${stationPs}, rdsPs: ${rdsPs}`);
        return false;
    }

    // Standardize the rdsPs string: replace spaces with underscores and convert to lowercase.
    const standardizedRdsPs = rdsPs.replace(/ /g, '_').toLowerCase();
    
    // Split stationPs into tokens (e.g., "__mdr___ _kultur_" -> ["__mdr___", "_kultur_"])
    const psTokens = stationPs.split(/\s+/).filter(token => token.length > 0).map(token => { const lower = token.toLowerCase(); return lower.length < 8 ? lower.padEnd(8, '_') : lower; });
       
    // Iterate through all tokens and check if any token yields at least three valid (non "_" ) matches.
    for (let token of psTokens) {
        // If total non "_" length of token is less than 3, allow match based on that length instead
        const tokenLength = token.replace(/_/g, "").length;
        const minMatchLen = tokenLength > 2 ? 3 : tokenLength;
        // If the token's length does not match the standardized rdsPs length, skip this token.
        if (token.length !== standardizedRdsPs.length) continue;
        
        let matchCount = 0;
        for (let i = 0; i < standardizedRdsPs.length; i++) {
            // Skip this position if the character in standardizedRdsPs is an underscore.
            if (standardizedRdsPs[i] === '_') continue;
            if (token[i] === standardizedRdsPs[i]) {
                matchCount++;
            }
        }
        if (matchCount >= minMatchLen) {
            return true;
        }
    }
    return false;
}

function evaluateStation(station, esMode) {
    let weightDistance = station.distanceKm;
    if (esMode && station.distanceKm > 700) {
        weightDistance = Math.abs(station.distanceKm - 1500) + 200;
    }
    let erp = station.erp && station.erp > 0 ? station.erp : 1;
    let extraWeight = erp > weightedErp && station.distanceKm <= weightDistance ? 0.3 : 0;
    let score = 0;
    // If ERP is 1W, use a simpler formula to avoid zero-scoring.
    if (erp === 0.001) {
        score = erp / station.distanceKm;
    } else {
        score = ((10 * (Math.log10(erp * 1000))) / weightDistance) + extraWeight;
    }
    return score;
}

// Fetch data from maps
async function fetchTx(freq, piCode, rdsPs) {
    let match = null;
    let multiMatches = [];
    const now = Date.now();
    // Fetch TX database if the next fetch time has passed, as long as we weren't still waiting.
    if (now > nextLocalDbUpdate && !awaitingTxInfo) {
        consoleCmd.logInfo('Time to update transmitter database.');
        buildTxDatabase();
    }
    freq = parseFloat(freq);

    if (
        isNaN(freq) ||
        now - lastFetchTime < fetchInterval ||
        Latitude.length < 2 ||
        freq < 87 ||
        Object.keys(localDb).length === 0 ||
        (currentPiCode === piCode && currentRdsPs === rdsPs)
    ) return Promise.resolve();

    lastFetchTime = now;
    currentPiCode = piCode;
    currentRdsPs = rdsPs;
    if (serverConfig.webserver.rdsMode === true) await loadUsStatesGeoJson();

    const key = `${freq}|${piCode.toUpperCase()}`;
    let rawMatches = piFreqIndex[key] || [];

    // Format the results into the same structure as before
    let filteredLocations = rawMatches.map(({ station, ...locData }) => ({
        ...locData,
        stations: [station]
    }));

    // If there is still more than one match, do a final exact PS match.
    if (filteredLocations.length > 1) {
        const extraFilteredLocations = filteredLocations.map(locData => ({
            ...locData,
            stations: locData.stations.filter(station => (station.ps.toLowerCase() === rdsPs.replace(/ /g, '_').toLowerCase()))
        })).filter(locData => locData.stations.length > 0);

        if (extraFilteredLocations.length > 0) {
            filteredLocations = extraFilteredLocations;
        }
    }

    // Only check PS if we have more than one match.
    if (filteredLocations.length > 1) {
        filteredLocations = filteredLocations.map(locData => ({
            ...locData,
            stations: locData.stations.filter(station => validPsCompare(rdsPs, station.ps))
        })).filter(locData => locData.stations.length > 0);
    }
  
    for (let loc of filteredLocations) {
      loc = Object.assign(loc, loc.stations[0]);
      delete loc.stations;
      const dist = haversine(Latitude, Longitude, loc.lat, loc.lon);
      loc = Object.assign(loc, dist);
      loc.detectedByPireg = (loc.pireg === piCode.toUpperCase());
    }
  
    if (filteredLocations.length > 1) {
        // Check for any 10kW+ stations within 700km, and don't Es weight if any found.
        const tropoPriority = filteredLocations.some(
            loc => loc.distanceKm < 700 && loc.erp >= 10
        );
        let esMode = false;
        if (!tropoPriority) {
            esMode = checkEs();
        }
        for (let loc of filteredLocations) {
            loc.score = evaluateStation(loc, esMode);
        }
        // Sort by score in descending order
        filteredLocations.sort((a, b) => b.score - a.score);
        match = filteredLocations[0];
        // Have a maximum of 10 extra matches and remove any with less than 1/10 of the winning score
        multiMatches = filteredLocations
            .slice(1, 11)
            .filter(obj => obj.score >= (match.score / 10));
    } else if (filteredLocations.length === 1) {
        match = filteredLocations[0];
        match.score = 1;
    }

    if (match) {
        if (match.itu === 'USA') {
            const state = getStateForCoordinates(match.lat, match.lon);
            if (state) {
                match.state = state;  // Add state to matchingCity
            }
        }
        const result = {
            station: match.detectedByPireg
            ? `${match.station.replace("R.", "Radio ")}${match.regname ? ' ' + match.regname : ''}`
            : match.station.replace("R.", "Radio "),
            pol: match.pol.toUpperCase(),
            erp: match.erp && match.erp > 0 ? match.erp : '?',
            city: match.name,
            itu: match.state ? match.state + ', ' + match.itu : match.itu,
            distance: match.distanceKm.toFixed(0),
            azimuth: match.azimuth.toFixed(0),
            id: match.id,
            pi: match.pi,
            foundStation: true,
            reg: match.detectedByPireg,
            score: match.score,
            others: multiMatches.slice(),
        };
        filteredLocations.length = 0;
        multiMatches.length = 0;
        return result;
    } else {
        filteredLocations.length = 0;
        multiMatches.length = 0;
        return Promise.resolve();
    }
}

function checkEs() {
    const now = Date.now();
    const url = "https://fmdx.org/includes/tools/get_muf.php";

    if (esSwitchCache.lastCheck && now - esSwitchCache.lastCheck < esFetchInterval) {
        return esSwitchCache.esSwitch;
    }

    if (Latitude > 20) {
        esSwitchCache.lastCheck = now;
        fetch(url)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                if ((Longitude < -32 && data.north_america.max_frequency !== "No data") ||
                    (Longitude >= -32 && data.europe.max_frequency !== "No data")) {
                    esSwitchCache.esSwitch = true;
                }
            })
            .catch(error => {
                console.error("Error fetching Es data:", error);
            });
    }

    return esSwitchCache.esSwitch;
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
