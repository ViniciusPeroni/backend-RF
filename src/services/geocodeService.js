const axios = require('axios');

// Converte endereço em latitude/longitude usando o Nominatim (OpenStreetMap).
// Gratuito e sem chave, mas a política de uso exige User-Agent identificado
// e no máximo 1 requisição por segundo. Falha nunca impede salvar o endereço:
// nesse caso retorna null e as coordenadas ficam vazias.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchAddress(params) {
    const response = await axios.get(NOMINATIM_URL, {
        params: {
            ...params,
            format: 'json',
            limit: 1,
            countrycodes: 'br'
        },
        headers: { 'User-Agent': 'ReaproveitaFranca/1.0 (TCC SENAI)' },
        timeout: 8000
    });

    if (!Array.isArray(response.data) || response.data.length === 0) return null;

    const latitude = Number(response.data[0].lat);
    const longitude = Number(response.data[0].lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
}

async function geocodeAddress({ street, number, city, state }) {
    // Da busca mais precisa para a mais ampla. O CEP não entra porque a base
    // do OpenStreetMap tem poucos CEPs brasileiros e ele derrubava a busca.
    const attempts = [
        { street: `${number} ${street}`, city, state },
        { street, city, state },
        { city, state }
    ];

    try {
        for (let i = 0; i < attempts.length; i++) {
            if (i > 0) await wait(1000);

            const result = await searchAddress(attempts[i]);
            if (result) return result;
        }

        return null;
    } catch (err) {
        console.error('Erro ao buscar coordenadas do endereço:', err.code || err.message);
        return null;
    }
}

module.exports = { geocodeAddress };
